#!/usr/bin/env bash
# DAR-542 — Maestro 에뮬 스모크 하니스(핵심 3플로우) 로컬 실행 진입점.
#
# 핵심 3플로우(mobile/.maestro/, tag: core):
#   ① 01-coldstart-guest-feed.yaml   게스트 홈 렌더(피드 + 에디션 요약 슬롯)
#   ② 02-dev-login.yaml              dev-login → 신호탭 에디션 브라우징(날짜 스트립 탭)
#   ③ 03-disclosure-detail.yaml      공시 상세 → 과거 유사공시 통계 섹션 노출
#
# CI 아님 — 로컬(Android 에뮬 dar_test) 재현용. 재현 절차 문서: docs/mobile-cross-platform-issues.md.
#
# 사용:
#   scripts/maestro-smoke.sh                 # 핵심 3플로우(core 태그) 실행
#   DEV_ACCESS=<jwt> DEV_REFRESH=<jwt> DEV_USER_ID=<uid> scripts/maestro-smoke.sh
#   DISCLOSURE_RCP_NO=<rcpNo> scripts/maestro-smoke.sh     # 플로우 ③ 대상 공시 고정(미지정 시 자동 탐색)
#   API_BASE=https://... scripts/maestro-smoke.sh          # 자동 탐색용 백엔드(기본: eas preview)
#
# 종료코드: 0=3플로우 그린, 그 외=실패/전제 미충족(메시지에 사유).
set -euo pipefail

APP_ID="com.gongsion.app"
API_BASE="${API_BASE:-https://168.138.198.152.nip.io/api}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MAESTRO_DIR="$REPO_ROOT/mobile/.maestro"
LOG_DIR="$REPO_ROOT/mobile/.maestro/.logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/smoke-core.log"

