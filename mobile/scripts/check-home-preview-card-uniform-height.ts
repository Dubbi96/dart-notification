/**
 * live-readiness wave1 결정론 검증 — 홈 '오늘의 투자판단' 카드 3장 균일 높이(슬롯 예약) +
 * '표본 N건' 의미 고정(historicalEvent 직접 참조).
 *
 * 진단 확정 결함:
 *  ① 높이 불균일 — '표본 N건' 행이 sampleN 부재 시 미렌더(≈24px 편차),
 *     ScoreGauge '다음 등급까지 +N' 캡션 조건부(≈20px 편차), oneLiner 줄수 미고정.
 *  ② 표본 의미 불명 — representativeSampleN 이 scoreBreakdown[].sampleN 의 max 집계.
 *
 * 수정(슬롯 예약 — 고정 height 금지, 글꼴 배율 안전):
 *  1) 표본 행 슬롯 상시 렌더 — 표본 없으면 동일 지오메트리의 '표본 통계 없음'(textTertiary 정직 결측).
 *  2) ScoreGauge reserveCaptionSpace — 캡션 없어도 같은 typo.small 한 줄 자리(NBSP) 확보.
 *     카루셀(HomeSignalPreview)에서만 ON — 다른 사용처 시각 불변(기본 false).
 *  3) oneLiner numberOfLines={1} + MAX_CHIP_FONT_SCALE 캡(기존 DAR-174 패턴).
 *  4) 표본 의미 고정 — historicalEvent 항목 직접 참조(max 집계 제거) + 백엔드 후속 sampleScope
 *     옵셔널 방어 지원('표본 1,871건 · 대규모 공급계약(전체시장)' 병기, EVENT_TYPE_LABEL 재사용).
 *
 * Run: npx tsx scripts/check-home-preview-card-uniform-height.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}`);
  }
}

// ───────────────────────── (A) 동작 모델 — 슬롯 예약 = 카드 간 세로 슬롯 동일 ─────────────────────────
// 카드 세로 구성(헤더/게이지/캡션/oneLiner/표본행/푸터)을 렌더 규칙 그대로 재현해,
// before(조건부 렌더) 는 데이터에 따라 편차가 나고 after(슬롯 예약) 는 항상 동일함을 증명한다.
interface CardData {
  sampleN?: number;
  /** ScoreGauge nextCutGap 결과('+N' | null) — 최상위 등급 컷 이상이면 null. */
  nextGap: string | null;
  oneLinerText: string;
}

// 카드 폭 근사(글자수/줄) — oneLiner 줄수 편차 모델링용. 실제 픽셀이 아니라 '줄수 결정' 모델.
const CHARS_PER_LINE = 18;

function slotProfile(card: CardData, mode: 'before' | 'after') {
  const reserve = mode === 'after';
  // 1) 표본 행: before=있을 때만 1행 / after=없어도 결측 행 1행(슬롯 상시).
  const evidenceRows = typeof card.sampleN === 'number' && card.sampleN > 0 ? 1 : reserve ? 1 : 0;
  // 2) 캡션 행: before=nextGap 있을 때만 / after=reserveCaptionSpace 로 상시 1행.
  const captionRows = card.nextGap !== null ? 1 : reserve ? 1 : 0;
  // 3) oneLiner: before=줄수 미고정(내용 따라 1~2줄) / after=numberOfLines={1} 고정.
  const oneLinerLines = reserve ? 1 : Math.max(1, Math.ceil(card.oneLinerText.length / CHARS_PER_LINE));
  return { evidenceRows, captionRows, oneLinerLines };
}

// 이질적인 카드 3장: (표본O·캡션O·짧은 oneLiner) / (표본X·캡션O·긴 oneLiner) / (표본O·캡션X — 최상위 등급).
const cards: CardData[] = [
  { sampleN: 1871, nextGap: '+4', oneLinerText: '매수 구간 (참고)' },
  { sampleN: undefined, nextGap: '+2', oneLinerText: '과거 유사 공시 성과가 좋았던 구간 (참고)' },
  { sampleN: 254, nextGap: null, oneLinerText: '강한매수 구간 (참고)' },
];

