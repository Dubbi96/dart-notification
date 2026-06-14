// DAR-287 결정론 검증: 정적 빈상태 카피 2곳을 emptyStateCopy SSOT 경유로 통합.
// 1) emptyStateCopy.ts 에 paperTradingNoSignalsEmpty·philosophyNotFound 정의(icon+title).
// 2) portfolio/index.tsx·philosophy/[id].tsx 가 {...emptyStateCopy.<key>} 로 소비.
// 3) 두 사이트에 인라인 EmptyState title 리터럴 0 (disclosures 동적 카피는 대상 아님).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const copySrc = readFileSync(join(root, 'components/common/emptyStateCopy.ts'), 'utf8');
const portfolioSrc = readFileSync(join(root, 'app/(tabs)/portfolio/index.tsx'), 'utf8');
const philosophySrc = readFileSync(join(root, 'app/philosophy/[id].tsx'), 'utf8');

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

// --- SSOT 정의 ---
// paperTradingNoSignalsEmpty
const ptBlock = copySrc.slice(copySrc.indexOf('paperTradingNoSignalsEmpty:'));
ok('SSOT: paperTradingNoSignalsEmpty 정의', copySrc.includes('paperTradingNoSignalsEmpty:'));
ok('SSOT: paperTradingNoSignalsEmpty icon=activity', /icon:\s*'activity'/.test(ptBlock.slice(0, 120)));
ok('SSOT: paperTradingNoSignalsEmpty title 존댓말 톤', /title:\s*'아직 실행된 모의투자 신호가 없어요'/.test(ptBlock.slice(0, 160)));
// philosophyNotFound
const phBlock = copySrc.slice(copySrc.indexOf('philosophyNotFound:'));
ok('SSOT: philosophyNotFound 정의', copySrc.includes('philosophyNotFound:'));
ok('SSOT: philosophyNotFound icon=book-open', /icon:\s*'book-open'/.test(phBlock.slice(0, 120)));
ok('SSOT: philosophyNotFound title 존댓말 톤', /title:\s*'해당 거장 철학을 찾을 수 없어요'/.test(phBlock.slice(0, 160)));

// --- 소비처 SSOT 경유 ---
ok('portfolio: {...emptyStateCopy.paperTradingNoSignalsEmpty} 소비', /\{\.\.\.emptyStateCopy\.paperTradingNoSignalsEmpty\}/.test(portfolioSrc));
ok('philosophy: emptyStateCopy import', /import \{ emptyStateCopy \} from '@components\/common\/emptyStateCopy'/.test(philosophySrc));
ok('philosophy: {...emptyStateCopy.philosophyNotFound} 소비', /\{\.\.\.emptyStateCopy\.philosophyNotFound\}/.test(philosophySrc));

// --- 회귀: 대상 2곳의 인라인 정적 title 리터럴 제거 ---
// 대상은 정적 카피 2곳뿐. portfolio 의 preparing/search 빈상태와 disclosures 의 동적
// 백틱 보간(`'${q}' 검색 결과가 없어요`)은 SSOT 비대상이므로 회귀 검사에서 제외한다.
// → 두 대상의 인라인 정적 시그니처(`icon="activity" title=`, `icon="book-open" title=`)만 0 을 확인.
ok('portfolio: 대상 인라인(icon=activity title=) 0', !/<EmptyState[^>]*icon="activity"[^>]*\btitle="/.test(portfolioSrc));
ok('philosophy: 대상 인라인(icon=book-open title=) 0', !/<EmptyState[^>]*icon="book-open"[^>]*\btitle="/.test(philosophySrc));
// 구 인라인 문구 잔존 없음
ok('portfolio: 구 문구(없습니다) 잔존 없음', !portfolioSrc.includes('아직 실행된 모의투자 신호가 없습니다'));
ok('philosophy: 구 문구(없습니다) 잔존 없음', !philosophySrc.includes('철학을 찾을 수 없습니다'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
