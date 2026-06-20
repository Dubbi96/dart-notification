// backend/src/storage-ops/bytes.ts
// DAR-397: 바이트 → 사람이 읽는 크기. 순수·결정론(로케일 비의존).

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

/**
 * 바이트를 1024 기반 단위로 포맷(소수 둘째자리, 정수 B 는 소수 없음).
 * 음수/비유한은 '0 B'. 예: 1740000000 → '1.62 GB'.
 */
export function humanBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 100) / 100;
  return `${rounded} ${UNITS[unit]}`;
}
