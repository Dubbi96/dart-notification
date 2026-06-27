// DAR-454 결정론 검증: AI 비용 화면(app/settings-detail/ai-cost.tsx) 사용자 요약/고급 분리.
// 감사 발견 D4·D6·D7·D15를 정적으로 봉인한다 — 회귀 시 즉시 FAIL.
//   D4  공통 ScreenHeader 사용(자체 chevron-left 헤더 제거)
//   D6  사용자 요약(이번 달 비용 + 한도 게이지 1개) 기본 노출 · 운영 6블록은 고급 접기(기본 닫힘) · 용어 1줄 설명
//   D7  태스크 byTask 영문 키 → 한국어 라벨 맵(taskLabel)
//   D15 pull-to-refresh(RN 코어 RefreshControl) + 기간 문자열 포맷(formatPeriodDate)
// Node v25 네이티브 __dirname 이슈 → `npx tsx scripts/check-ai-cost-summary.ts` 로 실행.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const REL = 'app/settings-detail/ai-cost.tsx';
const src = readFileSync(join(root, REL), 'utf8');

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

// ── D4: 공통 ScreenHeader ───────────────────────────────────────────────
ok('D4 ScreenHeader import', /import\s*\{\s*ScreenHeader\s*\}\s*from\s*'@components\/common\/ScreenHeader'/.test(src));
ok('D4 ScreenHeader 사용(title="AI 비용" onBack)', /<ScreenHeader\s+title="AI 비용"\s+onBack=\{\(\)\s*=>\s*router\.back\(\)\}/.test(src));
ok('D4 자체 chevron-left 헤더 제거', !/name="chevron-left"/.test(src));
ok('D4 자체 헤더 스타일(styles.header/backButton) 제거', !/styles\.header\b/.test(src) && !/styles\.backButton\b/.test(src));

// ── D6: 사용자 요약 / 고급 접기 분리 ────────────────────────────────────
ok('D6 SummaryCard 정의', /function SummaryCard\(/.test(src));
ok('D6 SummaryCard 렌더', /<SummaryCard\s+totalCostUsd=/.test(src));
ok('D6 요약 "이번 달 AI 비용" 헤드라인', /이번 달 AI 비용/.test(src));
ok('D6 요약 한도 게이지 1개(이번 달 한도)', /label="이번 달 한도"/.test(src));
ok('D6 고급 토글 정의', /function AdvancedToggle\(/.test(src));
ok('D6 고급 접기 기본 닫힘(useState(false))', /const \[advancedOpen, setAdvancedOpen\] = useState\(false\)/.test(src));
ok('D6 운영 상세 블록 advancedOpen 게이트', /\{advancedOpen && \(/.test(src));
ok('D6 용어 1줄 설명(TermGuide)', /function TermGuide\(/.test(src) && /용어 안내/.test(src));
// 사용자 요약 카드(SummaryCard) 본문엔 운영자 용어가 없어야 한다(신규 사용자 이해 보호).
{
  const start = src.indexOf('function SummaryCard(');
  const end = src.indexOf('function AdvancedToggle(');
  const summaryBody = start >= 0 && end > start ? src.slice(start, end) : '';
  const operatorTerms = ['단위경제', 'L0비율', '비용게이트', '강등', '수용기준'];
  const clean = summaryBody.length > 0 && operatorTerms.every((t) => !summaryBody.includes(t));
  ok('D6 요약 카드 본문에 운영자 용어(단위경제·L0비율·강등 등) 없음', clean);
}

// ── D7: 태스크 키 → 한국어 라벨 ─────────────────────────────────────────
ok('D7 TASK_LABELS 맵 존재', /const TASK_LABELS: Record<string, string> = \{/.test(src));
const taskMappings: Array<[string, string]> = [
  ['summary', '공시 요약'],
  ['event-classification', '이벤트 분류'],
  ['persona-interpretation', '페르소나 해석'],
  ['position-thesis', '보유 논거 점검'],
];
for (const [key, label] of taskMappings) {
  // 식별자 키(summary)는 따옴표 없이, 하이픈 키('event-classification')는 따옴표로 — 양쪽 허용.
  ok(`D7 '${key}' → '${label}' 매핑`, new RegExp(`['"]?${key}['"]?:\\s*'${label}'`).test(src));
}
ok('D7 렌더가 taskLabel(task) 사용(영문 키 직접노출 제거)', /\{taskLabel\(task\)\}/.test(src));
ok('D7 raw {task} 직접 렌더 제거', !/numberOfLines=\{1\}\s*>\s*\{task\}\s*</.test(src));

// ── D15: pull-to-refresh + 기간 포맷 ────────────────────────────────────
ok('D15 RefreshControl import(react-native 코어)', /import\s*\{[^}]*\bRefreshControl\b[^}]*\}\s*from\s*'react-native'/s.test(src));
ok('D15 ScrollView refreshControl=RN 코어 <RefreshControl> 엘리먼트', /refreshControl=\{\s*<RefreshControl/.test(src));
ok('D15 refreshing/onRefresh props', /refreshing=\{refreshing\}/.test(src) && /onRefresh=\{onRefresh\}/.test(src));
ok('D15 커스텀 refreshControl 래퍼 금지(AppRefreshControl 부재)', !/AppRefreshControl/.test(src));
ok('D15 onRefresh 6쿼리 동시 refetch', /Promise\.all\(\[/.test(src) && /refetchHealth\(\)/.test(src));
ok('D15 기간 포맷 함수(formatPeriodDate) 정의·사용', /function formatPeriodDate\(/.test(src) && /formatPeriodDate\(data\.period\.from\)/.test(src) && /formatPeriodDate\(data\.period\.to\)/.test(src));
ok('D15 formatYmdDots 재사용(앱 공통 날짜 포맷)', /import\s*\{\s*formatYmdDots\s*\}\s*from\s*'@utils\/datetime'/.test(src));
ok('D15 원시 period.from/to 미포맷 렌더 제거', !/기간:\s*\{data\.period\.from\}/.test(src));

// ── 공통 제약: 토큰만 · Feather 통일 · 44pt ─────────────────────────────
ok('제약 하드코딩 hex 색상 0', !/['"]#[0-9a-fA-F]{3,8}['"]/.test(src));
ok('제약 rgba() 하드코딩 0', !/rgba\(/.test(src));
ok('제약 아이콘 Feather 통일(Ionicons/MaterialIcons 미사용)', !/Ionicons|MaterialIcons|MaterialCommunityIcons/.test(src));
ok('제약 고급 토글 최소 터치영역 44(sizing.minTouchTarget)', /minHeight:\s*sizing\.minTouchTarget/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