log() { printf '\033[1;34m[smoke]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[smoke]\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m[smoke] ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 1) Maestro 확보(없으면 설치 시도). Java 11+ 필요.
if ! command -v maestro >/dev/null 2>&1; then
  export PATH="$PATH:$HOME/.maestro/bin"
fi
if ! command -v maestro >/dev/null 2>&1; then
  warn "maestro 미설치 — 설치 시도(curl -Ls https://get.maestro.mobile.dev | bash)."
  curl -Ls "https://get.maestro.mobile.dev" | bash || die "Maestro 설치 실패. 수동 설치 후 재시도."
  export PATH="$PATH:$HOME/.maestro/bin"
fi
command -v maestro >/dev/null 2>&1 || die "maestro 를 PATH 에서 찾지 못했습니다(~/.maestro/bin)."
log "maestro: $(command -v maestro)"

# 2) adb + 에뮬레이터 확인(dar_test 우선).
command -v adb >/dev/null 2>&1 || die "adb 미설치(Android platform-tools 필요)."
DEVICE="$(adb devices | awk '/\tdevice$/{print $1; exit}')"
[ -n "${DEVICE:-}" ] || die "실행 중인 Android 기기/에뮬레이터가 없습니다. 'emulator -avd dar_test' 로 기동 후 재시도."
AVD_NAME="$(adb -s "$DEVICE" emu avd name 2>/dev/null | head -1 | tr -d '\r' || true)"
log "device: $DEVICE (avd: ${AVD_NAME:-unknown})"

# 3) 대상 앱 설치 확인. 미설치면 빌드 방법 안내 후 종료(그린 런의 유일한 인프라 전제).
if ! adb -s "$DEVICE" shell pm list packages 2>/dev/null | grep -q "package:${APP_ID}$"; then
  cat >&2 <<EOF
[smoke] ✗ 대상 앱 '${APP_ID}' 이 에뮬레이터에 설치돼 있지 않습니다.
        Maestro 플로우는 Expo Go 가 아니라 standalone 앱(${APP_ID})을 구동합니다. 스모크 빌드가 필요합니다:

        (A) 로컬 dev 빌드 — dev-login(플로우 ②) 자동 활성(__DEV__):
            cd mobile && npx expo run:android    # Android SDK/gradle 필요

        (B) EAS 프리뷰 APK — dev-login 활성화하려면 EXPO_PUBLIC_ALLOW_DEV_LOGIN=true 로 빌드:
            cd mobile && EXPO_PUBLIC_ALLOW_DEV_LOGIN=true eas build -p android --profile preview
            (완료 후) adb -s ${DEVICE} install <다운로드.apk>

        설치 후 이 스크립트를 다시 실행하세요. (플로우 ② 는 DEV_ACCESS/DEV_REFRESH/DEV_USER_ID JWT 도 필요)
EOF
  exit 3
fi
log "app '${APP_ID}' 설치 확인."

# 4) 플로우 ② 전제(dev-login JWT) 경고 — 미주입이어도 ①③ 는 진행.
MAESTRO_ENV=()
if [ -n "${DEV_ACCESS:-}" ] && [ -n "${DEV_REFRESH:-}" ] && [ -n "${DEV_USER_ID:-}" ]; then
  MAESTRO_ENV+=(-e "DEV_ACCESS=${DEV_ACCESS}" -e "DEV_REFRESH=${DEV_REFRESH}" -e "DEV_USER_ID=${DEV_USER_ID}")
  log "dev-login JWT 주입됨(플로우 ②)."
else
  warn "DEV_ACCESS/DEV_REFRESH/DEV_USER_ID 미주입 — 플로우 ②(dev-login)는 홈 도달 대기에서 실패할 수 있습니다."
fi

# 5) 플로우 ③ 대상 공시(rcpNo) — 미지정 시 이벤트 보유 공시를 백엔드에서 자동 탐색.
#    공개 목록 GET /disclosure-events(추출된 이벤트만) → 상세 로드 가능한 첫 rcpNo 선택(반응 섹션 마운트 보장).
if [ -z "${DISCLOSURE_RCP_NO:-}" ]; then
  log "이벤트 보유 공시 자동 탐색 중($API_BASE/disclosure-events)…"
  DISCLOSURE_RCP_NO="$(
    API_BASE="$API_BASE" python3 -c '
import os, json, urllib.request, ssl
base = os.environ["API_BASE"]
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u), timeout=10, context=ctx) as r:
        return json.load(r)
found = ""
try:
    items = get(base + "/disclosure-events?limit=50").get("items", []) or []
except Exception:
    items = []
for it in items:
    rcp = it.get("rcpNo")
    if not rcp:
        continue
    try:  # 상세가 실제 로드돼야 공시 상세 화면(disclosure-detail-screen)에 도달한다.
        if get(base + "/disclosures/" + rcp).get("data"):
            found = rcp; break
    except Exception:
        continue
print(found)
' 2>/dev/null || true
  )"
  if [ -n "${DISCLOSURE_RCP_NO:-}" ]; then
    log "플로우 ③ 대상 rcpNo=$DISCLOSURE_RCP_NO (이벤트 보유·상세 로드 OK)."
  else
    warn "이벤트 보유 공시 자동 탐색 실패 — 플로우 ③ 은 피드 첫 카드 폴백(이벤트 없으면 실패)."
  fi
fi
[ -n "${DISCLOSURE_RCP_NO:-}" ] && MAESTRO_ENV+=(-e "DISCLOSURE_RCP_NO=${DISCLOSURE_RCP_NO}")

# 6) 핵심 3플로우 실행(core 태그) — 로그를 파일로도 남긴다.
log "핵심 3플로우 실행(core) → $LOG_FILE"
set +e
maestro test --include-tags core "${MAESTRO_ENV[@]}" "$MAESTRO_DIR" 2>&1 | tee "$LOG_FILE"
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -eq 0 ]; then
  log "✅ 핵심 3플로우 그린. 로그: $LOG_FILE"
else
  warn "❌ 일부 플로우 실패(exit=$STATUS). 로그: $LOG_FILE — 실패 플로우는 결함 이슈로 분리 보고."
fi
exit "$STATUS"
