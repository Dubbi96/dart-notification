#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# OPS-1 · 프로덕션 DB 자동 백업 — micro1 에서 실행 (pg_dump → gzip → S3 업로드)
#
# 대상: OCI 2-micro 라이브(§docs/deployment.md 3.1).
#   - micro1(앱 호스트)에서 실행하며, DATABASE_URL 이 micro2(10.0.1.151:5432)를 가리킨다.
#   - 자격/버킷은 backend/.env.prod 의 기존 값(DATABASE_URL·AWS_*·S3_BUCKET)을 재사용한다.
#   - 업로드 경로: s3://$S3_BUCKET/backups/dart_notification_YYYY-MM-DD.dump.gz
#
# 사용:
#   bash scripts/backup-prod-db.sh                        # 기본(.env.prod 자동 탐색)
#   ENV_FILE=/home/ubuntu/dano/backend/.env.prod bash scripts/backup-prod-db.sh
#
# crontab 설치 (micro1, 매일 03:30 KST — 서버 시계는 UTC 이므로 18:30 UTC = 익일 03:30 KST):
#   crontab -e 후 아래 1줄 추가 (원격 실경로는 /home/ubuntu/dano — docs/deployment.md §3.1):
#   30 18 * * * ENV_FILE=/home/ubuntu/dano/backend/.env.prod bash /home/ubuntu/dano/scripts/backup-prod-db.sh >> /home/ubuntu/backup-prod-db.log 2>&1
#
# 도구 의존:
#   - pg_dump: 호스트에 있으면 사용, 없으면 compose 와 동일한 timescale 이미지로 docker 폴백.
#   - aws CLI: 호스트에 있으면 사용, 없으면 amazon/aws-cli 이미지로 docker 폴백.
#   → micro1 은 docker 상시 구동이므로 별도 패키지 설치 없이 동작한다.
#
# 실패 정책: 어느 단계든 실패 시 stderr 로 원인 출력 + exit 1 (cron 로그에서 발견 가능).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

err() { echo "[backup-prod-db] ERROR: $*" >&2; }
log() { echo "[backup-prod-db] $*"; }

# ── ① 환경 로드 — backend/.env.prod 재사용 (DATABASE_URL·AWS_*·S3_BUCKET) ────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/../backend/.env.prod}"

if [[ -f "$ENV_FILE" ]]; then
  # .env 형식(KEY=VALUE) 로드 — env 파일 값이 최종 적용된다(개별 override 는 파일 수정으로).
  set -o allexport
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +o allexport
else
  log "env 파일 없음($ENV_FILE) — 이미 export 된 환경변수로 진행"
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  err "DATABASE_URL 미설정 — ENV_FILE($ENV_FILE) 경로 또는 환경변수를 확인하세요"
  exit 1
fi
if [[ -z "${S3_BUCKET:-}" ]]; then
  err "S3_BUCKET 미설정 — backend/.env.prod 의 기존 버킷 env(S3_BUCKET)를 재사용합니다"
  exit 1
fi
AWS_REGION="${AWS_REGION:-ap-northeast-2}"
export DATABASE_URL AWS_REGION

# ── ② 덤프 파일명·임시 경로 준비 (+실패/종료 시 임시파일 정리 trap) ──────────
STAMP="$(date +%Y-%m-%d)"
DUMP_NAME="dart_notification_${STAMP}.dump.gz"
TMP_DIR="$(mktemp -d /tmp/backup-prod-db.XXXXXX)"
TMP_FILE="$TMP_DIR/$DUMP_NAME"
trap 'rm -rf "$TMP_DIR"' EXIT

# ── ③ pg_dump -Fc → gzip — nice/ionice 로 라이브 트래픽 영향 최소화 ──────────
# custom format(-Fc)은 선택 복원·병렬 복원이 가능해 정본 포맷으로 유지한다.
# ionice 는 리눅스 전용 — 없으면(맥 로컬 검증 등) 조용히 생략.
NICE_CMD=(nice -n 19)
if command -v ionice >/dev/null 2>&1; then
  NICE_CMD=(nice -n 19 ionice -c 3)
fi

