/**
 * DAR-368 결정론적 검증: 시스템 트레이딩 자동 동작 라벨 정합.
 *
 * 사용자 지적: 모의투자는 **시스템 트레이딩 현황**이다 — -20%(하드손절 초과) 포지션이
 *   '매도 검토 필요'(수동 암시)로 떠 있으면 안 된다. 하드룰 손절·청산(EXIT)은 Engine5가
 *   자동 체결하므로 사용자 승인이 불필요하다.
 *
 * 이 스크립트가 검증하는 것:
 *  (A) positionSystemAction 행동(실행): EXIT → '자동 매도 예정'(auto-sell·isAutoSell), 우선순위.
 *  (B) VIOLATED(소프트, EXIT 아님) → '시스템 모니터링'(monitoring·자동 판단·사용자 조치 불요).
 *  (C) 그 외(유효/관찰/만료) → Thesis 라벨(neutral·isAutoSell=false).
 *  (D) 어떤 조합도 수동 암시 '검토 필요'를 라벨/a11y에 포함하지 않음(전수).
 *  (E) 소스 바인딩 PositionCard.tsx: positionSystemAction 사용, '매도 검토 필요' 부재, zap 아이콘.
 *  (F) 소스 바인딩 포지션 상세 index.tsx: positionSystemAction 사용, thesisStatusLabel 칩 제거,
 *      '검토 필요' 부재, 자동 매도 고지 배너 존재.
 *
 * 실행: npx tsx scripts/check-position-system-action.ts  (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThesisStatus } from '../types/portfolio.types.ts';
import type { ExitAction } from '../types/signal.types.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const ALL_STATUS: ThesisStatus[] = ['ACTIVE', 'WATCHING', 'VIOLATED', 'EXPIRED'];
const ALL_EXIT: (ExitAction | undefined)[] = [
  undefined,
  'HOLD',
  'WATCH',
  'REDUCE',
  'EXIT',
  'BLOCK_REBUY',
];

async function main() {
  // signalDisplay → copy.ts 가 RN 전역 __DEV__ 를 모듈 로드 시 참조한다(노드엔 미정의).
  // 동적 import 전에 전역을 정의해 순수 헬퍼를 실제 실행으로 검증한다(소스 바인딩보다 강한 보증).
  (globalThis as unknown as { __DEV__: boolean }).__DEV__ = false;
  const { positionSystemAction, thesisStatusLabel } = await import('../utils/signalDisplay.ts');

  // ── (A) EXIT → 자동 매도 예정(우선순위: thesisStatus 무관) ──
  for (const status of ALL_STATUS) {
    const a = positionSystemAction({ thesisStatus: status, exitAction: 'EXIT' });
    check(
      `EXIT(${status}) → '자동 매도 예정' auto-sell`,
      a.tone === 'auto-sell' && a.isAutoSell === true && a.label === '자동 매도 예정',
      `got tone=${a.tone} label=${a.label}`,
    );
  }
  // 하드손절·청산이 thesis 유효(ACTIVE)에서도 자동 매도로 우선 — '검토 필요' 거짓 프레이밍 차단의 핵심.
  const hardStopIntact = positionSystemAction({ thesisStatus: 'ACTIVE', exitAction: 'EXIT' });
  check(
    '하드손절(thesis ACTIVE+EXIT) → auto-sell 우선(검토 필요 아님)',
    hardStopIntact.tone === 'auto-sell' && hardStopIntact.isAutoSell,
  );

  // ── (B) VIOLATED(소프트, EXIT 아님) → 시스템 모니터링 ──
  const violatedSoft = positionSystemAction({ thesisStatus: 'VIOLATED' });
  check(
    "VIOLATED(EXIT 아님) → '시스템 모니터링' monitoring",
    violatedSoft.tone === 'monitoring' &&
      violatedSoft.isAutoSell === false &&
      violatedSoft.label === '시스템 모니터링',
    `got tone=${violatedSoft.tone} label=${violatedSoft.label}`,
  );
  // 모니터링도 자동 판단 — a11y 가 '사용자 조치 불필요'를 명시(수동 액션 암시 금지).
  check(
    '모니터링 a11y: 사용자 조치 불필요 명시',
    violatedSoft.a11yLabel.includes('조치 불필요'),
    violatedSoft.a11yLabel,
  );

  // ── (C) 그 외 상태(EXIT 아님) → Thesis 라벨 neutral ──
  for (const status of ['ACTIVE', 'WATCHING', 'EXPIRED'] as ThesisStatus[]) {
    const a = positionSystemAction({ thesisStatus: status });
    check(
      `${status}(EXIT 아님) → neutral, 라벨=${thesisStatusLabel(status)}`,
      a.tone === 'neutral' && a.isAutoSell === false && a.label === thesisStatusLabel(status),
      `got tone=${a.tone} label=${a.label}`,
    );
  }

  // ── (D) 전수: 어떤 조합도 수동 '검토 필요'를 라벨/a11y에 포함하지 않음 ──
  let manualLeak = 0;
  for (const status of ALL_STATUS) {
    for (const exit of ALL_EXIT) {
      const a = positionSystemAction({ thesisStatus: status, exitAction: exit });
      if (a.label.includes('검토 필요') || a.a11yLabel.includes('검토 필요')) manualLeak++;
    }
  }
  check('전수(24조합): 수동 검토 필요 라벨/a11y 부재', manualLeak === 0, `leaks=${manualLeak}`);

  // ── (E) 소스 바인딩: PositionCard.tsx ──
  const cardSrc = readFileSync(join(root, 'components/portfolio/PositionCard.tsx'), 'utf8');
  check('PositionCard: positionSystemAction import/사용', /positionSystemAction\(/.test(cardSrc));
  check("PositionCard: 수동 '매도 검토 필요' 문구 제거(회귀)", !cardSrc.includes('매도 검토 필요'));
  check('PositionCard: 자동 매도 zap 아이콘', /name="zap"/.test(cardSrc));
  check('PositionCard: 모니터링 activity 아이콘', /name="activity"/.test(cardSrc));
  check('PositionCard: 칩 라벨=action.label(엔진 일치)', /\{action\.label\}/.test(cardSrc));
  check(
    'PositionCard: 자동 매도 솔리드 강조(error 배경)',
    /isAutoSell \? colors\.error : colors\.surfaceSecondary/.test(cardSrc),
  );

  // ── (F) 소스 바인딩: 포지션 상세 index.tsx ──
  const detailSrc = readFileSync(
    join(root, 'app/portfolio/[portfolioId]/position/[positionId]/index.tsx'),
    'utf8',
  );
  check('상세: positionSystemAction import/사용', /positionSystemAction\(/.test(detailSrc));
  check('상세: thesisStatusLabel import 제거(칩 대체)', !/thesisStatusLabel/.test(detailSrc));
  check("상세: '검토 필요' 수동 문구 부재", !detailSrc.includes('검토 필요'));
  check('상세: 칩 라벨=action.label', /\{action\.label\}/.test(detailSrc));
  check('상세: 자동 매도 고지 배너(autoSellNotice)', /autoSellNotice/.test(detailSrc));
  check(
    "상세: 배너 평문 '자동 매도'·'조치는 필요하지 않'",
    /자동 매도/.test(detailSrc) && /조치는 필요하지\s+않/.test(detailSrc),
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
