/**
 * 신호 억제 사유(suppressionReason) 도출 — DAR-323 (가독성·정직성)
 *
 * 문제: A1(DAR-321) 이후 미모델/결측 버킷이 분모에서 omit 되면서 omittedBuckets 가
 *       의미를 갖게 됐다. 그러나 사용자에겐 WATCH/NEUTRAL 이 '판정'처럼 보여
 *       "근거가 부족해 강한 신호가 못 됐다"와 "근거는 충분하나 정직하게 약하다"를
 *       구분할 수 없다.
 *
 * 해법: BUY 미만 등급에 대해 omittedBuckets 와 등급에서 '왜 강한 신호가 아닌지'를
 *       순수 매핑으로 도출한다. **점수 산식·등급 임계값은 일절 건드리지 않는다**
 *       (Rule 금지영역). 표시용 라벨은 모바일이 소유(DAR-306/313/314 라벨맵 패턴) —
 *       여기서는 enum 만 도출한다.
 *
 * AI 금지영역: 순수 결정론 매핑. AI/LLM 개입 절대 금지.
 */

import { BucketKey } from './scoring/bucket-renormalization';
// 타입 전용 import — 런타임 순환참조 없음(컴파일 시 소거).
import type { SignalGrade } from './buy-signal.service';

export type SuppressionReason =
  /** 과거 유사 공시 표본(EventStudy) 미산출 → historicalEvent omit */
  | 'EVENT_STUDY_DARK'
  /** 기술적 지표(차트·거래량) 미산출 → chart/volumeLiquidity omit */
  | 'INDICATORS_MISSING'
  /** 핵심 수치 채점 규칙이 없는 미모델 이벤트 → keyMetric omit */
  | 'UNMODELED_EVENT'
  /** 방향성(polarity) 불명확으로 페르소나 적합도 정보 없음 → personaFit omit */
  | 'NO_POLARITY'
  /** 결측 버킷이 없는데도 점수가 낮음 = 근거는 충분, 정직하게 약한 신호 */
  | 'GENUINELY_NEUTRAL';

export interface SuppressionDerivation {
  /** 우선순위로 선정된 대표 사유 1개. BUY 이상·BLOCKED 는 null. */
  reason: SuppressionReason | null;
  /** 적용된 전체 사유 목록(우선순위 정렬). reason 없음이면 빈 배열. */
  reasons: SuppressionReason[];
}

/**
 * 억제 사유 도출.
 *
 * - STRONG_BUY/BUY: 충분히 강한 신호 → null(사유 없음).
 * - BLOCKED: 하드 차단은 blockedReason 이 전담 메시징 → suppressionReason 미사용(null).
 * - WATCH/NEUTRAL/AVOID: omittedBuckets 기반 데이터 결핍 사유를 우선순위로,
 *   결측이 하나도 없으면 GENUINELY_NEUTRAL(정직하게 약함).
 *
 * 우선순위(이슈 본문 열거 순): EVENT_STUDY_DARK > INDICATORS_MISSING >
 * UNMODELED_EVENT > NO_POLARITY > GENUINELY_NEUTRAL.
 * 복수 사유 시 reasons[0] 을 대표로 노출(배지 1개).
 */
export function deriveSuppressionReason(
  signal: SignalGrade,
  omittedBuckets: BucketKey[],
): SuppressionDerivation {
  // 충분히 강한 신호이거나, 하드 차단(blockedReason 전담)은 사유 미부여.
  if (
    signal === 'STRONG_BUY_CANDIDATE' ||
    signal === 'BUY_CANDIDATE' ||
    signal === 'BLOCKED'
  ) {
    return { reason: null, reasons: [] };
  }

  const omitted = new Set(omittedBuckets);
  const reasons: SuppressionReason[] = [];

  // push 순서 = 우선순위. reasons[0] 이 대표 사유.
  if (omitted.has('historicalEvent')) reasons.push('EVENT_STUDY_DARK');
  if (omitted.has('chart') || omitted.has('volumeLiquidity')) {
    reasons.push('INDICATORS_MISSING');
  }
  if (omitted.has('keyMetric')) reasons.push('UNMODELED_EVENT');
  if (omitted.has('personaFit')) reasons.push('NO_POLARITY');

  // 결측 기반 사유가 하나도 없으면: 근거는 충분한데 점수가 낮은 '정직한 약세'.
  if (reasons.length === 0) reasons.push('GENUINELY_NEUTRAL');

  return { reason: reasons[0], reasons };
}
