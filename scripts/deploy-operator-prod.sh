#!/usr/bin/env bash
# AOS Operator Web을 기존 OCI Always Free micro1에 정적 배포한다.
# Backend API는 같은 Admin 호스트의 /api로 프록시해 CORS 표면과 추가 비용을 만들지 않는다.
set -euo pipefail

HOST="168.138.198.152"
ADMIN_HOST="admin.168.138.198.152.nip.io"
SSH_KEY="${HOME}/.ssh/oci_instance"
REMOTE="ubuntu@${HOST}"
REMOTE_ROOT="/var/www/aos-operator"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPERATOR_DIR="${PROJECT_ROOT}/operator-web"
CADDY_SNIPPET="${PROJECT_ROOT}/infra/caddy/aos-operator.caddy"
RELEASE_ID="$(git -C "${PROJECT_ROOT}" rev-parse --short=12 HEAD)-$(date -u '+%Y%m%d%H%M%S')"
ARCHIVE="$(mktemp -t aos-operator.XXXXXX.tar.gz)"
REMOTE_ARCHIVE="/tmp/aos-operator-${RELEASE_ID}.tar.gz"
REMOTE_SNIPPET="/tmp/aos-operator-${RELEASE_ID}.caddy"
SSH_OPTS=(-i "${SSH_KEY}" -o BatchMode=yes -o ConnectTimeout=10)

cleanup() {
  rm -f "${ARCHIVE}"
  ssh "${SSH_OPTS[@]}" "${REMOTE}" "rm -f '${REMOTE_ARCHIVE}' '${REMOTE_SNIPPET}'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

[[ -f "${SSH_KEY}" ]] || { echo "SSH 키가 없습니다: ${SSH_KEY}" >&2; exit 1; }
[[ -f "${CADDY_SNIPPET}" ]] || { echo "Caddy 설정이 없습니다: ${CADDY_SNIPPET}" >&2; exit 1; }

npm --prefix "${OPERATOR_DIR}" ci --legacy-peer-deps
npm --prefix "${OPERATOR_DIR}" test
VITE_API_BASE_URL=/api VITE_AOS_OPERATOR_DEMO=0 npm --prefix "${OPERATOR_DIR}" run build

tar -C "${OPERATOR_DIR}/dist" -czf "${ARCHIVE}" .
scp "${SSH_OPTS[@]}" "${ARCHIVE}" "${REMOTE}:${REMOTE_ARCHIVE}"
scp "${SSH_OPTS[@]}" "${CADDY_SNIPPET}" "${REMOTE}:${REMOTE_SNIPPET}"

ssh "${SSH_OPTS[@]}" "${REMOTE}" "
  set -eu
  release='${REMOTE_ROOT}/releases/${RELEASE_ID}'
  sudo mkdir -p \"\${release}\" /etc/caddy/Caddyfile.d
  sudo tar -xzf '${REMOTE_ARCHIVE}' -C \"\${release}\"
  sudo find \"\${release}\" -type d -exec chmod 755 {} +
  sudo find \"\${release}\" -type f -exec chmod 644 {} +
  sudo chown -R root:root \"\${release}\"
  sudo install -m 0644 '${REMOTE_SNIPPET}' /etc/caddy/Caddyfile.d/aos-operator.caddy
  if ! sudo grep -Fqx 'import Caddyfile.d/*.caddy' /etc/caddy/Caddyfile; then
    sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-aos-operator
    printf '\nimport Caddyfile.d/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
  fi
  sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  sudo ln -sfn \"\${release}\" '${REMOTE_ROOT}/current'
  sudo systemctl reload caddy
  test \"\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 'https://${ADMIN_HOST}/')\" = 200
  test \"\$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 'https://${ADMIN_HOST}/api/aos/operator/bootstrap')\" = 401
"

echo "Admin 배포 완료: https://${ADMIN_HOST}/"
