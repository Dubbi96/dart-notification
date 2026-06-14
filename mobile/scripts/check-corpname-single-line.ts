// DAR-278 결정론 검증: 동적 기업명(corpName)이 numberOfLines 없이 다행 wrap 하던 2곳을
//   한 줄 말줄임으로 정렬(SearchOverlay:207 numberOfLines={1} 패턴과 일관).
// ① app/settings-detail/watchlist.tsx: nameRow(flexDirection row + 신규배지 인접) 안 corpName Text가
//    numberOfLines={1} + flex:1 → 한 줄 말줄임, 신규배지 인라인 유지.
// ② components/home/DisclosureFeedCard.tsx: corpName Text numberOfLines={1}
//    (같은 카드 reportName 은 numberOfLines={2} 보유 → 카드 내부 일관성).
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
const watchlist = readFileSync(join(root, 'app/settings-detail/watchlist.tsx'), 'utf8');
const feedCard = readFileSync(join(root, 'components/home/DisclosureFeedCard.tsx'), 'utf8');

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

function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const j = src.indexOf(b, i + a.length);
  return j < 0 ? src.slice(i) : src.slice(i + a.length, j);
}

// ---------- ① watchlist ----------
// nameRow(<View style={styles.nameRow}>) ~ 신규배지(styles.newBadge) 사이에 corpName Text.
const nameRowBlock = between(watchlist, 'styles.nameRow', 'styles.newBadge');
ok('watchlist: nameRow 블록 추출', nameRowBlock.length > 0);
ok('watchlist: corpName 렌더(item.corpName)', /\{item\.corpName\}/.test(nameRowBlock));
ok('watchlist: corpName Text numberOfLines={1}', /numberOfLines=\{1\}/.test(nameRowBlock));
// flex:1 로 가용폭 차지 → 한 줄 말줄임 + 배지 인라인(SearchOverlay 패턴 정렬).
// lint(no-inline-styles) 회피 위해 StyleSheet nameText 로 분리: corpName Text 가 styles.nameText 바인딩 +
//   nameText: { flex: 1 } 정의 둘 다 존재해야 인라인 flex:1 과 동등.
ok('watchlist: corpName Text styles.nameText 바인딩', /styles\.nameText/.test(nameRowBlock));
ok('watchlist: nameText 스타일 flex:1 정의', /nameText:\s*\{\s*flex:\s*1\s*\}/.test(watchlist));
// 신규배지가 corpName 다음에 그대로 인접(인라인 유지)
ok('watchlist: 신규배지 newBadge 인접 유지', /styles\.newBadge/.test(watchlist));

// ---------- ② DisclosureFeedCard ----------
// reportName(numberOfLines={2}) 다음에 오는 corpName Text 블록.
const corpNameBlock = between(feedCard, 'styles.corpName', '{item.corpName}');
ok('feedCard: corpName Text 블록 추출', corpNameBlock.length > 0);
ok('feedCard: corpName Text numberOfLines={1}', /numberOfLines=\{1\}/.test(corpNameBlock));
// 카드 내부 일관성: reportName 은 기존 numberOfLines={2} 보존(미회귀)
ok('feedCard: reportName numberOfLines={2} 보존', /\{item\.reportName\}/.test(feedCard) && /numberOfLines=\{2\}/.test(feedCard));

// ---------- 회귀 음성 대조 ----------
// 옛 상태: watchlist corpName 이 numberOfLines 없이 단일 Text 한 줄(`>{item.corpName}</Text>`)
ok('regression: watchlist 옛 무말줄임 인라인 패턴(>{item.corpName}</Text>) 부재',
   !/>\{item\.corpName\}<\/Text>/.test(watchlist));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