{
  const before = cards.map((c) => slotProfile(c, 'before'));
  const after = cards.map((c) => slotProfile(c, 'after'));
  const same = (xs: number[]) => xs.every((x) => x === xs[0]);

  // before: 결함 재현 — 표본행/캡션행/줄수가 카드마다 다르다(높이 불균일 ①).
  check('before 재현: 표본 행 유무가 카드마다 다름(≈24px 편차)', !same(before.map((p) => p.evidenceRows)));
  check('before 재현: 캡션 행 유무가 카드마다 다름(≈20px 편차)', !same(before.map((p) => p.captionRows)));
  check('before 재현: oneLiner 줄수가 카드마다 다름', !same(before.map((p) => p.oneLinerLines)));

  // after: 슬롯 예약 — 세 슬롯 모두 카드 간 동일(균일 높이).
  check('after: 표본 행 카드 간 동일(상시 1행)', same(after.map((p) => p.evidenceRows)) && after[0].evidenceRows === 1);
  check('after: 캡션 행 카드 간 동일(상시 1행)', same(after.map((p) => p.captionRows)) && after[0].captionRows === 1);
  check('after: oneLiner 1줄 고정', same(after.map((p) => p.oneLinerLines)) && after[0].oneLinerLines === 1);
  // 고정 height 금지: 슬롯은 텍스트 라인 예약이라 글꼴 배율 s 에서도 모든 카드가 같은 배율을 받아 동일.
  check(
    'after: 글꼴 배율과 무관 — 슬롯 수 자체가 동일(고정 px 아님)',
    after.every((p) => p.evidenceRows + p.captionRows + p.oneLinerLines === 3),
  );
}

// (A2) 표본 의미 고정 모델(진단 ②) — 소스와 동일 규칙: historicalEvent 항목 직접 참조.
interface BreakdownItem {
  key: string;
  sampleN?: number;
  sampleScope?: string;
}
function evidenceModel(
  breakdown: BreakdownItem[] | undefined,
  eventType: string | undefined,
  label: (t: string) => string,
): { n: number; scopeLabel?: string } | undefined {
  const item = (breakdown ?? []).find((c) => c.key === 'historicalEvent');
  if (!item || typeof item.sampleN !== 'number' || item.sampleN <= 0) return undefined;
  const scopeLabel = item.sampleScope
    ? eventType
      ? `${label(eventType)}(${item.sampleScope})`
      : item.sampleScope
    : undefined;
  return { n: item.sampleN, scopeLabel };
}
const LABEL = (t: string) => (t === 'SUPPLY_CONTRACT' ? '대규모 공급계약' : '기타');
{
  // max 집계였다면 999(비통계 항목)가 이겼을 데이터 — 직접 참조는 historicalEvent(254)를 고정 선택.
  const mixed: BreakdownItem[] = [
    { key: 'chart', sampleN: 999 },
    { key: 'historicalEvent', sampleN: 254 },
  ];
  const r = evidenceModel(mixed, 'SUPPLY_CONTRACT', LABEL);
  check('의미 고정: max(999) 가 아닌 historicalEvent(254) 선택', r?.n === 254);
  check('의미 고정: sampleScope 미도착 → scopeLabel 없음(현행 표기 유지)', r?.scopeLabel === undefined);
}
{
  const withScope: BreakdownItem[] = [{ key: 'historicalEvent', sampleN: 1871, sampleScope: '전체시장' }];
  const r = evidenceModel(withScope, 'SUPPLY_CONTRACT', LABEL);
  check(
    "sampleScope 방어 지원: '대규모 공급계약(전체시장)' 병기 라벨 생성",
    r?.scopeLabel === '대규모 공급계약(전체시장)',
  );
  const noEvent = evidenceModel(withScope, undefined, LABEL);
  check('sampleScope 방어 지원: eventType 부재 시 스코프만 표기', noEvent?.scopeLabel === '전체시장');
  check("표기 형식: '표본 1,871건' 천단위 구분", `표본 ${(1871).toLocaleString('ko-KR')}건` === '표본 1,871건');
}
{
  check('historicalEvent 부재 → undefined(정직 결측 행으로 폴백)', evidenceModel([{ key: 'chart' }], 'SUPPLY_CONTRACT', LABEL) === undefined);
  check('sampleN 0 이하 → undefined(가짜 표본 금지)', evidenceModel([{ key: 'historicalEvent', sampleN: 0 }], 'SUPPLY_CONTRACT', LABEL) === undefined);
}

