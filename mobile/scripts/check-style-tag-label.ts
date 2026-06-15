/**
 * DAR-313 결정론적 검증: 투자거장 스타일 태그칩 raw enum 언더스코어 노출 차단.
 *
 * 증상(에뮬 QA): 신호 탭 → 투자거장 화면 워런 버핏 태그칩이 'VALUE · MOAT · LONG_TERM'.
 *   VALUE·MOAT 는 단어형인데 'LONG_TERM' 만 언더스코어 raw enum 형식 → 표기 비일관.
 * 원인: philosophy.styleTags(백엔드 enum 키)를 칩 라벨로 그대로 렌더(`{tag}`).
 * 해결: utils/styleTagLabel.ts getStyleTagLabel — 매핑 라벨, 미매핑도 `_`→공백 치환.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) 백엔드 seed-data 의 모든 styleTags 가 STYLE_TAG_LABEL 키에 존재(parity).
 *  (B) 모든 매핑 라벨에 언더스코어 미포함(raw enum 미노출).
 *  (C) LONG_TERM → 'LONG TERM'(언더스코어 제거된 표기).
 *  (D) 방어적 폴백: 미매핑 언더스코어 키도 raw `_` 미노출(공백 치환).
 *  (E) 회귀: 단어형 태그(VALUE·MOAT·GROWTH 등)는 그대로.
 *  (F) 소스 바인딩: 두 렌더 지점이 raw `{tag}` 가 아닌 getStyleTagLabel(tag) 사용.
 *
 * 실행: npx tsx scripts/check-style-tag-label.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLE_TAG_LABEL, getStyleTagLabel } from '../utils/styleTagLabel.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = join(root, '..');

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── 백엔드 seed-data 의 styleTags 전 값 추출(SSOT) ──
const seedPath = join(
  repoRoot,
  'backend',
  'src',
  'engine2-ai-analyst',
  'philosophy',
  'philosophy.seed-data.ts',
);
const seed = readFileSync(seedPath, 'utf8');
const seedTags = new Set<string>();
for (const m of seed.matchAll(/styleTags:\s*\[([^\]]*)\]/g)) {
  for (const t of m[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)) {
    seedTags.add(t[1]);
  }
}

console.log(`\n[A] seed-data styleTags parity (백엔드 ${seedTags.size}종 vs 라벨 맵)`);
check('seed-data 에서 styleTags 추출됨(>0)', seedTags.size > 0, `추출 ${seedTags.size}`);
for (const tag of seedTags) {
  check(`STYLE_TAG_LABEL 에 '${tag}' 키 존재`, tag in STYLE_TAG_LABEL);
}
// LONG_TERM(증상 대상)이 실제 seed 에 존재하는지 확인
check("seed 에 'LONG_TERM' 존재(증상 대상)", seedTags.has('LONG_TERM'));

console.log('\n[B] 모든 매핑 라벨 언더스코어 미포함(raw enum 미노출)');
for (const [key, label] of Object.entries(STYLE_TAG_LABEL)) {
  check(`'${key}' 라벨('${label}')에 언더스코어 없음`, !label.includes('_'));
}

console.log('\n[C] LONG_TERM 표기');
check("getStyleTagLabel('LONG_TERM') === 'LONG TERM'", getStyleTagLabel('LONG_TERM') === 'LONG TERM');
check("LONG_TERM 결과에 언더스코어 없음", !getStyleTagLabel('LONG_TERM').includes('_'));

console.log('\n[D] 미매핑 폴백(raw 언더스코어 미노출)');
check("미매핑 'MEAN_REVERSION' → 'MEAN REVERSION'", getStyleTagLabel('MEAN_REVERSION') === 'MEAN REVERSION');
check('미매핑 다중 언더스코어도 전부 치환', !getStyleTagLabel('A_B_C').includes('_'));

console.log('\n[E] 회귀: 단어형 태그 그대로');
for (const word of ['VALUE', 'MOAT', 'GROWTH', 'GARP', 'QUANTITATIVE', 'MACRO', 'MOMENTUM']) {
  check(`getStyleTagLabel('${word}') === '${word}'`, getStyleTagLabel(word) === word);
}

console.log('\n[F] 소스 바인딩: 렌더 지점이 헬퍼 사용(raw {tag} 미노출)');
const sites = [
  join(root, 'components', 'philosophy', 'PhilosophyMasterCard.tsx'),
  join(root, 'app', 'philosophy', '[id].tsx'),
];
for (const site of sites) {
  const src = readFileSync(site, 'utf8');
  const rel = site.slice(root.length + 1);
  check(`${rel}: getStyleTagLabel import`, /import\s*\{[^}]*getStyleTagLabel[^}]*\}\s*from\s*'@utils\/styleTagLabel'/.test(src));
  check(`${rel}: styleTags 렌더에 getStyleTagLabel(tag) 사용`, src.includes('getStyleTagLabel(tag)'));
  // styleTags.map 블록 안에서 raw `{tag}` 직접 렌더가 없어야 함
  check(`${rel}: raw '{tag}' Text 렌더 없음`, !/>\s*\{tag\}\s*</.test(src));
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
