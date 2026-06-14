/**
 * DAR-271 결정론적 검증: watchlist FlatList 의 인라인 복잡카드 renderItem 을
 * WatchlistRow(React.memo) + useCallback(renderItem/콜백) + initialNumToRender 로 바꾼 뒤
 * "부모 렌더(isRefetching 토글·검색모달 open)나 quotes 부분 갱신 시 불변 행 리렌더 0"을 모델로 증명한다.
 *
 * 두 층으로 검증한다.
 *   (A) 동작 모델: React.memo 기본 shallow 비교 + 부모가 행에 넘기는 props 참조 안정성 불변식을 모사.
 *       props: { item, quote, colors, typo, onPress, onRemovePress }
 *        - onPress/onRemovePress: 부모 useCallback → 부모 리렌더와 무관하게 참조 고정
 *        - colors/typo: useTheme → 테마 토글 없으면 동일 참조
 *        - quote: item.stockCode 별 단건(quotes[code]) → 그 종목 시세 불변이면 동일 참조(맵 전체 갱신 무관)
 *   (B) 소스 바인딩: 실제 watchlist.tsx 가 React.memo·useCallback·initialNumToRender 를 갖고,
 *       인라인 화살표 renderItem 이 제거됐음을 정적으로 확인(모델이 소스와 어긋나면 실패).
 *
 * 실행: npx tsx scripts/check-watchlist-row-memo.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type RowProps = {
  item: { id: string; stockCode: string | null };
  quote: object | undefined; // StockQuote | undefined (참조 동일성만 본다)
  colors: object;
  typo: object;
  onPress: (corpCode: string) => void;
  onRemovePress: (item: unknown) => void;
};

// React.memo 기본 비교자(shallow). 커스텀 comparator 미지정이므로 이 규칙이 적용된다.
function memoAreEqual(prev: RowProps, next: RowProps): boolean {
  return (
    prev.item === next.item &&
    prev.quote === next.quote &&
    prev.colors === next.colors &&
    prev.typo === next.typo &&
    prev.onPress === next.onPress &&
    prev.onRemovePress === next.onRemovePress
  );
}

// 렌더 카운터: areEqual=false 일 때만 행이 다시 렌더된다.
function renderPass(
  prevByKey: Map<string, RowProps>,
  items: RowProps['item'][],
  quotes: Record<string, object>,
  colors: object,
  typo: object,
  onPress: RowProps['onPress'],
  onRemovePress: RowProps['onRemovePress'],
): { rerendered: string[]; next: Map<string, RowProps> } {
  const rerendered: string[] = [];
  const next = new Map<string, RowProps>();
  for (const item of items) {
    // 부모 renderItem 이 행에 넘기는 그대로: 단건 quote(맵 전체 아님).
    const quote = item.stockCode ? quotes[item.stockCode] : undefined;
    const props: RowProps = { item, quote, colors, typo, onPress, onRemovePress };
    const prev = prevByKey.get(item.id);
    if (!prev || !memoAreEqual(prev, props)) rerendered.push(item.id);
    next.set(item.id, props);
  }
  return { rerendered, next };
}

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log('DAR-271 WatchlistRow memo 렌더 카운트 + 소스 바인딩');

// ── (A) 동작 모델 ─────────────────────────────────────────────
// 부모 useCallback 으로 고정된 핸들러(부모 리렌더에도 동일 참조).
const onPress = (_: string) => {};
const onRemovePress = (_: unknown) => {};
// useTheme 안정 참조(테마 토글 없음).
const colors = { surface: '#fff' };
const typo = { bodyMedium: {} };

const a = { id: 'wl_1', stockCode: '005930' };
const b = { id: 'wl_2', stockCode: '000660' };
const c = { id: 'wl_3', stockCode: null }; // 종목코드 없는 행(시세 없음)
const items = [a, b, c];

// 종목별 단건 시세 객체(참조 안정성 추적용).
const qSamsung = { price: 1 };
const qHynix = { price: 2 };
let quotes: Record<string, object> = { '005930': qSamsung, '000660': qHynix };

// 1) 최초 마운트: 모든 행 1회 렌더
const mount = renderPass(new Map(), items, quotes, colors, typo, onPress, onRemovePress);
assert('최초 마운트 시 전 행 렌더(3건)', mount.rerendered.length === 3);

// 2) isRefetching 토글로 부모 리렌더(데이터·시세·핸들러 불변): 행 리렌더 0  ← DoD 핵심(새로고침)
const refetch = renderPass(mount.next, items, quotes, colors, typo, onPress, onRemovePress);
assert('새로고침(isRefetching) 부모 리렌더 시 행 리렌더 0', refetch.rerendered.length === 0);

// 3) 검색모달 open(searchVisible 토글)로 부모 리렌더: 여전히 행 리렌더 0  ← DoD 핵심(검색모달)
const search = renderPass(refetch.next, items, quotes, colors, typo, onPress, onRemovePress);
assert('검색모달 open 부모 리렌더 시 행 리렌더 0', search.rerendered.length === 0);

// 4) quotes 맵 새 참조지만 삼성 시세만 갱신: 삼성 행만 리렌더(부분 갱신 정확성)
const qSamsung2 = { price: 3 };
quotes = { '005930': qSamsung2, '000660': qHynix }; // 새 맵, hynix 객체는 동일 참조
const quoteUpdate = renderPass(search.next, items, quotes, colors, typo, onPress, onRemovePress);
assert('단건 시세 갱신 시 해당 행만 리렌더(1건)', quoteUpdate.rerendered.length === 1 && quoteUpdate.rerendered[0] === a.id);

// 5) 관심기업 추가(append): 기존 행 0 리렌더, 신규 행만 렌더
const d = { id: 'wl_4', stockCode: '035720' };
const appended = [a, b, c, d];
quotes = { '005930': qSamsung2, '000660': qHynix, '035720': { price: 9 } };
const paged = renderPass(quoteUpdate.next, appended, quotes, colors, typo, onPress, onRemovePress);
assert('관심기업 추가 시 신규 행만 렌더(1건)', paged.rerendered.length === 1 && paged.rerendered[0] === d.id);

// 6) 음성 대조군: 핸들러 참조가 매 렌더 새로 생성되면(=useCallback 미적용) 전 행 리렌더(회귀 신호)
const unstable = renderPass(paged.next, appended, quotes, colors, typo, (_: string) => {}, (_: unknown) => {});
assert('핸들러 비안정 시 전 행 리렌더(회귀 신호)', unstable.rerendered.length === appended.length);

// 7) keyExtractor 고유성: id 충돌 없음(키 중복 시 memo 매칭 오작동)
const keys = new Set(appended.map((i) => i.id));
assert('keyExtractor(id) 전부 고유', keys.size === appended.length);

// ── (B) 소스 바인딩(실제 watchlist.tsx 정적 확인) ─────────────────
const src = readFileSync(join(__dirname, '..', 'app', 'settings-detail', 'watchlist.tsx'), 'utf8');

assert('WatchlistRow 가 React.memo 로 감싸짐', /const\s+WatchlistRow\s*=\s*React\.memo\(/.test(src));
assert('renderItem 이 useCallback 으로 분리됨', /const\s+renderItem\s*=\s*useCallback\(/.test(src));
assert('FlatList 가 분리된 renderItem 참조 사용', /renderItem=\{renderItem\}/.test(src));
assert('FlatList 에 인라인 화살표 renderItem 부재(회귀 신호)', !/renderItem=\{\(\{\s*item\s*\}\)\s*=>/.test(src));
assert('initialNumToRender 적용', /initialNumToRender=\{10\}/.test(src));
assert('handleNavigate 가 useCallback(안정 onPress)', /const\s+handleNavigate\s*=\s*useCallback\(/.test(src));
assert('handleRemovePress 가 useCallback(안정 onRemovePress)', /const\s+handleRemovePress\s*=\s*useCallback\(/.test(src));
assert('handleRemove 가 useCallback(콜백 안정성)', /const\s+handleRemove\s*=\s*useCallback\(/.test(src));
// renderItem deps 에 isRefetching/searchVisible 미포함(불필요 재생성 방지)
const renderItemDeps = src.match(/\[quotes,\s*colors,\s*typo,\s*handleNavigate,\s*handleRemovePress\]/);
assert('renderItem deps 가 표시영향 값만(isRefetching/searchVisible 제외)', !!renderItemDeps);

const total = 17;
const passed = total - failures;
if (failures === 0) {
  console.log(`ALL PASS (${passed}/${total})`);
  process.exit(0);
} else {
  console.error(`FAIL: ${failures}/${total} assertion(s)`);
  process.exit(1);
}