// ───────────────────────── (B) 소스 바인딩 ─────────────────────────
const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const home = read('components/home/HomeSignalPreview.tsx');
const gaugeSrc = read('components/common/ScoreGauge.tsx');
const evidenceSrc = read('components/common/EvidenceMeta.tsx');
const typesSrc = read('types/signal.types.ts');

console.log('\n— (B1) HomeSignalPreview: 슬롯 상시 렌더 + 표본 의미 고정 —');
check('표본 의미: HISTORICAL_EVENT_KEY 상수 고정', /const\s+HISTORICAL_EVENT_KEY\s*=\s*'historicalEvent'/.test(home));
check('표본 의미: key === HISTORICAL_EVENT_KEY 직접 참조(find)', /find\(\(c\)\s*=>\s*c\.key\s*===\s*HISTORICAL_EVENT_KEY\)/.test(home));
check('표본 의미: max 집계 제거(Math.max/reduce 부재)', !/Math\.max/.test(home) && !/representativeSampleN/.test(home));
check('슬롯 상시: EvidenceMeta 가 조건부 래핑 없이 렌더(sampleFallback 동반)', /<EvidenceMeta\s[\s\S]{0,240}sampleFallback="표본 통계 없음"/.test(home) && !/sampleN\s*!==\s*undefined\s*\?\s*\(\s*<EvidenceMeta/.test(home));
check('슬롯 상시: 게이지 캡션 자리 예약 ON(reserveCaptionSpace)', /<ScoreGauge[\s\S]{0,400}reserveCaptionSpace/.test(home));
check('슬롯 상시: oneLiner 1줄 고정(oneLinerNumberOfLines={1})', /<ScoreGauge[\s\S]{0,400}oneLinerNumberOfLines=\{1\}/.test(home));
check('sampleScope 방어: item.sampleScope 참조', /item\.sampleScope/.test(home));
check('sampleScope 방어: EVENT_TYPE_LABEL 재사용(getEventTypeLabel import)', /import\s*\{\s*getEventTypeLabel\s*\}\s*from\s*'@utils\/disclosureType'/.test(home) && /getEventTypeLabel\(signal\.eventType\)/.test(home));

console.log('\n— (B2) ScoreGauge: 캡션 자리 예약 옵션(기본 OFF — 다른 사용처 불변) —');
check('prop: reserveCaptionSpace?: boolean 정의', /reserveCaptionSpace\?\s*:\s*boolean/.test(gaugeSrc));
check('prop: oneLinerNumberOfLines?: number 정의', /oneLinerNumberOfLines\?\s*:\s*number/.test(gaugeSrc));
check('기본 OFF: reserveCaptionSpace = false', /reserveCaptionSpace\s*=\s*false/.test(gaugeSrc));
check('캡션 슬롯: nextGap || reserveCaptionSpace 게이트', /nextGap\s*\|\|\s*reserveCaptionSpace/.test(gaugeSrc));
check("플레이스홀더: NBSP('\\u00A0') — 같은 typo.small 라인 예약(고정 px 아님)", /CAPTION_PLACEHOLDER\s*=\s*'\\u00A0'/.test(gaugeSrc) && /:\s*CAPTION_PLACEHOLDER/.test(gaugeSrc));
check('캡션 문구 보존: 다음 등급까지 {nextGap}', /다음 등급까지 \{nextGap\}/.test(gaugeSrc));
check('캡션 예약 시 1줄 + 배율 캡(줄바꿈 편차 차단)', /numberOfLines=\{reserveCaptionSpace \? 1 : undefined\}/.test(gaugeSrc) && /maxFontSizeMultiplier=\{reserveCaptionSpace \? MAX_CHIP_FONT_SCALE : undefined\}/.test(gaugeSrc));
check('oneLiner: numberOfLines={oneLinerNumberOfLines} 바인딩', /numberOfLines=\{oneLinerNumberOfLines\}/.test(gaugeSrc));
check('oneLiner: 지정 시 MAX_CHIP_FONT_SCALE 캡(DAR-174 패턴)', /maxFontSizeMultiplier=\{oneLinerNumberOfLines !== undefined \? MAX_CHIP_FONT_SCALE : undefined\}/.test(gaugeSrc));
check('MAX_CHIP_FONT_SCALE @theme import', /import\s*\{[^}]*MAX_CHIP_FONT_SCALE[^}]*\}\s*from\s*'@theme'/.test(gaugeSrc));

