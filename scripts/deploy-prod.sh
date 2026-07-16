#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# prod 원샷 배포 — docs/deployment.md §3.1 정본 절차의 자동화 (Mac에서 실행)
#
#   백업 → amd64 크로스빌드 → ssh 스트리밍 load → DB 마이그레이션 → 재기동 → 검증
#
# 사용:
#   bash scripts/deploy-prod.sh                # 전체 절차 (단계마다 확인 프롬프트)
#   bash scripts/deploy-prod.sh -y             # 프롬프트 없이 전체 진행
#   bash scripts/deploy-prod.sh --skip-build   # 빌드 생략(이미 빌드된 이미지 재사용)
#   bash scripts/deploy-prod.sh --skip-backup  # 수동 백업 생략(자동백업 03:30 신뢰 시)
#   bash scripts/deploy-prod.sh --skip-migrate # 스키마 변경 없는 배포
#   bash scripts/deploy-prod.sh --verify-only  # 검증 단계만 실행
#
# 전제:
#   - ~/.ssh/oci_instance 키 (docs/deployment.md §3.1 — 키 지정 필수)
#   - Docker Desktop 가동 (buildx, linux/amd64 크로스빌드)
#   - micro(1GB)에서는 빌드 불가(OOM) → 반드시 Mac에서 빌드해 전송 (★원격 --build 금지)
#
# 안전:
#   - 마이그레이션은 compose 의 migrate 프로파일(1회성 잡)로만 실행 — 자동 마이그레이션 금지 원칙 유지.
#   - ★--no-deps 필수: 2-micro 분리 운영에서 DB 는 micro2(10.0.1.151) — depends_on 의
#     postgres(단일 VM용 서비스)가 micro1 에 로컬 DB 를 띄우는 사고를 차단한다.
#   - 배포 시간대는 장외 권장(20:30~익일 07:00 — 모의운용 트랙 19:30~19:50·수급 EOD 20:00 회피).
#   - 롤백: 마이그레이션은 가산적(additive)이면 되돌릴 필요 없음. 이미지는 이전 태그로
#     compose 의 image 를 바꿔 `up -d backend` 하면 끝.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HOST="168.138.198.152"
SSH_KEY="$HOME/.ssh/oci_instance"
SSH_OPTS=(-i "$SSH_KEY" -o ConnectTimeout=10)
REMOTE="ubuntu@$HOST"
REMOTE_DIR="/home/ubuntu/dano"
# ★원격 실경로(2026-07-16 실측): compose 는 docker-compose.yml 이다(repo 의 docker-compose.prod.yml 아님).
#   dano 는 git checkout 이 아니라 compose + backend/.env.prod 만 있는 배포 디렉터리다(그래서 git pull 불가).
#   원격 compose 의 migrate 프로파일도 이 파일에 있고, DB=micro2(10.0.1.151)는 .env.prod 로 연결된다.
COMPOSE="docker compose -f $REMOTE_DIR/docker-compose.yml"
IMAGE="dart-notification-backend:prod"
BASE_URL="https://168.138.198.152.nip.io"

YES=false
SKIP_BACKUP=false
SKIP_BUILD=false
SKIP_MIGRATE=false
VERIFY_ONLY=false
for arg in "$@"; do
  case "$arg" in
    -y) YES=true ;;
    --skip-backup) SKIP_BACKUP=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --skip-migrate) SKIP_MIGRATE=true ;;
    --verify-only) VERIFY_ONLY=true ;;
    *) echo "알 수 없는 옵션: $arg" >&2; exit 2 ;;
  esac
done

ts() { date '+%H:%M:%S'; }
log() { printf '\033[1;36m[%s]\033[0m %s\n' "$(ts)" "$*"; }
warn() { printf '\033[1;33m[%s] ⚠ %s\033[0m\n' "$(ts)" "$*"; }
die() { printf '\033[1;31m[%s] ✖ %s\033[0m\n' "$(ts)" "$*" >&2; exit 1; }

