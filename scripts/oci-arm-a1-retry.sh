#!/usr/bin/env bash
# OCI Always-Free ARM A1.Flex 확보 재시도 루프 (2026-06-24)
# Tokyo(AP-TOKYO-1-AD-1, AD 1개)는 ARM 용량 경쟁이 심해 "Out of host capacity"가 잦다.
# 풀 프리티어(4 OCPU/24GB)를 우선 시도하고, 거절되면 작은 구성으로 폴백하며 백오프 재시도한다.
# 성공 시 인스턴스 OCID/공개IP를 출력하고 종료. 비용 0 (Always-Free 한도 내).
#
# 사용:
#   nohup bash scripts/oci-arm-a1-retry.sh > /tmp/oci-arm-retry.log 2>&1 &
#   tail -f /tmp/oci-arm-retry.log
set -uo pipefail
export SUPPRESS_LABEL_WARNING=True

# ---- 고정 파라미터 (micro1에서 추출, 2026-06-24) ----
TENANCY="ocid1.tenancy.oc1..aaaaaaaaagc2632v4odizjscmnlbhm42wuoqb5kxacc6dl5cwbihlgx3yvza"
COMPARTMENT="$TENANCY"                       # 루트 compartment 사용
AD="xsfj:AP-TOKYO-1-AD-1"
SUBNET="ocid1.subnet.oc1.ap-tokyo-1.aaaaaaaaggamff4an2vpqxh57rohwuhusmyqdchpjijyydtakfehsvmdlraa"
IMAGE="ocid1.image.oc1.ap-tokyo-1.aaaaaaaal6ki4uyubrmgd4h633jco7b3vca46ddfvlnbnnt7owadvfmbvy3q"  # Ubuntu 22.04 aarch64 2026.04.30
SSH_PUB="$HOME/.ssh/oci_instance.pub"
NAME="dano-arm-a1"
BOOT_GB=100                                  # Always-Free 부트볼륨 한도 200GB 내 (2-micro가 이미 일부 점유 시 조정)

# ---- 폴백 구성 (OCPU, GB RAM) — 큰 것부터 시도 ----
# Always-Free ARM 한도: 합산 4 OCPU / 24GB. 작은 구성일수록 용량 잡힐 확률↑.
CONFIGS=("4 24" "2 12" "1 6")

SLEEP_BASE=60          # 기본 재시도 간격(초)
SLEEP_MAX=900          # 최대 백오프(초)
attempt=0
sleep_s=$SLEEP_BASE

ts() { date '+%Y-%m-%d %H:%M:%S'; }

if [[ ! -f "$SSH_PUB" ]]; then
  echo "[$(ts)] FATAL: SSH 공개키 없음: $SSH_PUB"; exit 1
fi

echo "[$(ts)] ARM A1.Flex 확보 루프 시작. AD=$AD, 구성 폴백=${CONFIGS[*]}"

while true; do
  attempt=$((attempt+1))
  for cfg in "${CONFIGS[@]}"; do
    OCPU=$(echo "$cfg" | cut -d' ' -f1)
    MEM=$(echo "$cfg" | cut -d' ' -f2)
    echo "[$(ts)] 시도 #$attempt — A1.Flex ${OCPU}OCPU/${MEM}GB ..."

    OUT=$(oci compute instance launch \
      --availability-domain "$AD" \
      --compartment-id "$COMPARTMENT" \
      --shape "VM.Standard.A1.Flex" \
      --shape-config "{\"ocpus\": $OCPU, \"memoryInGBs\": $MEM}" \
      --display-name "$NAME" \
      --image-id "$IMAGE" \
      --subnet-id "$SUBNET" \
      --assign-public-ip true \
      --ssh-authorized-keys-file "$SSH_PUB" \
      --boot-volume-size-in-gbs "$BOOT_GB" \
      --wait-for-state RUNNING \
      2>&1)
    RC=$?

    if [[ $RC -eq 0 ]]; then
      INST_ID=$(echo "$OUT" | grep -o 'ocid1.instance.oc1[^"]*' | head -1)
      echo "[$(ts)] ✅ 성공! A1.Flex ${OCPU}OCPU/${MEM}GB 확보."
      echo "[$(ts)] instance=$INST_ID"
      # 공개IP 조회
      PUBIP=$(oci compute instance list-vnics --instance-id "$INST_ID" --query 'data[0]."public-ip"' --raw-output 2>/dev/null)
      echo "[$(ts)] public-ip=$PUBIP"
      echo "$INST_ID" > /tmp/oci-arm-id.txt
      echo "$PUBIP"   > /tmp/oci-arm-pub-ip.txt
      echo "[$(ts)] === 다음 단계: ssh -i ~/.ssh/oci_instance ubuntu@$PUBIP ==="
      exit 0
    fi

    # 용량 부족/한도 외 에러 분류
    if echo "$OUT" | grep -qiE 'Out of host capacity|out of capacity|InternalError|too many requests|429|500'; then
      echo "[$(ts)]   ↳ 용량부족/일시오류 (${OCPU}/${MEM}). 다음 구성 폴백."
      continue
    elif echo "$OUT" | grep -qiE 'LimitExceeded|quota|already exists|exceeded the maximum'; then
      echo "[$(ts)]   ↳ 한도/중복 에러 — 루프 중단 (수동 확인 필요):"
      echo "$OUT" | tail -5
      exit 2
    else
      echo "[$(ts)]   ↳ 알 수 없는 에러 (${OCPU}/${MEM}):"
      echo "$OUT" | tail -5
      continue
    fi
  done

  echo "[$(ts)] 이번 라운드 전 구성 거절. ${sleep_s}s 후 재시도 (지수백오프)."
  sleep "$sleep_s"
  sleep_s=$(( sleep_s * 2 ))
  [[ $sleep_s -gt $SLEEP_MAX ]] && sleep_s=$SLEEP_MAX
done