// 다른 사용처 시각 불변: 카루셀 외 ScoreGauge 호출부는 reserveCaptionSpace 미전달.
const otherGaugeCallers = [
  'app/intro/index.tsx',
  'app/signals/[id].tsx',
  'components/signals/BuyScoreCard.tsx',
  'components/signals/ExitScoreCard.tsx',
  'components/signals/CuratedSignalCard.tsx',
  'components/portfolio/TodayCheckSlot.tsx',
  'components/company/DecisionHubTab.tsx',
];
for (const p of otherGaugeCallers) {
  check(`불변: ${p} 은 reserveCaptionSpace 미사용`, !/reserveCaptionSpace/.test(read(p)));
}

console.log('\n— (B3) EvidenceMeta: 정직 결측 행 + 스코프 병기(규약 정합) —');
check('prop: sampleFallback?: string 정의', /sampleFallback\?\s*:\s*string/.test(evidenceSrc));
check('결측 행: 동일 지오메트리(MetaRow 재사용, key="sample-missing")', /<MetaRow[\s\S]{0,40}key="sample-missing"/.test(evidenceSrc));
check('결측 행: textTertiary(정직 결측 톤)', /key="sample-missing"[\s\S]{0,200}textColor=\{colors\.textTertiary\}/.test(evidenceSrc));
check('결측 행: text={sampleFallback}', /text=\{sampleFallback\}/.test(evidenceSrc));
check('스코프 병기: EvidenceSample.scopeLabel 옵셔널', /scopeLabel\?\s*:\s*string/.test(evidenceSrc));
check("스코프 병기: note='· {scopeLabel}' (보조 주석 패턴)", /note=\{sample\.scopeLabel \? `· \$\{sample\.scopeLabel\}` : undefined\}/.test(evidenceSrc));
check('스코프 병기: 1줄 고정(noteLines={1}) — 행 높이 균일', /noteLines=\{1\}/.test(evidenceSrc));
check("표본 표기: 천단위 구분 toLocaleString('ko-KR')", /sample\.n\.toLocaleString\('ko-KR'\)/.test(evidenceSrc));
check('규약 보존: 단정 없는 중립 표기(표본 N…) 유지', /`표본 \$\{sample\.n\.toLocaleString\('ko-KR'\)\}\$\{unit\}`/.test(evidenceSrc));

console.log('\n— (B4) 타입 계약: sampleScope 옵셔널(방어적 지원) —');
check('BuyScoreComponent.sampleScope?: string', /sampleN\?\s*:\s*number;[\s\S]{0,400}sampleScope\?\s*:\s*string/.test(typesSrc));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
