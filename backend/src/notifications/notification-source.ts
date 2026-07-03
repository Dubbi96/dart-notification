import { NotificationType } from '@prisma/client';

/**
 * DAR-432: 알림 '출처(source)' → 고유 이모지 + 출처명 단일 진실원천(SSOT).
 *
 * 목적: 푸시·인앱 알림을 "어디서 발행했는지 한눈에"(고유 이모지 + 출처명) 보이게 한다.
 *  - DAR-430 카테고리(3 버킷: 공시/신호/체결)는 Android 채널·인앱 필터 축이고,
 *    출처(source)는 그보다 ★세분화된 발행원(시스템 모의/단타/4전략 등) 축이다(상호보완).
 *  - 체결(TRADE) 알림은 트랙별로 출처가 갈리므로 strategyKey 로 식별한다.
 *  - 그 외 타입(공시·신호·청산·논리훼손)은 NotificationType 으로 식별한다.
 *
 * ★FE 미러: mobile/utils/notificationSource.ts 와 이모지·라벨이 정확히 일치해야 한다
 *   (mobile/scripts/check-notification-sources.ts 가 결정론적으로 검증 — be↔fe SSOT 공유).
 */
export interface NotificationSource {
  /** 출처 키(NotificationType 파생 키 또는 트랙 strategyKey). */
  key: string;
  /** 고유 이모지(한눈 식별). */
  emoji: string;
  /** 출처명(짧은 한국어 라벨). */
  label: string;
}

/**
 * 출처 키 → 이모지·라벨. ★mobile/utils/notificationSource.ts 의 NOTIFICATION_SOURCES 와
 * 정확히 동일해야 한다(parity 체크 스크립트가 강제).
 *
 * 트랙 키(체결): 'paper-simulation'·'intraday-scalp' + 4전략 preset key.
 * 타입 키(체결 외): 'disclosure'·'signal'·'exit'·'thesis'.
 */
export const NOTIFICATION_SOURCES: Record<string, NotificationSource> = {
  // ── 체결 외(NotificationType 파생) ──────────────────────────────────────────
  disclosure: { key: 'disclosure', emoji: '📢', label: '공시' },
  signal: { key: 'signal', emoji: '📈', label: '매수신호' },
  exit: { key: 'exit', emoji: '🔻', label: '청산' },
  thesis: { key: 'thesis', emoji: '⚠️', label: '논리훼손' },
  // ── 체결(트랙 strategyKey) ──────────────────────────────────────────────────
  'paper-simulation': { key: 'paper-simulation', emoji: '🤖', label: '모의' },
  'intraday-scalp': { key: 'intraday-scalp', emoji: '⚡', label: '단타' },
  'event-edge': { key: 'event-edge', emoji: '🎯', label: '이벤트엣지' },
  'short-momentum': { key: 'short-momentum', emoji: '🚀', label: '단기모멘텀' },
  'conservative-value': { key: 'conservative-value', emoji: '🛡️', label: '보수가치' },
  'aggressive-diversified': { key: 'aggressive-diversified', emoji: '💥', label: '공격분산' },
  // ── 리스크·운영(DAR-473 P01·NotificationType 파생) ──────────────────────────
  risk: { key: 'risk', emoji: '🛑', label: '리스크' },
  ops: { key: 'ops', emoji: '⚙️', label: '운영' },
};

/** 미상 출처 폴백(미등록 strategyKey 등). */
export const FALLBACK_SOURCE: NotificationSource = {
  key: 'unknown',
  emoji: '🔔',
  label: '알림',
};

/** 체결 외 NotificationType → 출처 키. */
const TYPE_SOURCE_KEY: Partial<Record<NotificationType, string>> = {
  [NotificationType.DISCLOSURE]: 'disclosure',
  [NotificationType.SIGNAL]: 'signal',
  [NotificationType.EXIT]: 'exit',
  [NotificationType.THESIS_VIOLATED]: 'thesis',
  // DAR-473(P01): 리스크·운영 알림 출처.
  [NotificationType.RISK_ALERT]: 'risk',
  [NotificationType.OPS_ALERT]: 'ops',
};

/** 출처 키로 출처 조회(미상은 폴백). */
export function sourceByKey(key?: string | null): NotificationSource {
  if (key && NOTIFICATION_SOURCES[key]) return NOTIFICATION_SOURCES[key];
  return FALLBACK_SOURCE;
}

/** NotificationType(체결 외) → 출처. 체결 타입은 strategyKey 가 필요하므로 폴백. */
export function sourceByType(type: NotificationType): NotificationSource {
  return sourceByKey(TYPE_SOURCE_KEY[type]);
}

/** "이모지 라벨" 프리픽스(예: '🤖 모의'). */
export function sourcePrefix(src: NotificationSource): string {
  return `${src.emoji} ${src.label}`;
}

/**
 * SignalGrade(또는 producer 가 전달한 등급 문자열) → 한국어 등급 라벨.
 * 미상 값은 원본을 그대로 반환(do-no-harm).
 */
export const SIGNAL_GRADE_LABEL: Record<string, string> = {
  STRONG_BUY_CANDIDATE: '적극매수',
  BUY_CANDIDATE: '매수',
  STRONG_BUY: '적극매수',
  BUY: '매수',
  WATCH: '관찰',
  NEUTRAL: '중립',
  AVOID: '회피',
  BLOCKED: '제외',
};

export function gradeLabel(grade?: string | null): string {
  if (!grade) return '';
  return SIGNAL_GRADE_LABEL[grade] ?? grade;
}

/**
 * 알림 제목 길이 가이드(≤약 40자, 잠금화면 잘림 고려)를 위해 긴 토막을 절단(… 부착).
 * maxLen 이하면 원본 그대로. 순수 함수.
 */
export function truncateForTitle(text: string, maxLen: number): string {
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}