confirm() {
  $YES && return 0
  printf '\033[1m%s [y/N] \033[0m' "$1"
  read -r ans
  [[ "$ans" == "y" || "$ans" == "Y" ]] || die "사용자 중단"
}

on_fail() {
  local code=$?
  [[ $code -eq 0 ]] && return
  warn "배포 절차가 실패했습니다(exit $code)."
  warn "롤백 안내: 가산적 마이그레이션은 되돌릴 필요 없음. 이전 이미지 태그 확인 후"
  warn "  ssh ${SSH_OPTS[*]} $REMOTE 'cd $REMOTE_DIR && $COMPOSE up -d backend'"
  warn "  (compose image 태그를 이전 것으로 수정했다면) 로 서비스만 원복하면 됩니다."
}
trap on_fail EXIT

# ── 검증 단계 (독립 함수 — --verify-only 에서 재사용) ─────────────────────────
verify() {
  log "⑤ 배포 검증"
  local fail=0

  check() { # <라벨> <기대코드> <URL>
    local label="$1" expect="$2" url="$3" code
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" || echo "000")
    if [[ "$code" == "$expect" ]]; then
      log "  ✓ $label — HTTP $code"
    else
      warn "  ✗ $label — HTTP $code (기대 $expect): $url"
      fail=1
    fi
  }

  check "헬스체크 /health"                     200 "$BASE_URL/health"
  check "공시 API (데이터 경로)"               200 "$BASE_URL/api/disclosures?limit=1"
  check "공개 무결성 페이지 /status"           200 "$BASE_URL/status"
  check "랜딩 /"                               200 "$BASE_URL/"
  check "공유페이지 404 분기"                  404 "$BASE_URL/share/00000000000000"
  # W17 Swagger prod 게이트 — prod 에서 /api/docs 는 차단(404)이어야 정상.
  check "Swagger prod 차단 /api/docs"          404 "$BASE_URL/api/docs"

  log "  최신 공시 신선도(수집 정체 여부 — rcpDt 가 최근 영업일인지 육안 확인):"
  curl -s --max-time 15 "$BASE_URL/api/disclosures?limit=1" | head -c 400; echo

  log "  컨테이너 상태:"
  ssh "${SSH_OPTS[@]}" "$REMOTE" "$COMPOSE ps"

  log "  부팅 직후 에러 로그 스캔(최근 5분):"
  if ssh "${SSH_OPTS[@]}" "$REMOTE" "$COMPOSE logs --since 5m backend 2>&1" \
    | grep -iE 'error|exception|unhandled|P20[0-9]{2}' | grep -viE 'errorRate|0 error' | head -10; then
    warn "  위 로그 라인 확인 필요(패턴 매치). 무해한 매치일 수 있으니 문맥 확인."
  else
    log "  ✓ 에러 패턴 없음"
  fi

  [[ $fail -eq 0 ]] || die "검증 실패 항목 있음 — 위 ✗ 항목 확인"
  log "검증 통과 ✅"
}

# ── 프리플라이트 ──────────────────────────────────────────────────────────────
log "프리플라이트 점검"
[[ -f "$SSH_KEY" ]] || die "SSH 키 없음: $SSH_KEY"
docker info >/dev/null 2>&1 || die "Docker 데몬 미가동 — Docker Desktop 을 켜세요"
ssh "${SSH_OPTS[@]}" -o BatchMode=yes "$REMOTE" true 2>/dev/null || die "ssh 접속 실패: $REMOTE"

branch=$(git branch --show-current)
if [[ "$branch" != "main" ]]; then
  warn "현재 브랜치가 main 이 아닙니다: $branch"
  confirm "이 브랜치 기준으로 이미지를 빌드해 배포합니까?"
