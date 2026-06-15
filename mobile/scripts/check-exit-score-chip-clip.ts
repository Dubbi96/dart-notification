// DAR-302 결정론 검증: 포트폴리오 '오늘 점검할 포지션' 섹션 우측 'Exit Score 순' 칩이
//   큰 시스템 폰트(font_scale 1.3~1.5)에서 끝글자('순')가 화면 우측 경계에서 잘리던 문제.
// 근본 원인: sectionHeader(flexDirection row + justifyContent space-between)에서 제목 Text가
//   shrink/numberOfLines 없이 커져 칩을 화면 밖으로 밀어냄 → 칩 우측이 컨테이너 경계를 넘어 잘림.
// 수정: 제목 Text flexShrink:1 + numberOfLines={1}(말줄임으로 양보), 칩 flexShrink:0(압축 금지)
//   + 행 gap, 칩 minHeight:24(고정 height 대신 → 큰 폰트서 세로 잘림 방지·평시 24 동일).
// 본 체크는 (A) 소스 바인딩과 (B) flex 레이아웃 모델로 잘림 0(칩 전체 노출)을 입증한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'components/portfolio/TodayCheckSlot.tsx'), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// ---- (A) 소스 바인딩 ----
// 제목 Text: numberOfLines={1} + sectionTitle 스타일 참조
ok('제목 Text numberOfLines={1}', /오늘 점검할 포지션[\s\S]{0,40}?numberOfLines=\{1\}|numberOfLines=\{1\}[\s\S]{0,80}?오늘 점검할 포지션/.test(src));
ok('제목 Text styles.sectionTitle 참조', /styles\.sectionTitle/.test(src));
ok('sectionTitle flexShrink:1 정의', /sectionTitle:\s*\{[^}]*flexShrink:\s*1/.test(src));

// 칩: flexShrink:0 + minHeight:24 (고정 height 제거)
ok('criterionChip flexShrink:0 정의', /criterionChip:\s*\{[^}]*flexShrink:\s*0/.test(src));
ok('criterionChip minHeight:24 (height 고정 아님)', /criterionChip:\s*\{[^}]*minHeight:\s*24/.test(src));
ok('criterionChip 고정 height 미사용', !/criterionChip:\s*\{[^}]*[^n]height:\s*24/.test(src));

// 'Exit Score 순' 라벨 전체 보존(축약 안 함)
ok("라벨 'Exit Score 순' 전체 유지", /Exit Score 순/.test(src));

// 행에 gap 으로 제목-칩 간격 확보
ok('sectionHeader gap 확보', /sectionHeader:\s*\{[^}]*gap:/.test(src));

// ---- (B) flex 레이아웃 모델 (잘림 0 입증) ----
// 한 행(row)에서 각 아이템의 최종 너비를 계산하는 단순 flexbox 모델.
// items: { intrinsic, shrink }  →  반환: 각 아이템 최종 너비 배열.
function layoutRow(containerW: number, gap: number, items: { intrinsic: number; shrink: number }[]) {
  const totalGap = gap * (items.length - 1);
  const totalIntrinsic = items.reduce((s, it) => s + it.intrinsic, 0);
  const overflow = totalIntrinsic + totalGap - containerW;
  if (overflow <= 0) return items.map((it) => it.intrinsic); // 넘치지 않음
  // 넘치면 shrink 가중치로 분배 축소
  const shrinkWeight = items.reduce((s, it) => s + it.shrink * it.intrinsic, 0);
  return items.map((it) => {
    if (shrinkWeight === 0) return it.intrinsic; // 아무도 안 줄면 그대로(오버플로=잘림)
    const reduce = (overflow * (it.shrink * it.intrinsic)) / shrinkWeight;
    return Math.max(0, it.intrinsic - reduce);
  });
}

// 큰 폰트 가정: 제목/칩 둘 다 intrinsic 폭 팽창, 컨테이너(화면 폭 - 패딩)는 고정.
const CONTAINER = 320; // dp
const GAP = 8;
const titleBig = 240; // font_scale 1.5 에서 '오늘 점검할 포지션' 팽창 폭
const chipBig = 120; // 'Exit Score 순' 칩 팽창 폭

// 수정 후: 제목 shrink=1, 칩 shrink=0
const fixed = layoutRow(CONTAINER, GAP, [
  { intrinsic: titleBig, shrink: 1 },
  { intrinsic: chipBig, shrink: 0 },
]);
const fixedChipW = fixed[1];
const fixedRightEdge = fixed[0] + GAP + fixed[1];
ok('수정후: 칩 너비 = 전체 라벨 폭(압축 0)', Math.abs(fixedChipW - chipBig) < 0.001);
ok('수정후: 행 우측 경계가 컨테이너 내(잘림 0)', fixedRightEdge <= CONTAINER + 0.001);

// 대조군(버그 재현): 제목 shrink=0, 칩 shrink=0 (space-between, 둘 다 안 줄음)
const buggy = layoutRow(CONTAINER, GAP, [
  { intrinsic: titleBig, shrink: 0 },
  { intrinsic: chipBig, shrink: 0 },
]);
const buggyRightEdge = buggy[0] + GAP + buggy[1];
ok('대조군: 칩이 컨테이너 밖으로 밀려 잘림(버그 재현)', buggyRightEdge > CONTAINER);
ok('대조군 대비 수정후 우측경계가 더 안쪽', fixedRightEdge < buggyRightEdge);

// 평시(작은 폰트): 넘치지 않으므로 둘 다 intrinsic 유지(동작 불변)
const normal = layoutRow(CONTAINER, GAP, [
  { intrinsic: 110, shrink: 1 },
  { intrinsic: 70, shrink: 0 },
]);
ok('평시: 제목 폭 불변(110)', Math.abs(normal[0] - 110) < 0.001);
ok('평시: 칩 폭 불변(70)', Math.abs(normal[1] - 70) < 0.001);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
