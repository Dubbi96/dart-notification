#!/usr/bin/env bash
#
# Galaxy(Android) 실기기에서 Metro를 LAN으로 띄우는 헬퍼 (DAR-114)
#
# 하는 일:
#  1) Mac의 LAN IP를 자동 감지 (Wi-Fi en0 → en1 폴백)
#  2) EXPO_PUBLIC_API_URL / REACT_NATIVE_PACKAGER_HOSTNAME 을 그 IP로 설정
#  3) expo start 실행 (기본 dev build, --go 옵션 주면 Expo Go)
#
# 사용법:
#   ./scripts/start-lan.sh              # dev build (expo-dev-client) 전제
#   ./scripts/start-lan.sh --go         # Expo Go (SDK56) 폴백
#   API_PORT=3000 IFACE=en1 ./scripts/start-lan.sh   # 포트/인터페이스 오버라이드
#
# Wi-Fi가 바뀌면 IP가 바뀌므로 다시 실행할 것.

set -euo pipefail

# 어느 위치에서 실행하든 mobile/ 디렉터리에서 동작하도록 이동.
# (이 스크립트는 mobile/scripts/ 에 있으므로 부모의 부모가 mobile/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || { echo "✗ mobile/ 디렉터리로 이동 실패" >&2; exit 1; }

API_PORT="${API_PORT:-3000}"
IFACE="${IFACE:-}"

detect_ip() {
  # macOS: ipconfig getifaddr; 우선순위 en0(Wi-Fi) → en1
  if [ -n "$IFACE" ]; then
    ipconfig getifaddr "$IFACE" 2>/dev/null && return 0
  fi
  for i in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$i" 2>/dev/null || true)"
    if [ -n "$ip" ]; then echo "$ip"; return 0; fi
  done
  return 1
}

LAN_IP="$(detect_ip || true)"
if [ -z "${LAN_IP:-}" ]; then
  echo "✗ LAN IP를 감지하지 못했습니다. Wi-Fi 연결을 확인하거나 IFACE=enX 로 지정하세요." >&2
  exit 1
fi

export EXPO_PUBLIC_API_URL="http://${LAN_IP}:${API_PORT}/api"
export REACT_NATIVE_PACKAGER_HOSTNAME="${LAN_IP}"

echo "▶ LAN IP            : ${LAN_IP}"
echo "▶ EXPO_PUBLIC_API_URL : ${EXPO_PUBLIC_API_URL}"
echo "▶ PACKAGER_HOSTNAME : ${REACT_NATIVE_PACKAGER_HOSTNAME}"
echo "▶ Galaxy: 같은 Wi-Fi에서 dev build 실행(또는 Expo Go: exp://${LAN_IP}:8081)"
echo

# 인자(--go 등)는 그대로 expo start 로 전달
exec npx expo start --lan "$@"
