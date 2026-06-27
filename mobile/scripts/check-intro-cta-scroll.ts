// DAR-463 결정론 체크: 인트로 슬라이드 스크롤 / 예시 일반화 / CTA 정합.
// 단일 파일(app/intro/index.tsx) 소스 바인딩으로 4개 감사 항목을 봉인한다.
//   A-NAV-1   : CTA 라벨이 동작(로그인 화면 이동)과 일치('시작하기').
//   A-INTRO-1 : 슬라이드 콘텐츠를 세로 ScrollView로 감싸 소형 화면 클리핑 방지.
//   A-INTRO-2 : 예시 종목을 가상 종목으로 일반화(실명 제거 → 실추천 오해 방지).
//   A-INTRO-3 : 가로 FlatList에 getItemLayout 부여(scrollToIndex 안정).
//
// 실행: npx tsx scripts/check-intro-cta-scroll.ts  (실패 시 exit 1)
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

const src = readFileSync(join(__dirname, '..', 'app/intro/index.tsx'), 'utf8');

console.log('— A-NAV-1 CTA 라벨/동작 정합 —');
check("CTA 라벨 '시작하기' 존재", src.includes('title="시작하기"'));
check("구 라벨 '카카오로 시작' 제거", !src.includes('카카오로 시작'));
check('handleStart 핸들러 존재', /const handleStart = useCallback/.test(src));
check('구 handleKakaoStart 핸들러 제거', !src.includes('handleKakaoStart'));
check(
  "건너뛰기 a11y 라벨이 동작과 일치('시작 화면으로 이동')",
  src.includes('소개 건너뛰고 시작 화면으로 이동'),
);
check('구 a11y 라벨(카카오 로그인으로 이동) 제거', !src.includes('카카오 로그인으로 이동'));

console.log('— A-INTRO-1 슬라이드 스크롤(클리핑 방지) —');
check('react-native에서 ScrollView import', /\bScrollView,?\n/.test(src));
check(
  'SlideShell 공통 셸이 ScrollView contentContainerStyle 사용',
  /function SlideShell\([\s\S]*?<ScrollView[\s\S]*?contentContainerStyle=\{styles\.slideInner\}/.test(
    src,
  ),
);
check('Slide1이 SlideShell 사용', /function Slide1[\s\S]*?return \(\s*<SlideShell>/.test(src));
check('Slide2가 SlideShell 사용', /function Slide2[\s\S]*?return \(\s*<SlideShell>/.test(src));
check('Slide3가 SlideShell 사용', /function Slide3[\s\S]*?return \(\s*<SlideShell>/.test(src));
check('고정 <View styles.slideInner> 직접 사용 제거', !/<View style=\{styles\.slideInner\}>/.test(src));
check('slideInner가 flexGrow:1 (콘텐츠 성장 허용)', /slideInner:\s*\{[\s\S]*?flexGrow:\s*1/.test(src));
check('slideInner에 paddingBottom (하단 여유)', /slideInner:\s*\{[\s\S]*?paddingBottom:/.test(src));

console.log('— A-INTRO-2 예시 종목 일반화 —');
const realNames = ['삼성전자', 'SK하이닉스', 'NAVER', '005930'];
for (const n of realNames) {
  check(`실명/실코드 '${n}' 제거`, !src.includes(n));
}
check('가상 종목 placeholder(○○전자) 존재', src.includes('○○전자'));
check("BuyScore 예시가 '예시 종목' 라벨로 일반화", src.includes('예시 종목 · 유상증자 결정'));
check('PBR 1.2배/ROE 12% 등 구체 수치 제거', !src.includes('PBR 1.2배') && !src.includes('ROE 12%'));

console.log('— A-INTRO-3 getItemLayout —');
check('getItemLayout 정의', /const getItemLayout = useCallback/.test(src));
check(
  'getItemLayout이 SCREEN_WIDTH 기반 오프셋 산출',
  /length:\s*SCREEN_WIDTH,\s*offset:\s*SCREEN_WIDTH \* index/.test(src),
);
check('FlatList에 getItemLayout 전달', /getItemLayout=\{getItemLayout\}/.test(src));

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
