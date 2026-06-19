// DAR-356 결정론 체크: 모의투자 메인 시인성 재편 — 총평가/손익 헤드라인 지배 + 리스크 위계.
//
// GROUND-1(시인성): 요약카드가 리스크배지·MDD·오늘체크·검색/정렬과 동일 가중치로 나열돼
//   5.5" 화면에서 총평가금액을 무스크롤 2초 글랜스로 파악 불가.
//   → 요약을 2줄 헤드라인(총평가 대형 typo.h1 + 손익 색조)으로 승격, 오늘체크는 접힘 세컨더리로 강등,
//     검색/정렬은 요약↔리스트 사이에서 제거하고 헤더 상단 고정.
// GROUND-2(안전): PortfolioRiskBadge 가 일손익·집중도·하드룰을 3개 동일크기 칩 가로나열 →
//   최고우선 경보(하드룰 위반)가 한 칩에 묻혀 글랜스에서 놓치기 쉬움. 신선도 표기 없음.
//   → 하드룰 위반을 전폭 솔리드 경보 배너로 최상단 승격, 그 아래 일손익·집중도 1줄 압축.
//     요약에 '기준: 실시간|장 마감' 신선도 라벨 추가.
//
// 1) 순수 로직: portfolioBasisLabel 진리표 + currentPortfolioBasisLabel 이 장중/마감을 정직 반영.
// 2) 소스 바인딩: 배지 위계(전폭 배너 + 1줄 압축), 요약 헤드라인, 접힘 토글, 검색 고정, 테마토큰 전용.
//
// 실행: npx tsx scripts/check-portfolio-visibility.ts
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  portfolioBasisLabel,
  currentPortfolioBasisLabel,
  isKstMarketOpen,
} from '../utils/marketQuoteDisplay';

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

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

console.log('— 1) 신선도 라벨 순수 진리표 (GROUND-2 정직 표기) —');
check("장중(open=true) → '기준: 실시간'", portfolioBasisLabel(true) === '기준: 실시간');
check("마감(open=false) → '기준: 장 마감'", portfolioBasisLabel(false) === '기준: 장 마감');
check('두 라벨은 서로 달라 신선도를 구분한다', portfolioBasisLabel(true) !== portfolioBasisLabel(false));

console.log('— 1b) currentPortfolioBasisLabel 이 KST 장중/마감을 정직 반영 —');
// 평일 장중(수요일 11:00 KST = UTC 02:00). 결정론: 고정 UTC epoch 사용.
const wedMidday = new Date('2026-06-17T02:00:00Z'); // 수 11:00 KST
const wedAfterClose = new Date('2026-06-17T07:00:00Z'); // 수 16:00 KST(마감 후)
const saturday = new Date('2026-06-20T02:00:00Z'); // 토 11:00 KST(주말)
check('수 11:00 KST 는 장중', isKstMarketOpen(wedMidday) === true);
check('수 16:00 KST 는 마감', isKstMarketOpen(wedAfterClose) === false);
check('토요일은 휴장', isKstMarketOpen(saturday) === false);
// 래퍼는 new Date() 를 내부 호출 → 현재 시각에 대해 둘 중 하나의 정직한 라벨을 돌려준다.
const live = currentPortfolioBasisLabel();
check(
  "currentPortfolioBasisLabel 는 정직 라벨 집합에 속한다",
  live === '기준: 실시간' || live === '기준: 장 마감',
);

console.log('— 2) PortfolioRiskBadge 위계 (GROUND-2) —');
const badge = read('components/portfolio/PortfolioRiskBadge.tsx');
check('하드룰 위반 전폭 솔리드 경보 배너 존재(alertBanner)', /alertBanner/.test(badge));
check(
  '경보 배너는 솔리드 error 배경 + onColor 전경(색 단독 아님: 아이콘+텍스트 병행)',
  /backgroundColor:\s*colors\.error/.test(badge) &&
    /color:\s*colors\.onColor/.test(badge) &&
    /alert-triangle/.test(badge),
);
check('경보 배너는 alert 역할로 글랜스 인지(accessibilityRole="alert")', /accessibilityRole="alert"/.test(badge));
check('일손익·집중도는 1줄 압축(metricsRow) — 3개 동일칩 가로나열 폐기', /metricsRow/.test(badge));
check("압축 라벨에 '당일'·'최대종목' 텍스트 병행", /당일 /.test(badge) && /최대종목 /.test(badge));
check('과거 3-동일칩 패턴(styles.chip/styles.row) 제거됨', !/styles\.chip\b/.test(badge) && !/styles\.row\b/.test(badge));

console.log('— 3) 포트폴리오 메인 헤드라인/강등/고정 (GROUND-1) —');
const screen = read('app/(tabs)/portfolio/index.tsx');
check('총평가금액은 대형 헤드라인(typo.h1 + headlineValue)', /typo\.h1, styles\.headlineValue/.test(screen));
check('손익은 같은 줄 색조 표기(headlinePnlRow + pnlColor)', /headlinePnlRow/.test(screen) && /color: pnlColor\(summary\.totalPnlPercent/.test(screen));
check('신선도 라벨 표시(currentPortfolioBasisLabel)', /currentPortfolioBasisLabel\(\)/.test(screen));
check('오늘체크는 접힘 토글로 강등(showTodayCheck state)', /setShowTodayCheck/.test(screen) && /useState\(false\)/.test(screen));
check('접힘 시 TodayCheckSlot 미마운트(showTodayCheck 가드)', /showTodayCheck \? \(\s*<TodayCheckSlot/.test(screen));
check('검색/정렬은 요약↔리스트 사이에서 제거 → 고정바(fixedSearch)', /styles\.fixedSearch/.test(screen));
check(
  '검색바는 ListHeaderComponent(스크롤 헤더) 밖에 위치(요약 글랜스 보호)',
  screen.indexOf('styles.fixedSearch') < screen.indexOf('ListHeaderComponent'),
);

console.log('— 4) 테마토큰 전용 (하드코딩 색 금지) —');
// 변경 파일 본문에서 hex 리터럴(#rgb/#rrggbb) 또는 rgb()/rgba() 직접 사용 금지.
const hexRe = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;
for (const [name, src] of [
  ['PortfolioRiskBadge.tsx', badge],
  ['portfolio/index.tsx', screen],
] as const) {
  // 주석 줄 제외하고 코드 줄만 스캔(설명 주석의 색 토큰명 오탐 방지).
  const codeLines = src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'));
  check(`${name}: 하드코딩 색 리터럴 없음`, !codeLines.some((l) => hexRe.test(l)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
