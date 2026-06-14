/**
 * DAR-213 결정론적 검증: 게스트 신호 탭 read-only 미리보기.
 *
 * 수정 전: 게스트 신호 탭 = GuestPrompt(텍스트 카피 + CTA)만. 신호 가치를 '읽기로'
 *          맛볼 경로가 홈 1건뿐.
 * 수정 후: 게스트 신호 탭 = GuestSignalPreview(블러+잠금 미리보기 카드 + 로그인 CTA).
 *
 * 세 축을 검증한다.
 *   (A) guestPreviewCards 순수 클램프 로직 진리표(1~2건, 음수/과대 흡수).
 *   (B) 정직 원칙: 카드 데이터에 실점수 텍스트/가짜 등급어가 없고, '예시' 표기 존재.
 *   (C) 소스 정합: 신호 탭이 GuestPrompt가 아니라 GuestSignalPreview를 게스트에 렌더,
 *       컴포넌트가 블러·잠금·로그인 CTA·보조 동선을 갖춤.
 *
 * 실행: npx tsx scripts/check-guest-signal-preview.ts  (실패 시 exit 1)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  guestPreviewCards,
  GUEST_PREVIEW_CARDS,
  GUEST_PREVIEW_COPY,
} from '../utils/guestSignalPreview.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');

let failed = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failed += 1;
  }
}

// ── (A) guestPreviewCards 클램프 진리표 ─────────────────────────────────────
console.log('A. guestPreviewCards 순수 로직');
{
  assert('0 → 최소 1건', guestPreviewCards(0).length === 1);
  assert('음수(-3) → 최소 1건', guestPreviewCards(-3).length === 1);
  assert('1 → 1건', guestPreviewCards(1).length === 1);
  assert('2 → 2건', guestPreviewCards(2).length === 2);
  assert('과대(99) → 보유 카드 수로 상한', guestPreviewCards(99).length === GUEST_PREVIEW_CARDS.length);
  assert('소수(1.9) → floor 적용 1건', guestPreviewCards(1.9).length === 1);
  // read-only: 반환 카드는 정본 순서를 보존(상위부터)
  assert('상위부터 슬라이스', guestPreviewCards(2)[0].maskedName === GUEST_PREVIEW_CARDS[0].maskedName);
}

// ── (B) 정직 원칙(과대약속 금지) ────────────────────────────────────────────
console.log('B. 정직 원칙');
{
  // 마스킹: 실종목명 대신 ○ 마스크. 숫자/퍼센트 텍스트 없음.
  for (const card of GUEST_PREVIEW_CARDS) {
    assert(`'${card.maskedName}' 마스킹 표기(○ 포함)`, card.maskedName.includes('○'));
    assert(`'${card.maskedName}' 숫자 텍스트 없음`, !/[0-9]/.test(card.maskedName));
    assert(`'${card.maskedName}' fill 0~1 범위`, card.fill >= 0 && card.fill <= 1);
  }
  // 가짜 매수/등급어를 데이터로 단언하지 않음(블러 실루엣만)
  const serialized = JSON.stringify(GUEST_PREVIEW_CARDS);
  assert('카드 데이터에 가짜 등급어(매수/BUY) 없음', !/매수|BUY|강력/.test(serialized));
  // '예시' 배지로 실데이터 아님 명시
  assert("'예시' 배지 카피 존재", GUEST_PREVIEW_COPY.exampleBadge === '예시');
  assert('잠금 배지가 로그인 유도', GUEST_PREVIEW_COPY.lockBadge.includes('로그인'));
}

// ── (C) 소스 정합 ───────────────────────────────────────────────────────────
console.log('C. 소스 정합');
{
  const signals = readFileSync(join(mobileRoot, 'app/(tabs)/signals/index.tsx'), 'utf8');
  assert('신호 탭이 GuestSignalPreview 렌더', signals.includes('<GuestSignalPreview'));
  assert('게스트 분기에 보조 동선 전달', signals.includes("secondaryLabel=\"공시 먼저 둘러보기\""));
  // 더 이상 텍스트 전용 GuestPrompt로 게스트 신호 탭을 막지 않음
  assert('신호 탭 게스트 분기에서 GuestPrompt 제거', !signals.includes('<GuestPrompt'));

  const cmpPath = join(mobileRoot, 'components/signals/GuestSignalPreview.tsx');
  assert('GuestSignalPreview 컴포넌트 파일 존재', existsSync(cmpPath));
  const cmp = readFileSync(cmpPath, 'utf8');
  assert('블러 오버레이 사용(expo-blur)', cmp.includes('BlurView') && cmp.includes('expo-blur'));
  assert('잠금 아이콘 노출', cmp.includes("name=\"lock\""));
  assert('로그인 라우트 CTA', cmp.includes("/auth/sign-in"));
  assert('정본 미리보기 데이터 사용', cmp.includes('guestPreviewCards'));
  assert('정본 신호 카피 재사용(과대약속 방지)', cmp.includes('guestPromptCopy.signals'));
  // 44pt 터치 타겟·a11y 라벨(테마/접근성 DoD)
  assert('미리보기 a11y 라벨 존재', cmp.includes('accessibilityLabel'));
}

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\n전부 통과');
