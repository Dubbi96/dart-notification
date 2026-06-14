/**
 * DAR-204 결정론적 검증: 설정 'Pro로 업그레이드' 배너 dead-end 정리.
 *
 * 수정 전: 배너 onPress=showSnackbar('서비스 준비중입니다') → 명시적 dead-end.
 * 수정 후: 배너 onPress=router.push('/settings-detail/pro') → 혜택/사전신청 화면 연결.
 *
 * 두 축을 검증한다.
 *   (A) 사전 신청 토글의 순수 로직 toggleWaitlist 진리표.
 *   (B) 소스 정합: 배너가 dead-end 스낵바가 아니라 Pro 화면으로 이동하고,
 *       Pro 화면 라우트가 실재함.
 *
 * 실행: npx tsx scripts/check-pro-upgrade-cta.ts  (실패 시 exit 1)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { toggleWaitlist } from '../utils/proWaitlist.ts';

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

// ── (A) toggleWaitlist 진리표 ──────────────────────────────────────────────
console.log('A. toggleWaitlist 순수 로직');
{
  const on = toggleWaitlist(false); // 미신청 → 신청
  assert('미신청→신청: next=true', on.next === true);
  assert('미신청→신청: 성공 햅틱', on.haptic === 'success');
  assert('미신청→신청: 안내 문구', on.message === '출시되면 알려드릴게요');

  const off = toggleWaitlist(true); // 신청 → 취소
  assert('신청→취소: next=false', off.next === false);
  assert('신청→취소: 가벼운 햅틱', off.haptic === 'light');
  assert('신청→취소: 취소 문구', off.message === '알림 신청을 취소했어요');

  // 멱등 왕복: 두 번 토글하면 원상 복귀
  const roundTrip = toggleWaitlist(toggleWaitlist(false).next).next;
  assert('두 번 토글 = 원상 복귀(false)', roundTrip === false);

  // dead-end 문구 제거: 더 이상 '서비스 준비중' 스낵바를 쓰지 않음
  assert('신청 문구는 dead-end 카피 아님', on.message !== '서비스 준비중입니다');
}

// ── (B) 소스 정합 ───────────────────────────────────────────────────────────
console.log('B. 소스 정합');
{
  const settings = readFileSync(join(mobileRoot, 'app/(tabs)/settings/index.tsx'), 'utf8');
  // 배너 영역(promoBanner)의 onPress가 dead-end 스낵바가 아니라 Pro 라우트로 이동
  assert('배너에 서비스 준비중 dead-end 스낵바 없음', !settings.includes("showSnackbar('서비스 준비중입니다')"));
  assert("배너 onPress가 /settings-detail/pro 로 이동", settings.includes("router.push('/settings-detail/pro')"));

  // Pro 화면 라우트 실재
  const proPath = join(mobileRoot, 'app/settings-detail/pro.tsx');
  assert('Pro 화면 라우트 파일 존재', existsSync(proPath));
  const pro = readFileSync(proPath, 'utf8');
  assert('Pro 화면이 혜택 항목을 정적 노출', pro.includes('무제한 관심기업') && pro.includes('고급 필터'));
  assert('Pro 화면이 사전 신청 토글 로직 사용', pro.includes('toggleWaitlist'));
  assert('Pro 화면이 결제 준비중을 솔직하게 안내', pro.includes('결제는 아직 준비 중'));
}

if (failed > 0) {
  console.error(`\n실패 ${failed}건`);
  process.exit(1);
}
console.log('\n전부 통과');
