// DAR-357 결정론 검증: PositionCard 스캔성 재설계(세로 스택 + 좌측 엣지 컬러바 + VIOLATED 솔리드 칩).
// 소스에 바인딩해 재설계 불변식을 단언하고, 옛 가로 분리 레이아웃·별도 경고 행의 부재(회귀)를 확인한다.
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const src = readFileSync(join(root, 'components/portfolio/PositionCard.tsx'), 'utf8');

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

function between(s: string, a: string, b: string): string {
  const i = s.indexOf(a);
  if (i < 0) return '';
  const j = s.indexOf(b, i + a.length);
  return j < 0 ? s.slice(i) : s.slice(i + a.length, j);
}

// ---------- ① 좌측 엣지 컬러바(코드에디터 에러마커식) ----------
ok('컬러바 폭 상수 정의(2~3px)', /const ACCENT_BAR_WIDTH = [23];/.test(src));
const barStyle = between(src, 'accentBar: {', '}');
ok('accentBar: position absolute', /position:\s*'absolute'/.test(barStyle));
ok('accentBar: left 0 (좌측 엣지)', /left:\s*0/.test(barStyle));
ok('accentBar: 폭=ACCENT_BAR_WIDTH 토큰', /width:\s*ACCENT_BAR_WIDTH/.test(barStyle));
ok('accentBar: 카드 라운드 좌측 모서리 정합', /borderTopLeftRadius:\s*radius\.lg/.test(barStyle));
// 바 색: 정상(ACTIVE)=중립 border, 그 외 상태=상태색. DAR-370: 자동 매도는 경고색 우선.
ok("barColor: ACTIVE → 중립 colors.border", /status === 'ACTIVE'\s*\?\s*colors\.border\s*:\s*statusColor/.test(src));
ok('barColor: 자동 매도 예정 → 경고색 우선(DAR-370)', /const barColor = isAutoSell\s*\?\s*colors\.error/.test(src));
ok('accentBar View 가 barColor 로 렌더', /styles\.accentBar,\s*\{ backgroundColor: barColor \}/.test(src));

// ---------- ② 상태칩 = 자동 동작 라벨(DAR-368) + 솔리드 강조 + 아이콘 ----------
// DAR-370: '매도 검토 필요'(수동 암시)는 DAR-368 자동 동작 라벨로 대체된다 — 칩은 positionSystemAction
// 으로 구동되며 자동 매도(EXIT)만 솔리드 경고색, 모니터링/중립은 보조 표면이다(스캔 구조와 양립).
ok('자동 동작 디스크립터 도출(positionSystemAction)', /const action = positionSystemAction\(position\);/.test(src));
ok('isAutoSell 분기 도출', /const isAutoSell = action\.isAutoSell;/.test(src));
ok('isMonitoring 분기 도출', /const isMonitoring = action\.tone === 'monitoring';/.test(src));
ok('칩 라벨=action.label(엔진 일치)', /\{action\.label\}/.test(src));
ok('상태칩 배경: 자동 매도 솔리드 colors.error', /chipBg = isAutoSell \? colors\.error : colors\.surfaceSecondary/.test(src));
ok('상태칩 텍스트: 자동 매도 onColor(솔리드 위 전경)', /chipTextColor = isAutoSell \? colors\.onColor : statusColor/.test(src));
ok('자동 매도 zap 아이콘(시스템 자동 실행)', /name="zap"/.test(src));
ok('모니터링 activity 아이콘(시스템 감시)', /name="activity"/.test(src));
ok('중립 칩 아이콘 없음(undefined)', /:\s*undefined/.test(between(src, 'icon={', '</Chip>')));
// 회귀: 수동 '매도 검토 필요' 문구는 칩/라벨/어디에도 없어야 한다(DAR-368).
ok("회귀: 수동 '매도 검토 필요' 부재", !src.includes('매도 검토 필요'));

// ---------- ③ 세로 스택 + 손익 색조 + 메타 1줄 ----------
ok('카드 세로 스택 간격 gap 토큰', /gap:\s*spacing\.sm/.test(between(src, 'card: {', '}')));
ok('손익 칩(PriceChangeChip) 렌더', /<PriceChangeChip value=\{position\.pnlPercent\}/.test(src));
ok('손익 칩 좌측 정렬(내용폭만)', /pnlChip: \{[\s\S]*?alignSelf:\s*'flex-start'/.test(src));
ok('수량·평단 메타 1줄 구성', /metaParts\.push\(`\$\{position\.quantity/.test(src) && /평단 \$\{position\.avgPrice/.test(src));
const metaBlock = between(src, '{metaText ?', '</Text>');
ok('메타 Text numberOfLines={1}', /\{metaText\}/.test(metaBlock) && /numberOfLines=\{1\}/.test(metaBlock));
ok('종목명 numberOfLines={1}(한 줄 말줄임)', /\{position\.corpName\}/.test(src) && /styles\.name[\s\S]*?numberOfLines=\{1\}/.test(src));

// ---------- ④ 회귀: 옛 가로 분리 레이아웃·별도 경고 행 제거 ----------
ok('회귀: 옛 가로 row 스타일(styles.row) 부재', !/styles\.row\b/.test(src));
ok('회귀: 옛 left/right 분리 컨테이너 부재', !/styles\.left\b/.test(src) && !/styles\.right\b/.test(src));
ok("회귀: 별도 '매도 검토 필요' 경고 Text 행 부재(칩으로 병합)",
   !/colors\.error, marginTop: spacing\.xs \}\]>매도 검토 필요/.test(src) &&
   !/>매도 검토 필요<\/Text>/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
