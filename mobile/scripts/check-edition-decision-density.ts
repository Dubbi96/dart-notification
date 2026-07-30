/**
 * DAR-570 결정론적 검증 — 에디션 판단 화면의 정보 위계·좁은 폭·상태별 밀도.
 *
 * 실제 320/360px 브라우저 압박 검증에서 확인한 회귀 위험을 소스 불변식으로 고정한다.
 * - 긴 회사명과 메타 정보가 상태 배지와 폭을 다투지 않는다.
 * - 요약 수치는 큰 3열 통계 대신 줄바꿈 가능한 작은 지표로 표시한다.
 * - 단타 수치는 조건 충족·리스크 없음일 때만 표시한다.
 * - 좁은 폭에서도 단타 수치 3개는 고정 3열로 정렬한다.
 * - 판단 근거와 행동 문구는 화면 밀도를 제한하되 접근성 라벨에는 전문을 유지한다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

let failed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) failed += 1;
  console.log(`${condition ? 'PASS' : 'FAIL'} | ${label}`);
}

const model = read('utils/editionDecision.ts');
const card = read('components/signals/EditionDecisionCard.tsx');
const summary = read('components/signals/EditionDecisionSummary.tsx');

check(
  '단기 시나리오 = 조건 충족 + 리스크 없음 + 정본 최소점수',
  /hasShortMomentumScenario:\s*ready\s*&&\s*!hasRisk\s*&&\s*signal\.buyScore\s*>=/.test(model),
);
check(
  '리스크가 미충족 조건보다 진입 안내에서 우선',
  /const entryGuide = hasRisk\s*\?\s*riskFlags\[0\]\.label/.test(model),
);
check(
  '미충족 조건을 행동·중단 기준에 중복 노출하지 않음',
  model.includes("'위 조건이 충족되지 않으면 진입 보류'"),
);

check(
  '헤더는 회사명 영역과 상태 행을 분리',
  card.includes('styles.titleWrap') &&
    card.includes('styles.verdictRow') &&
    card.indexOf('styles.verdictRow') > card.indexOf('</View>\n\n        <View'),
);
check(
  '긴 회사명은 최대 2줄, 메타는 1줄 말줄임·점수는 온전 표시',
  /styles\.corpName[\s\S]{0,140}?numberOfLines=\{2\}/.test(card) &&
    /styles\.metaText[\s\S]{0,180}?numberOfLines=\{1\}[\s\S]{0,80}?ellipsizeMode="tail"/.test(
      card,
    ) &&
    /styles\.metaScore[\s\S]{0,140}?MAX_CHIP_FONT_SCALE/.test(card) &&
    !/styles\.metaScore[\s\S]{0,140}?numberOfLines/.test(card),
);
check(
  '판단 근거와 행동 문구는 각각 최대 2줄',
  /styles\.rationale[\s\S]{0,140}?numberOfLines=\{2\}/.test(card) &&
    /styles\.entryGuide[\s\S]{0,140}?numberOfLines=\{2\}/.test(card),
);
check(
  '단기 기준은 준비 카드에만 조건부 렌더',
  /\{plan\.hasShortMomentumScenario\s*\?\s*\(/.test(card) &&
    card.includes('조건 유지 시 단기 기준'),
);
check(
  '대기 카드는 단타 수치 대신 중단 안내 렌더',
  card.includes('필수 조건이 충족되기 전에는 진입하지 않아요.') &&
    card.includes('리스크가 해소되기 전에는 진입하지 않아요.'),
);
check(
  '단기 수치 3개는 좁은 폭 고정 3열',
  /planMetrics:\s*\{[\s\S]*?flexDirection:\s*'row'[\s\S]*?\}/.test(card) &&
    !/planMetrics:\s*\{[\s\S]*?flexWrap:\s*'wrap'[\s\S]*?\}/.test(card) &&
    /planMetric:\s*\{[\s\S]*?flex:\s*1,[\s\S]*?minWidth:\s*0,[\s\S]*?\}/.test(card),
);
check(
  '구형 고밀도 섹션·4칸 시나리오 제거',
  !card.includes('SectionLabel') &&
    !card.includes('GuideRow') &&
    !card.includes('ScenarioCell') &&
    !card.includes('scenarioGrid'),
);

check(
  '요약 수치는 줄바꿈 가능한 작은 지표',
  /metrics:\s*\{[\s\S]*?flexWrap:\s*'wrap'[\s\S]*?\}/.test(summary) &&
    summary.includes('styles.metric'),
);
check(
  '요약 헤드라인·설명·우선 판단의 최대 줄 수 고정',
  /styles\.headline[\s\S]{0,140}?numberOfLines=\{2\}/.test(summary) &&
    /styles\.description[\s\S]{0,140}?numberOfLines=\{2\}/.test(summary) &&
    /decision\.topPriority[\s\S]{0,160}?numberOfLines=\{3\}|numberOfLines=\{3\}[\s\S]{0,160}?decision\.topPriority/.test(
      summary,
    ),
);

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed} 실패`);
process.exit(failed === 0 ? 0 : 1);
