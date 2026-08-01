import * as SecureStore from 'expo-secure-store';

import type { DeviceEditionDecision } from '@utils/deviceRuleDecision';

const KEY_PREFIX = 'aos-device-receipt-v1:';

export interface CachedDeviceEditionReceipt {
  editionDate: string;
  savedAt: string;
  strategyVersionId: string;
  riskPolicyVersionId: string;
  headline: string;
  readyCount: number;
  checkCount: number;
  riskCount: number;
  unavailableCount: number;
  receipts: readonly {
    signalId: string;
    status: string;
    receiptHash: string;
  }[];
}

function key(date: string): string {
  return `${KEY_PREFIX}${date}`;
}

/** 민감정보·전체 시세는 저장하지 않고 마지막 version/hash 요약만 보관한다. */
export async function saveDeviceEditionReceipt(
  editionDate: string,
  decision: DeviceEditionDecision,
): Promise<void> {
  const first = decision.decisions[0];
  if (!first) return;
  const payload: CachedDeviceEditionReceipt = {
    editionDate,
    savedAt: new Date().toISOString(),
    strategyVersionId: first.evaluation.receipt.version.strategyVersionId,
    riskPolicyVersionId: first.evaluation.receipt.version.riskPolicyVersionId,
    headline: decision.headline,
    readyCount: decision.readyCount,
    checkCount: decision.checkCount,
    riskCount: decision.riskCount,
    unavailableCount: decision.unavailableCount,
    receipts: decision.decisions.slice(0, 5).map((item) => ({
      signalId: item.signalId,
      status: item.evaluation.receipt.status,
      receiptHash: item.receiptHash,
    })),
  };
  await SecureStore.setItemAsync(key(editionDate), JSON.stringify(payload));
}

export async function loadDeviceEditionReceipt(
  editionDate: string,
): Promise<CachedDeviceEditionReceipt | null> {
  const raw = await SecureStore.getItemAsync(key(editionDate));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedDeviceEditionReceipt;
  } catch {
    await SecureStore.deleteItemAsync(key(editionDate));
    return null;
  }
}
