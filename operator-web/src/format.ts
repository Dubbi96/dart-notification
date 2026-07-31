export function formatMoney(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(number)}원`;
}
export function formatDate(value: unknown, withTime = true): string {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('ko-KR', withTime ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' }).format(date);
}

export function shortHash(value: unknown): string {
  const text = String(value ?? '');
  return text.length > 14 ? `${text.slice(0, 8)}…${text.slice(-4)}` : text || '—';
}

export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (['ACTIVE', 'PASSED', 'MATCHED', 'SUCCESS', 'SUCCEEDED', 'FILLED', 'APPROVED', 'COMPLETED'].includes(status)) return 'good';
  if (['FAILED', 'BROKEN', 'REJECTED', 'CRITICAL', 'BLOCKED'].includes(status)) return 'bad';
  if (['PENDING', 'PARTIAL', 'APPROVAL_PENDING', 'BACKTESTED', 'SCHEDULED', 'OPEN', 'SKIPPED'].includes(status)) return 'warn';
  return 'neutral';
}
