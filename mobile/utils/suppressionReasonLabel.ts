// 신호 억제 사유(suppressionReason) enum → 한국어 배지 라벨 매핑 (DAR-323).
// 백엔드 buy-signal.service 가 BUY 미만 신호에 대해 '왜 강한 신호가 아닌지'를 enum 으로
// 도출해 내려보낸다(EVENT_STUDY_DARK …). 신호 상세가 이를 매핑 없이 노출하면 영문 enum 이
// 그대로 보여 NEUTRAL/WATCH 가 '판정'처럼 읽힌다(DAR-306 동류의 enum 누출).
// SSOT = 백엔드 suppression-reason.ts 의 SuppressionReason union(5종)과 1:1.
// 백엔드 점수 로직 미접촉 — 모바일 표시 라벨·아이콘만 부여한다.
//
// 핵심 가독성 목표: '근거 부족(데이터 결핍)'과 '정직하게 약함(데이터는 충분, 점수 낮음)'을
// 라벨에서 명확히 구분한다.

import type { SuppressionReason } from '@app-types/signal.types';

import type React from 'react';
import type { Feather } from '@expo/vector-icons';

type FeatherName = React.ComponentProps<typeof Feather>['name'];

export interface SuppressionReasonBadge {
  /** 배지 본문 라벨 */
  label: string;
  /** Feather 아이콘명(테마 토큰 색상은 호출부에서 지정) */
  icon: FeatherName;
}

const SUPPRESSION_REASON_BADGE: Record<SuppressionReason, SuppressionReasonBadge> = {
  // 데이터 결핍 계열 — '근거 부족: …'
  EVENT_STUDY_DARK: { label: '근거 부족: 과거 표본 부족', icon: 'database' },
  INDICATORS_MISSING: { label: '근거 부족: 기술적 지표 부족', icon: 'bar-chart-2' },
  UNMODELED_EVENT: { label: '근거 부족: 미모델 이벤트', icon: 'help-circle' },
  NO_POLARITY: { label: '근거 부족: 방향성 불명확', icon: 'compass' },
  // 데이터는 충분, 점수가 낮은 정직한 약세 — '근거 부족'이 아님을 분명히 구분
  GENUINELY_NEUTRAL: { label: '지표 충분 · 신호 약함', icon: 'minus-circle' },
};

/**
 * 억제 사유 enum → 배지(라벨+아이콘). 미매핑(향후 enum 추가)이면 raw enum 을 노출하지 않고
 * 안전한 한국어 기본 배지를 반환한다(raw 누출 차단).
 */
export function getSuppressionReasonBadge(
  reason: SuppressionReason | string,
): SuppressionReasonBadge {
  return (
    SUPPRESSION_REASON_BADGE[reason as SuppressionReason] ?? {
      label: '근거 부족',
      icon: 'alert-circle',
    }
  );
}
