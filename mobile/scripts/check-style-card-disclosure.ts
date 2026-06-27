/**
 * DAR-194 결정론적 검증: 스타일 비교 카드 7지표 그리드 과밀 → 핵심3 상시 + 전문4 접기.
 *
 * 버그(수정 전): StyleCard statGrid 가 7개 StatPair(승률·누적수익·보유포지션·신호적중률D+5·
 *   Sharpe·MDD·vsKOSPI)를 모두 동일 weight(라벨 small / 값 captionMedium)로 2열 적층.
 *   카드 순위를 정하는 누적수익을 Sharpe·MDD·vsKOSPI 같은 전문/희귀 지표가 묻음.
 *   ComparisonHeader 도 저표본 caveat·진입기준을 4줄 평문 적층.
 *
 * 수정 후:
 *   1) primaryRow 에 핵심 3지표(누적수익·승률·보유 포지션)만 상시 노출, 값은 typo.body+bold.
 *   2) 나머지 4 전문지표는 InlineDisclosure(기본 접힘, 한 탭 뒤)로 숨김.
 *   3) ComparisonHeader 의 저표본 경고+진입기준은 InlineDisclosure(info/alert-triangle)로.
 *
 * 시각/JSX 구조 변경이므로 소스 정적 단언으로 진리표를 고정한다(결정론·재실행 가능).
 * 실행: npx ts-node --compiler-options '{"module":"commonjs"}' scripts/check-style-card-disclosure.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(
  join(__dirname, '../components/portfolio/StyleComparisonSection.tsx'),
  'utf8',
);
// DAR-472: 로컬 InlineDisclosure 를 공용 컴포넌트로 추출. 토글 내부 불변식(a11y expanded·44pt)은
// 공용 컴포넌트에서 검증하고, StyleComparisonSection 은 import + 사용(accent/defaultExpanded)만 본다.
const SHARED_DISCLOSURE = readFileSync(
  join(__dirname, '../components/common/InlineDisclosure.tsx'),
  'utf8',
);

type Case = { name: string; pass: boolean; detail: string };
const cases: Case[] = [];
function check(name: string, pass: boolean, detail: string) {
  cases.push({ name, pass, detail });
}

// 카운트 헬퍼
const count = (re: RegExp) => (SRC.match(re) ?? []).length;

// 1차 핵심 3지표가 primaryRow 에 PrimaryStat 으로 정확히 3개
const primaryStats = count(/<PrimaryStat\b/g);
check('핵심 지표 3개만 상시 노출(PrimaryStat ×3)', primaryStats === 3, `PrimaryStat=${primaryStats}`);

// 핵심 3지표 라벨 정확성
const PRIMARY_LABELS = ['누적수익', '승률', '보유 포지션'];
for (const label of PRIMARY_LABELS) {
  const inPrimary = new RegExp(`<PrimaryStat[^>]*label="${label}"`).test(SRC)
    || new RegExp(`<PrimaryStat[\\s\\S]*?label="${label}"[\\s\\S]*?\\/>`).test(SRC);
  check(`핵심 지표 라벨 노출: ${label}`, inPrimary, inPrimary ? 'primaryRow' : '누락');
}

// 2차 전문 4지표는 StatPair 로 InlineDisclosure 안에 존재(기본 접힘)
const DETAIL_LABELS = ['신호 적중률(D+5)', 'Sharpe', 'MDD', 'vs KOSPI'];
const discIdx = SRC.indexOf('<InlineDisclosure');
const styleDiscBlock = SRC.slice(discIdx);
for (const label of DETAIL_LABELS) {
  const present = styleDiscBlock.includes(`label="${label}"`) || styleDiscBlock.includes(`label="${label}`)
    || new RegExp(`label="${label.replace(/[()+]/g, '\\$&')}"`).test(styleDiscBlock);
  check(`전문 지표 접기 뒤 배치: ${label}`, present, present ? 'InlineDisclosure' : '누락');
}

// 전문 지표는 더 이상 primaryRow 와 동렬로 상시 노출되지 않음(StatPair 4개만 남음)
const statPairs = count(/<StatPair\b/g);
check('상시 그리드에서 전문지표 제거(StatPair ×4, 7 아님)', statPairs === 4, `StatPair=${statPairs}`);

// InlineDisclosure 는 기본 접힘(defaultExpanded 미지정 또는 false) — 한 탭 뒤
const usesDefaultExpandedTrue = /<InlineDisclosure[^>]*defaultExpanded(\s*=\s*\{?\s*true)/.test(SRC);
check('상세 지표 기본 접힘(한 탭 뒤)', !usesDefaultExpandedTrue, usesDefaultExpandedTrue ? 'defaultExpanded=true 발견' : '기본 접힘');

// 값 위계 강화: PrimaryStat 값은 typo.body + bold(primaryValue: fontWeight '700')
const valueHierarchy = /typo\.body, styles\.primaryValue/.test(SRC) && /primaryValue:\s*\{\s*fontWeight:\s*'700'/.test(SRC);
check('값 위계 강화(typo.body + bold 700)', valueHierarchy, valueHierarchy ? 'primaryValue bold' : '미적용');

// 공용 InlineDisclosure 채택(로컬 중복 제거) + 토글 접근성 + 44pt 터치영역(공용 컴포넌트에서 검증)
const usesShared = /from '@components\/common\/InlineDisclosure'/.test(SRC) && !/function InlineDisclosure/.test(SRC);
const a11yExpanded = /accessibilityState=\{\{ expanded \}\}/.test(SHARED_DISCLOSURE);
const touch44 = /discHeader:\s*\{[\s\S]*?minHeight:\s*sizing\.minTouchTarget/.test(SHARED_DISCLOSURE);
check('공용 InlineDisclosure 채택(로컬 정의 제거)', usesShared, usesShared ? 'import' : '로컬 정의 잔존');
check('접기 토글 a11y expanded 상태', a11yExpanded, a11yExpanded ? 'accessibilityState' : '누락');
check('접기 토글 44pt 터치영역', touch44, touch44 ? 'minHeight minTouchTarget' : '누락');

// ComparisonHeader 의 저표본 caveat·진입기준이 InlineDisclosure 로 이동(평문 적층 제거)
const headerUsesDisclosure = /icon=\{[\s\S]*?'alert-triangle'[\s\S]*?'info'/.test(SRC) || /icon=\{data\.ranking\.allLowSample \? 'alert-triangle' : 'info'\}/.test(SRC);
check('헤더 caveat/기준 접기화(alert-triangle/info)', headerUsesDisclosure, headerUsesDisclosure ? 'InlineDisclosure' : '미이동');
// 저표본일 때 경고색(accent)으로 시인성 유지(경고 자체를 숨기지 않음)
const accentOnLowSample = /accent=\{data\.ranking\.allLowSample\}/.test(SRC);
check('저표본 경고 시인성 유지(accent)', accentOnLowSample, accentOnLowSample ? 'accent' : '누락');

// 테마 토큰만(하드코딩 hex 색상 0)
const hexColors = SRC.match(/#[0-9A-Fa-f]{3,8}\b/g) ?? [];
check('하드코딩 hex 색상 0(테마 토큰)', hexColors.length === 0, hexColors.length ? hexColors.join(',') : '없음');

// 결과 출력
let failed = 0;
console.log('DAR-194 진리표 — 스타일 카드 progressive disclosure\n');
for (const c of cases) {
  const mark = c.pass ? 'PASS' : 'FAIL';
  if (!c.pass) failed++;
  console.log(`  [${mark}] ${c.name} — ${c.detail}`);
}
console.log(`\n${cases.length - failed}/${cases.length} 통과`);
if (failed > 0) {
  process.exit(1);
}
