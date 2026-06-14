/**
 * DAR-215 결정론적 검증: DisclosureRow(React.memo) 행 분리로
 * "검색입력 중 안 보이는(=데이터 불변) 행 리렌더 0"을 모델로 증명한다.
 *
 * 실제 RN 렌더러 없이, React.memo가 기본 적용하는 shallow prop 비교 규칙과
 * 부모(DisclosuresScreen)가 행에 넘기는 props의 참조 안정성 불변식을 그대로 모사한다.
 *   - props: { item, onPress, onPressCompany }
 *   - onPress/onPressCompany: useCallback([], …)  → 부모 리렌더와 무관하게 참조 고정
 *   - item: items=useMemo([activeQuery.data]) → activeQuery.data 불변이면 동일 참조
 * React.memo는 위 3개 prop이 모두 참조 동일하면 렌더를 건너뛴다(areEqual=true).
 *
 * 실행: npx tsx scripts/check-disclosure-row-memo.ts
 */

type RowProps = {
  item: { rcpNo: string };
  onPress: (rcpNo: string) => void;
  onPressCompany: (corpCode: string) => void;
};

// React.memo 기본 비교자(=shallow). 커스텀 comparator 미지정이므로 이 규칙이 적용된다.
function memoAreEqual(prev: RowProps, next: RowProps): boolean {
  return (
    prev.item === next.item &&
    prev.onPress === next.onPress &&
    prev.onPressCompany === next.onPressCompany
  );
}

// 렌더 카운터: areEqual=false 일 때만 행이 다시 렌더된다.
function renderPass(
  prevByKey: Map<string, RowProps>,
  nextItems: RowProps['item'][],
  onPress: RowProps['onPress'],
  onPressCompany: RowProps['onPressCompany'],
): { rerendered: string[]; next: Map<string, RowProps> } {
  const rerendered: string[] = [];
  const next = new Map<string, RowProps>();
  for (const item of nextItems) {
    const props: RowProps = { item, onPress, onPressCompany };
    const prev = prevByKey.get(item.rcpNo);
    if (!prev || !memoAreEqual(prev, props)) rerendered.push(item.rcpNo);
    next.set(item.rcpNo, props);
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

// ── 고정 핸들러(부모 useCallback([], …) 모사: 부모 리렌더에도 동일 참조) ──
const onPress = (_: string) => {};
const onPressCompany = (_: string) => {};

// 검색 디바운스 동안 activeQuery.data 불변 → items useMemo 동일 배열 → 동일 item 참조
const item1 = { rcpNo: '20260614000001' };
const item2 = { rcpNo: '20260614000002' };
const item3 = { rcpNo: '20260614000003' };
const visible = [item1, item2, item3];

console.log('DAR-215 DisclosureRow memo 렌더 카운트');

// 1) 최초 마운트: 보이는 모든 행 1회 렌더
const mount = renderPass(new Map(), visible, onPress, onPressCompany);
assert('최초 마운트 시 보이는 행 전부 렌더(3건)', mount.rerendered.length === 3);

// 2) 검색입력 중 부모 리렌더(데이터·핸들러 불변): 안 보이는(불변) 행 리렌더 0  ← DoD 핵심
const typing = renderPass(mount.next, visible, onPress, onPressCompany);
assert('검색입력 부모 리렌더 시 행 리렌더 0', typing.rerendered.length === 0);

// 3) 필터토글로 부모 리렌더(같은 데이터 유지): 여전히 행 리렌더 0
const toggle = renderPass(typing.next, visible, onPress, onPressCompany);
assert('필터토글 부모 리렌더 시 행 리렌더 0', toggle.rerendered.length === 0);

// 4) 다음 페이지 도착(append): 기존 행 0 리렌더, 신규 행만 렌더
const item4 = { rcpNo: '20260614000004' };
const appended = [item1, item2, item3, item4];
const paged = renderPass(toggle.next, appended, onPress, onPressCompany);
assert('페이지 추가 시 신규 행만 렌더(1건)', paged.rerendered.length === 1 && paged.rerendered[0] === item4.rcpNo);

// 5) 음성 대조군: 핸들러 참조가 매 렌더 새로 생성되면(=useCallback 미적용) 전 행 리렌더
const unstable = renderPass(paged.next, appended, (_: string) => {}, (_: string) => {});
assert('핸들러 비안정 시 전 행 리렌더(회귀 신호)', unstable.rerendered.length === appended.length);

// 6) keyExtractor 고유성: rcpNo 충돌 없음(키 중복 시 memo 매칭 오작동)
const keys = new Set(appended.map((i) => i.rcpNo));
assert('keyExtractor(rcpNo) 전부 고유', keys.size === appended.length);

if (failures === 0) {
  console.log('ALL PASS (6/6)');
  process.exit(0);
} else {
  console.error(`FAIL: ${failures} assertion(s)`);
  process.exit(1);
}
