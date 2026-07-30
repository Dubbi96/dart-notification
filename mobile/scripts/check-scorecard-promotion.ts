// DAR-360 결정론 체크: 거래내역 스코어카드 승격 — 승률/누적수익 헤더 노출(신뢰지표 가시화).
//
// 기획(시인성): 진입 시 1줄 SummaryRow만 보이고 신뢰의 핵심 Scorecard(승률·누적수익·평균손익·
//   평균보유)가 요약+배너 아래로 묻혀 대부분 스크롤 안 함. 4지표가 전부 width:50% 동일 가중.
// 재설계: ①Scorecard를 헤더 위치로 승격(SummaryRow 위) 2행 위계(1행 승률 대형볼드+누적수익 세컨더리,
//   2행 평균손익+평균보유 터셔리). ②SummaryRow(스파크라인)는 세컨더리 보조맥락. ③3탭 유지 +
//   긴급 액션 프리뷰 배지(있을 때만).
//
// 이 체크는 화면 소스 바인딩으로 위 재설계가 실제 코드에 반영됐는지 결정론적으로 검증한다.
// 실행: npx tsx scripts/check-scorecard-promotion.ts
import { readFileSync } from 'fs';
import { join } from 'path';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}`);
  }
}

const src = readFileSync(join(__dirname, '..', 'app/portfolio/trade-history.tsx'), 'utf8');

// 헤더 JSX 영역(const header = ( ... );) 추출 — 진입 즉시 노출되는 ListHeaderComponent.
const headerStart = src.indexOf('const header = (');
const headerEnd = src.indexOf('return (', headerStart); // 컴포넌트 return 직전까지
const header = src.slice(headerStart, headerEnd);

console.log('— ① 신뢰지표 히어로 승격: 헤더 위치(SummaryRow 위) —');
const idxHero = header.indexOf('<HeroScorecard');
const idxSummary = header.indexOf('<SummaryRow');
const idxUrgent = header.indexOf('<UrgentCalibrationBanner');
const idxTabBar = header.indexOf('<TabBar');
const idxTabBody = header.indexOf("activeTab === 'performance' ?");
check('HeroScorecard가 헤더에 렌더된다', idxHero >= 0);
check('HeroScorecard가 SummaryRow보다 위(먼저)에 온다', idxHero >= 0 && idxSummary > idxHero);
check('HeroScorecard가 TabBar보다 위에 온다', idxHero >= 0 && idxTabBar > idxHero);
check('SummaryRow는 보조맥락으로 시급 보정 배너 위/탭바 위', idxSummary < idxUrgent && idxUrgent < idxTabBar);
check('히어로는 탭 본문보다 위(진입 즉시 무스크롤 노출)', idxHero >= 0 && idxTabBody > idxHero);

console.log('— ② 히어로 2행 위계: 승률 대형볼드 / 누적수익 세컨더리 / 손익·보유 터셔리 —');
const heroStart = src.indexOf('function HeroScorecard');
const heroEnd = src.indexOf('function SummaryRow');
const hero = src.slice(heroStart, heroEnd);
check('히어로 정의 존재', heroStart >= 0 && heroEnd > heroStart);
// 승률: 가장 큰 토큰 h1(대형 볼드)
check('승률이 typo.h1(대형)로 렌더', /승률[\s\S]{0,200}typo\.h1/.test(hero));
// 누적수익률: 세컨더리 h2 + 손익색(returnColor)
check('누적 수익률이 typo.h2(세컨더리)로 렌더', /누적 수익률[\s\S]{0,200}typo\.h2/.test(hero));
check('누적 수익률에 손익색(returnColor cumColor) 적용', /cumColor/.test(hero) && /returnColor\(scorecard\.cumulativeReturnPct/.test(hero));
// 1행 승률 > 누적수익(h1이 h2보다 시각 가중 큼)
const idxWinH1 = hero.indexOf('typo.h1');
const idxCumH2 = hero.indexOf('typo.h2');
check('1행에서 승률(h1)이 누적수익(h2)보다 먼저(좌측 우선)', idxWinH1 >= 0 && idxCumH2 > idxWinH1);
// 2행 터셔리: Metric으로 평균손익/평균보유
check('2행에 평균 손익 Metric', /heroSecondaryRow[\s\S]{0,400}label="평균 손익"/.test(hero));
check('2행에 평균 보유 Metric', /heroSecondaryRow[\s\S]{0,400}label="평균 보유"/.test(hero));
// 승률·누적수익이 평균손익/보유보다 위(위계)
const idxWinLabel = hero.indexOf('>승률<');
const idxSecRow = hero.indexOf('heroSecondaryRow');
check('1행(승률) 위계가 2행(평균지표)보다 위', idxWinLabel >= 0 && idxSecRow > idxWinLabel);

console.log('— ③ 표본부족 과신방지 배지 보존 —');
// DAR-554: maxFontSizeMultiplier 추가로 배지 Text가 여러 줄로 늘어나 근접창 확대(400→600).
check('lowSample 시 데이터 한계 배지', /lowSample[\s\S]{0,600}데이터 한계 \(표본/.test(hero));

console.log('— ④ SummaryRow 세컨더리화(스파크라인 보조, 대형 수치 제거) —');
const sumStart = src.indexOf('function SummaryRow');
const sumEnd = src.indexOf('function UrgentCalibrationBanner');
const summary = src.slice(sumStart, sumEnd);
check('SummaryRow 정의 존재', sumStart >= 0 && sumEnd > sumStart);
check('SummaryRow는 PerformanceSparkline(추이 보조) 유지', /PerformanceSparkline/.test(summary));
check('SummaryRow에서 대형 수치(typo.h3 기간수익률) 제거(중복 해소)', !/typo\.h3/.test(summary));
check('SummaryRow 라벨이 추이 중심', /수익률 추이/.test(summary));

console.log('— ⑤ 3탭 유지 + 긴급 액션 프리뷰 배지(있을 때만) —');
const tabStart = src.indexOf('function TabBar');
const tabEnd = src.indexOf('export default function');
const tabbar = src.slice(tabStart, tabEnd);
check("3탭(성과/신호 정밀도/보정 권고) 유지", /'성과'/.test(tabbar) && /'신호 정밀도'/.test(tabbar) && /'보정 권고'/.test(tabbar));
check('badges prop 수용', /badges\?: Partial<Record<ReportTab, number>>/.test(tabbar));
check('badge>0 일 때만 배지 노출(있을 때만)', /badge > 0 \?/.test(tabbar));
check('배지가 styles.tabBadge 토큰 사용', /styles\.tabBadge/.test(tabbar));
check('배지 접근성에 긴급 건수 노출', /긴급 \$\{badge\}건/.test(tabbar));

console.log('— ⑥ 긴급 보정 건수: CALIBRATE & 표본충분만, 공유 쿼리 —');
const screen = src.slice(src.indexOf('function TradeHistoryScreen'));
check('useCalibration 공유 쿼리로 건수 산출', /calibrationQuery = useCalibration\(\)/.test(screen));
check("urgentCalibrationCount = CALIBRATE && !lowSample 필터", /status === 'CALIBRATE' && !e\.lowSample/.test(screen));
check('TabBar에 calibration 배지 전달', /badges=\{\{ calibration: urgentCalibrationCount \}\}/.test(screen));

console.log('— ⑦ 회귀: 성과 탭 본문 중복 Scorecard 제거 + 매매내역 라벨 유지 —');
check('구 Scorecard 컴포넌트 제거', !/function Scorecard\(/.test(src));
check('성과 탭 본문에 <Scorecard 중복 렌더 없음', !/<Scorecard /.test(src));
check('매매 내역 라벨 유지', /매매 내역/.test(src));
check('미사용 스타일(scorecardHeader/metricGrid) 제거', !/scorecardHeader:/.test(src) && !/metricGrid:/.test(src));

console.log('— ⑧ 테마 토큰만(하드코딩 색상 0) —');
// 추가 영역(hero/tabBadge) 포함 전 파일에 hex/rgb 리터럴 없음.
const hexColor = src.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
const rgbColor = src.match(/rgba?\(/g) ?? [];
check('hex 색상 리터럴 0', hexColor.length === 0);
check('rgb(a) 색상 리터럴 0', rgbColor.length === 0);
// DAR-461 C3: 배지 배경은 warning → error(솔리드+onColor 대비)로 교정됨 — 기대값 동기화.
check('히어로/배지 색상 theme colors.* 사용', /colors\.borderLight/.test(hero) && /backgroundColor: colors\.error/.test(tabbar));

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
