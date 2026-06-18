/**
 * DAR-320 deterministic check — icon-only TouchableOpacity buttons must carry
 * accessibilityRole='button' + a meaningful Korean accessibilityLabel.
 *
 * Covers the two reported gaps:
 *  1. components/common/Input.tsx — password show/hide toggle (label reflects state)
 *  2. app/settings-detail/saved-disclosures.tsx — bookmark unsave button
 *
 * Run: npx tsx scripts/check-icon-button-a11y.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..');
let pass = 0;
let fail = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}

// --- 1. Input.tsx password toggle ---
const input = readFileSync(join(root, 'components/common/Input.tsx'), 'utf8');
// extract the eye toggle TouchableOpacity block
const eyeStart = input.indexOf('onPress={() => setHidden');
const eyeBlock = input.slice(eyeStart, input.indexOf('</TouchableOpacity>', eyeStart));
check('Input: eye toggle has accessibilityRole="button"', /accessibilityRole="button"/.test(eyeBlock));
check('Input: eye toggle has state-reflecting accessibilityLabel', /accessibilityLabel=\{hidden \? '비밀번호 표시' : '비밀번호 숨기기'\}/.test(eyeBlock));
// label maps to action: when hidden(=eye-off shown), pressing reveals → '비밀번호 표시'
check('Input: hidden→표시 label semantics (reveal action)', eyeBlock.indexOf("hidden ? '비밀번호 표시'") !== -1);
check('Input: icon still toggles eye/eye-off (visual unchanged)', /name=\{hidden \? 'eye-off' : 'eye'\}/.test(input));

// --- 2. saved-disclosures.tsx bookmark unsave ---
const saved = readFileSync(join(root, 'app/settings-detail/saved-disclosures.tsx'), 'utf8');
const bmStart = saved.indexOf('onPress={() => handleRemove');
const bmBlock = saved.slice(saved.lastIndexOf('<TouchableOpacity', bmStart), saved.indexOf('</TouchableOpacity>', bmStart));
check('SavedDisclosures: bookmark button has accessibilityRole="button"', /accessibilityRole="button"/.test(bmBlock));
check('SavedDisclosures: bookmark button has accessibilityLabel="저장 해제"', /accessibilityLabel="저장 해제"/.test(bmBlock));
check('SavedDisclosures: bookmark icon unchanged (Ionicons name="bookmark")', /<Ionicons name="bookmark"/.test(saved));
check('SavedDisclosures: onPress still wired to handleRemove (action unchanged)', /onPress=\{\(\) => handleRemove\(item\.id, item\.rcpNo\)\}/.test(bmBlock));

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