fi
git fetch origin main --quiet || warn "git fetch 실패(오프라인?) — 로컬 기준으로 진행"
if [[ "$branch" == "main" ]] && [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  warn "로컬 main 이 origin/main 과 다릅니다 — git pull 권장"
  confirm "그래도 진행합니까?"
fi

# ★ 10# 강제: date 가 "08"/"09" 를 주면 bash 산술이 8진수로 읽어 에러 — 십진 명시.
hour=$((10#$(date '+%H')))
if [[ "$hour" -ge 8 && "$hour" -lt 16 ]]; then
  warn "현재 장중 시간대(${hour}시)입니다 — 장외(20:30~익일 07:00) 배포 권장 (M10 모의운용 사이클 보호)"
  confirm "그래도 진행합니까?"
fi

if $VERIFY_ONLY; then verify; trap - EXIT; exit 0; fi

confirm "prod($HOST) 배포를 시작합니다. 계속?"

# ── ⓪ 원격 배포 파일 확인 (★원격은 git checkout 이 아님 — compose·.env.prod 는 out-of-band 관리) ──
#   /home/ubuntu/dano 는 compose + backend/.env.prod 만 있는 배포 디렉터리다. compose·스크립트
#   변경이 필요하면 scp 로 개별 전송한다(git pull 아님). 이미지는 로컬 빌드→docker load 라 무관.
log "⓪ 원격 compose 존재 확인"
ssh "${SSH_OPTS[@]}" "$REMOTE" "test -f $REMOTE_DIR/docker-compose.yml" \
  || die "원격 compose 없음: $REMOTE_DIR/docker-compose.yml — 원격 배포 디렉터리 상태 확인 필요"

# ── ① 배포 직전 수동 백업 ────────────────────────────────────────────────────
if $SKIP_BACKUP; then
  warn "① 백업 생략(--skip-backup)"
else
  log "① 배포 직전 DB 백업 (pg_dump → S3)"
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "ENV_FILE=$REMOTE_DIR/backend/.env.prod bash $REMOTE_DIR/scripts/backup-prod-db.sh" \
    || die "백업 실패 — 백업 없이는 진행하지 않습니다(--skip-backup 로 명시 생략 가능)"
fi

# ── ② amd64 크로스빌드 ───────────────────────────────────────────────────────
if $SKIP_BUILD; then
  warn "② 빌드 생략(--skip-build) — 기존 로컬 이미지 사용"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || die "로컬에 $IMAGE 이미지가 없습니다"
else
  log "② linux/amd64 크로스빌드 (~10분)"
  docker buildx build --platform linux/amd64 -t "$IMAGE" ./backend --load
fi

# ── ③ 이미지 스트리밍 전송 ───────────────────────────────────────────────────
log "③ 이미지 전송 (docker save | gzip | ssh docker load, ~5분)"
docker save "$IMAGE" | gzip | ssh "${SSH_OPTS[@]}" "$REMOTE" 'gunzip | docker load'

# ── ④ DB 마이그레이션 → 재기동 (순서 고정: 가산 마이그레이션 선적용이 안전) ──────
if $SKIP_MIGRATE; then
  warn "④-1 마이그레이션 생략(--skip-migrate)"
else
  log "④-1 DB 마이그레이션 적용 (migrate 프로파일 1회성 잡, --no-deps: DB=micro2)"
  confirm "마이그레이션을 prod DB(micro2)에 적용합니다. 계속?"
  ssh "${SSH_OPTS[@]}" "$REMOTE" \
    "cd $REMOTE_DIR && $COMPOSE --profile migrate run --rm --no-deps migrate"
fi

log "④-2 백엔드 재기동 (로드된 이미지 그대로 — ★--build 금지)"
ssh "${SSH_OPTS[@]}" "$REMOTE" "cd $REMOTE_DIR && $COMPOSE up -d backend"

log "부팅 대기(20s) 후 검증 시작"
sleep 20

verify

log "다음 관찰 포인트(익일): 07:40 수급 EOD 백스톱 · 09:01~ 공시 1분 델타(예약분 소진 OPS_ALERT 부재 확인) · 09:05~ 급변동 5분 틱 · 20:00 수급 EOD 본수집"
trap - EXIT
log "배포 완료 🎉"
