/**
 * DAR-453 결정론적 검증 — 공시 상세 AI 카드 통합/구분 + 정보 밀도 완화(E8) · 기업명 행 터치 영역(E9).
 *
 * 종전 문제:
 *  - E8: 'AI 분석 결과'(이벤트 분류)와 'AI 심층 분석' 두 카드가 cpu 아이콘 + AiReferenceLabel 로
 *        외형이 거의 동일 → 혼동. 그 위에 7섹션 수직 누적으로 인지 과부하.
 *  - E9: 탭 가능한 '기업명' 정보 행 높이 ≈42pt(<44), hitSlop 없음.
 *
 * 해결(이 두 파일만):
 *  - 차별화: 이벤트 분류 카드는 tag 아이콘 + 'AI 이벤트 분류' 라벨, 심층 분석은 cpu 유지 → 외형 구분.
 *  - 우선순위 재배치: 사실 정량값('본문 핵심 수치')을 AI 해석 카드들보다 먼저 노출.
 *  - 접이식: 두 AI 카드 헤더 탭으로 접기/펼치기. 무거운 '심층 분석'은 기본 접힘(밀도 완화).
 *  - 참고 표기(AiReferenceLabel) 유지 · 아이콘 Feather · 한국어 유지.
 *  - E9: 정보 행 minHeight = sizing.minTouchTarget(44).
 *
 * 실행: npx tsx scripts/check-disclosure-ai-density.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'fs';
import { join } from 'path';

let failed = 0;
function ok(label: string, cond: boolean): void {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}`);
}

const screen = readFileSync(join(__dirname, '../app/disclosure/[id].tsx'), 'utf8');
const deep = readFileSync(
  join(__dirname, '../components/disclosure/DisclosureAiAnalysisSection.tsx'),
  'utf8',
);

// ── E9: 기업명 등 정보 행 최소 터치 영역(44pt) ──────────────────────────────
ok('screen: sizing import(@theme/spacing)', /import\s*\{[^}]*\bsizing\b[^}]*\}\s*from\s*'@theme\/spacing'/.test(screen));
ok('screen: infoRow minHeight = sizing.minTouchTarget', /infoRow:\s*\{[\s\S]*?minHeight:\s*sizing\.minTouchTarget[\s\S]*?\}/.test(screen));

// ── E8-1: 두 AI 카드 차별화(아이콘·라벨) ────────────────────────────────────
ok('screen: 이벤트 분류 라벨 = "AI 이벤트 분류"', screen.includes('AI 이벤트 분류'));
ok('screen: 구 라벨 "AI 분석 결과" 제거', !screen.includes('AI 분석 결과'));
ok('screen: 이벤트 카드 tag 아이콘', /<Feather\s+name="tag"/.test(screen));
ok('deep: 심층 분석 라벨 "AI 심층 분석" 유지', deep.includes('AI 심층 분석'));
ok('deep: 심층 분석 cpu 아이콘 유지', /<Feather\s+name="cpu"/.test(deep));

// ── E8-2: 핵심(사실 정량값) 우선순위 재배치 ─────────────────────────────────
//   본문 핵심 수치 → AI 이벤트 분류 → AI 심층 분석 순서.
const idxFacts = screen.indexOf('<DisclosureFiledFactsSection');
// 이벤트 카드 렌더 위치는 고유한 tag 아이콘으로 앵커(주석/상단 상태 코멘트와 혼동 방지).
const idxEvent = screen.indexOf('name="tag"');
const idxDeep = screen.indexOf('<DisclosureAiAnalysisSection');
ok('screen: 본문 핵심 수치 렌더 1회', (screen.match(/<DisclosureFiledFactsSection/g) ?? []).length === 1);
ok('screen: 본문 핵심 수치 < AI 이벤트 분류', idxFacts > -1 && idxFacts < idxEvent);
ok('screen: AI 이벤트 분류 < AI 심층 분석', idxEvent > -1 && idxEvent < idxDeep);

// ── E8-3: 접이식(밀도 완화) ──────────────────────────────────────────────────
// 이벤트 분류 카드(이 화면) — 토글 상태 + 조건부 본문 + 셰브런 + a11y.
ok('screen: eventExpanded 상태/토글', /setEventExpanded\(\(v\)\s*=>\s*!v\)/.test(screen) && /useState\(true\)/.test(screen));
ok('screen: eventExpanded 조건부 본문', /\{eventExpanded\s*\?\s*\(/.test(screen));
ok('screen: 이벤트 헤더 셰브런(chevron-up/down)', /eventExpanded\s*\?\s*'chevron-up'\s*:\s*'chevron-down'/.test(screen));
ok('screen: 이벤트 헤더 a11y(button + expanded)', /accessibilityRole="button"[\s\S]*?accessibilityState=\{\{\s*expanded:\s*eventExpanded\s*\}\}/.test(screen));
ok('screen: 이벤트 헤더 minHeight = sizing.minTouchTarget', /aiHeader:\s*\{[\s\S]*?minHeight:\s*sizing\.minTouchTarget[\s\S]*?\}/.test(screen));

// 심층 분석 카드(별도 컴포넌트) — 기본 접힘 + 토글 + 조건부 children + 셰브런 + a11y.
ok('deep: 기본 접힘 useState(false)', /useState\(false\)/.test(deep));
ok('deep: 토글 setExpanded', /setExpanded\(\(v\)\s*=>\s*!v\)/.test(deep));
ok('deep: 조건부 children {expanded ? children : null}', /\{expanded\s*\?\s*children\s*:\s*null\}/.test(deep));
ok('deep: 셰브런(chevron-up/down)', /expanded\s*\?\s*'chevron-up'\s*:\s*'chevron-down'/.test(deep));
ok('deep: 헤더 a11y(button + expanded)', /accessibilityRole="button"[\s\S]*?accessibilityState=\{\{\s*expanded\s*\}\}/.test(deep));
ok('deep: 헤더 minHeight = sizing.minTouchTarget', /header:\s*\{[\s\S]*?minHeight:\s*sizing\.minTouchTarget[\s\S]*?\}/.test(deep));

// ── 정책: AI 산출물 "참고" 표기 유지 ────────────────────────────────────────
ok('screen: 이벤트 카드 AiReferenceLabel 유지', /<AiReferenceLabel\s*\/>/.test(screen));
ok('deep: 심층 분석 AiReferenceLabel 유지', /<AiReferenceLabel\s*\/>/.test(deep));

console.log(`\n${failed === 0 ? 'OK' : 'FAILED'} — ${failed} 실패`);
process.exit(failed === 0 ? 0 : 1);
