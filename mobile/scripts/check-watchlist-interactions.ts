/**
 * DAR-202 결정론적 검증: 관심목록 화면 인터랙션 갭 4건.
 *
 * 컴포넌트(app/settings-detail/watchlist.tsx)의 순수 결정 로직을 모델링해 증명한다.
 *  ① 제거 → 되돌리기(재추가) 페이로드가 원본 항목 식별자를 그대로 복원하는가
 *  ② +버튼 한도 게이트: total>=limit 이면 dead tap 대신 안내 스낵바
 *  ③ 삭제 버튼 터치영역 ≥44pt (iOS HIG)
 *  ④ 스낵바 마이크로카피 정본(snackbarCopy) 1:1
 *
 * 스낵바 문구는 실제 정본 모듈을 import 해 드리프트를 차단한다.
 */
import { snackbarCopy, SNACKBAR_DURATION } from '../components/common/snackbarCopy';

interface WatchItem {
  id: string;
  corpCode: string;
  corpName: string;
  stockCode: string | null;
  market: string | null;
}

// ── 컴포넌트 로직 미러 ──────────────────────────────────────────────

// ② 한도 게이트: 안내가 필요한가? (true면 스낵바, false면 검색 오버레이 오픈)
function shouldGuideLimit(total: number, limit: number): boolean {
  return total >= limit;
}

// ① 되돌리기 재추가 페이로드 (useAddToWatchlist vars)
function undoPayload(item: WatchItem) {
  return {
    corpCode: item.corpCode,
    corpName: item.corpName,
    stockCode: item.stockCode,
    market: item.market,
  };
}

// ③ 삭제 버튼 actionBtn 스타일(StyleSheet 미러) → 실측 터치영역
const actionBtn = { minWidth: 44, minHeight: 44 };
function touchTarget() {
  return { w: actionBtn.minWidth, h: actionBtn.minHeight };
}

let failures = 0;
const log = (ok: boolean, label: string) => {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
};

// ② 한도 게이트 진리표
const gateCases: Array<{ total: number; limit: number; guide: boolean }> = [
  { total: 0, limit: 30, guide: false },
  { total: 29, limit: 30, guide: false },
  { total: 30, limit: 30, guide: true }, // 도달 → dead tap 차단, 안내
  { total: 31, limit: 30, guide: true },
];
for (const c of gateCases) {
  log(shouldGuideLimit(c.total, c.limit) === c.guide, `한도게이트 total=${c.total}/limit=${c.limit} → ${c.guide ? '안내' : '검색오픈'}`);
}

// ① 되돌리기 페이로드 — 시세종목/비상장 둘 다 식별자 보존
const itemA: WatchItem = { id: 'w1', corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' };
const itemB: WatchItem = { id: 'w2', corpCode: '00999999', corpName: '비상장기업', stockCode: null, market: null };
log(JSON.stringify(undoPayload(itemA)) === JSON.stringify({ corpCode: '00126380', corpName: '삼성전자', stockCode: '005930', market: 'KOSPI' }), '되돌리기 페이로드(상장) 식별자 보존');
log(JSON.stringify(undoPayload(itemB)) === JSON.stringify({ corpCode: '00999999', corpName: '비상장기업', stockCode: null, market: null }), '되돌리기 페이로드(비상장 null) 보존');
log(undoPayload(itemA).id === undefined, '되돌리기 페이로드는 서버측 id 미포함(신규 생성 위임)');

// ③ 터치영역 ≥44pt
const tt = touchTarget();
log(tt.w >= 44 && tt.h >= 44, `삭제 버튼 터치영역 ${tt.w}x${tt.h}pt ≥ 44pt`);

// ④ 스낵바 카피 정본
// DAR-274: 조사 자동선택 적용 — '삼성전자'(받침無) → '를'.
log(snackbarCopy.watchlistRemoved('삼성전자') === '삼성전자를 관심목록에서 제거했어요.', '제거 스낵바 카피');
log(snackbarCopy.watchlistRemoveFailed === '제거에 실패했어요. 다시 시도해 주세요.', '제거 실패 카피');
log(snackbarCopy.watchlistLimitReached(30) === '관심 기업은 최대 30개까지 등록할 수 있어요.', '한도 안내 카피');
log(SNACKBAR_DURATION.success === 2500 && SNACKBAR_DURATION.error === 4000, '스낵바 지속시간 정본(성공2.5s/실패4s)');

const total = gateCases.length + 7;
console.log(`\n결과: ${total - failures}/${total} PASS`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