run_pg_dump() {
  if command -v pg_dump >/dev/null 2>&1; then
    "${NICE_CMD[@]}" pg_dump -Fc --no-password --dbname="$DATABASE_URL"
  else
    # 호스트에 pg_dump 없음 → compose 와 동일 이미지로 폴백(서버 pg15 와 버전 일치).
    # DATABASE_URL 은 -e 로 컨테이너 env 에만 전달 — 호스트 ps/inspect args 에 비밀번호 미노출.
    log "호스트 pg_dump 없음 — docker(timescale/timescaledb:2.17.2-pg15) 폴백"
    "${NICE_CMD[@]}" docker run --rm -e DATABASE_URL \
      timescale/timescaledb:2.17.2-pg15 \
      sh -c 'exec pg_dump -Fc --no-password --dbname="$DATABASE_URL"'
  fi
}

log "pg_dump 시작 → $TMP_FILE"
if ! run_pg_dump | gzip > "$TMP_FILE"; then
  err "pg_dump 실패 (DATABASE_URL 접근성·자격 확인)"
  exit 1
fi

# 산출물 크기 sanity check — 빈/깨진 덤프(수 KB)를 성공으로 오인하지 않게 최소 크기 검사.
BYTES=$(wc -c < "$TMP_FILE" | tr -d ' ')
if [[ "$BYTES" -lt 10240 ]]; then
  err "덤프 크기 비정상(${BYTES}B < 10KB) — 실패로 간주"
  exit 1
fi
log "덤프 완료 (${BYTES}B)"

# ── ④ S3 업로드 — 기존 AWS 자격(AWS_ACCESS_KEY_ID/SECRET, S3_BUCKET) 재사용 ──
S3_URI="s3://${S3_BUCKET}/backups/${DUMP_NAME}"

run_s3_cp() {
  if command -v aws >/dev/null 2>&1; then
    aws s3 cp "$TMP_FILE" "$S3_URI" --region "$AWS_REGION" --only-show-errors
  else
    log "호스트 aws CLI 없음 — docker(amazon/aws-cli) 폴백"
    docker run --rm \
      -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY -e AWS_SESSION_TOKEN \
      -e AWS_REGION="$AWS_REGION" \
      -v "$TMP_DIR:/backup:ro" \
      amazon/aws-cli s3 cp "/backup/$DUMP_NAME" "$S3_URI" --only-show-errors
  fi
}

log "S3 업로드 시작 → $S3_URI"
if ! run_s3_cp; then
  err "S3 업로드 실패 (AWS 자격·버킷 권한 확인) — 로컬 임시파일은 trap 으로 정리됨"
  exit 1
fi

log "백업 완료: $S3_URI (${BYTES}B) — 로컬 임시파일은 종료 시 자동 정리"

# ─────────────────────────────────────────────────────────────────────────────
# [보존 정책 — S3 Lifecycle 로 관리 (스크립트는 업로드만 담당)]
# 권장: 일 7개 · 주 4개 · 월 3개 수준의 롤링 보존.
#   S3 Lifecycle 규칙만으로는 "주/월 대표본 남기기"가 안 되므로 실용 구성은:
#   ① backups/ prefix 에 만료 규칙(예: 35일 후 Expire)을 걸어 일 단위 덤프를 자동 정리하고,
#   ② 주 1회(일요일)·월 1회(1일) cron 이 backups/weekly/·backups/monthly/ 로 s3 cp 복사,
#      각 prefix 에 별도 만료(weekly: 28일, monthly: 90일)를 건다.
#   콘솔: S3 → 버킷 → Management → Lifecycle rules. CLI 예:
#     aws s3api put-bucket-lifecycle-configuration --bucket "$S3_BUCKET" \
#       --lifecycle-configuration '{"Rules":[
#         {"ID":"daily-35d","Filter":{"Prefix":"backups/"},"Status":"Enabled","Expiration":{"Days":35}},
#         {"ID":"weekly-28d","Filter":{"Prefix":"backups/weekly/"},"Status":"Enabled","Expiration":{"Days":28}},
#         {"ID":"monthly-90d","Filter":{"Prefix":"backups/monthly/"},"Status":"Enabled","Expiration":{"Days":90}}]}'
#   (※ 상위 backups/ 규칙이 하위 prefix 에도 적용되므로 weekly/monthly 만료일이 더 길면
#    weekly/monthly 규칙이 우선하도록 콘솔에서 규칙 충돌 여부를 확인할 것.)
# 복구 절차·TimescaleDB pre/post_restore 주의는 docs/deployment.md §5 참조.
# ─────────────────────────────────────────────────────────────────────────────
