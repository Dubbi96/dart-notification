/**
 * DAR-209 결정론적 검증: 온보딩이 공시/알림만 설명하고 신호·포트폴리오(AI 투자판단)
 * 가치를 전달하지 않던 문제를, 마지막 '가치 안내' 단계 추가로 해소했는지 검증한다.
 *
 * 수정 전: onboarding 2단계(관심기업 → 푸시)뿐. 푸시 단계가 곧장 completeOnboarding +
 *          홈 이동 → intro 캐러셀이 약속한 AI 매수판단·거장 철학이 가입 직후 사라짐.
 * 수정 후: 3단계(관심기업 → 푸시 → 신호·포트폴리오 가치). 푸시 단계는 setStep(3)으로
 *          이어지고, 가치 단계 CTA가 신호 탭/홈으로 이동하며 완료.
 *
 * 두 축을 검증한다.
 *   (A) 순수 단계 머신/라우트(onboardingFlow.ts) 진리표.
 *   (B) 소스 정합: 화면이 3단계 가치 안내를 렌더하고, 푸시 핸들러가 더 이상
 *       직접 완료/홈이동하지 않으며, 신호·포트폴리오 가치 카피·라우트가 실재함.
 *
 * 실행: node scripts/check-onboarding-value-step.ts  (실패 시 exit 1)
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  ONBOARDING_TOTAL_STEPS,
  nextOnboardingStep,
  onboardingExitRoute,
} from '../utils/onboardingFlow.ts';

const here = dirname(fileURLToPath(import.meta.url));
const mobileRoot = join(here, '..');

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures++;
  }
}

// ── (A) 순수 단계 머신 진리표 ───────────────────────────────────────────────
console.log('(A) 단계 머신/라우트 진리표');
assert('총 단계 = 3 (관심기업·푸시·가치)', ONBOARDING_TOTAL_STEPS === 3);
assert('1단계 → 2단계', nextOnboardingStep(1) === 2);
assert('2단계(푸시) → 3단계(가치)  ← 핵심 수정', nextOnboardingStep(2) === 3);
assert('3단계 → 완료(null)', nextOnboardingStep(3) === null);
assert("'신호 보러 가기' → 신호 탭", onboardingExitRoute('signals') === '/(tabs)/signals');
assert("'홈으로' → 홈 탭", onboardingExitRoute('home') === '/(tabs)/home');

// ── (B) 소스 정합 ──────────────────────────────────────────────────────────
console.log('(B) 소스 정합');
const screenPath = join(mobileRoot, 'app/onboarding/index.tsx');
const screen = readFileSync(screenPath, 'utf8');

assert('3단계 가치 렌더 분기 존재 (step === 3)', /if\s*\(\s*step\s*===\s*3\s*\)/.test(screen));
assert("3단계 인디케이터 '3단계 /' 노출", screen.includes('3단계 /'));
assert('신호 가치 카피 — AI 매수 판단', screen.includes('신호 — AI 매수 판단'));
assert('포트폴리오 가치 카피', screen.includes('포트폴리오 — 보유 종목 추적'));
assert('거장 철학 재연결 카피', screen.includes('거장'));
assert("주 CTA '신호 보러 가기' 존재", screen.includes('신호 보러 가기'));
assert('가치 카드 아이콘 import (ChartLineUp·Briefcase)',
  screen.includes('ChartLineUp') && screen.includes('Briefcase'));
assert('AI 면책(참고 정보·투자자문 아님) 명시',
  screen.includes('참고 정보') && screen.includes('투자자문'));

// 푸시 핸들러가 더 이상 직접 완료/홈이동하지 않고 3단계로 이어져야 한다.
const enableBlock = screen.slice(
  screen.indexOf('const handleEnableNotifications'),
  screen.indexOf('const handleSkipNotifications'),
);
const skipBlock = screen.slice(
  screen.indexOf('const handleSkipNotifications'),
  screen.indexOf('const handleFinish'),
);
assert('알림 받기 핸들러 → setStep(3)', enableBlock.includes('setStep(3)'));
assert('알림 받기 핸들러: 직접 completeOnboarding 제거', !enableBlock.includes('completeOnboarding'));
assert('나중에 하기 핸들러 → setStep(3)', skipBlock.includes('setStep(3)'));
assert('나중에 하기 핸들러: 직접 completeOnboarding 제거', !skipBlock.includes('completeOnboarding'));

// 하드코딩된 옛 '/ 2' 단계 표기가 남아있지 않아야 한다.
assert("옛 '단계 / 2' 하드코딩 잔존 없음", !/단계\s*\/\s*2(?!\d)/.test(screen));

// 종료 라우트 대상 탭이 실재해야 한다.
assert('신호 탭 라우트 실재', existsSync(join(mobileRoot, 'app/(tabs)/signals/index.tsx')));
assert('포트폴리오 탭 라우트 실재', existsSync(join(mobileRoot, 'app/(tabs)/portfolio/index.tsx')));
assert('홈 탭 라우트 실재', existsSync(join(mobileRoot, 'app/(tabs)/home/index.tsx')));

console.log('');
if (failures > 0) {
  console.error(`DAR-209 check 실패: ${failures}건`);
  process.exit(1);
}
console.log('DAR-209 check 전부 통과');
