import { NotificationType } from '@prisma/client';

/**
 * DAR-432 → 2026-07-06 개정: 알림 '출처(source)' → 출처명(라벨) 단일 진실원천(SSOT).
 *
 * 목적: 푸시·인앱 알림을 "어디서 발행했는지 한눈에" 보이게 한다.
 *  - ★이모지 미사용(사용자 결정 2026-07-06): 출처 구분은 **라벨 텍스트 프리픽스**(푸시 제목),
 *    인앱은 Feather 아이콘+타입 컬러(notifications/index.tsx), OS 레벨은 Android 채널
 *    (DAR-430 channelIdForType)이 담당한다 — 세 축 모두 이모지 없이 구분 성립.
 *  - DAR-430 카테고리(3 버킷: 공시/신호/체결)는 Android 채널·인앱 필터 축이고,
 *    출처(source)는 그보다 ★세분화된 발행원(시스템 모의/단타/4전략 등) 축이다(상호보완).
 *  - 체결(TRADE) 알림은 트랙별로 출처가 갈리므로 strategyKey 로 식별한다.
 *  - 그 외 타입(공시·신호·청산·논리훼손)은 NotificationType 으로 식별한다.
 *
 * ★FE 미러: mobile/utils/notificationSource.ts 와 라벨이 정확히 일치해야 한다
 *   (mobile/scripts/check-notification-sources.ts 가 결정론적으로 검증 — be↔fe SSOT 공유).
 */
export interface NotificationSource {
  /** 출처 키(NotificationType 파생 키 또는 트랙 strategyKey). */
  key: string;
  /** 출처명(짧은 한국어 라벨 — 푸시 제목 프리픽스·인앱 구분의 유일 텍스트 축). */
  label: string;
}

/**
 * 출처 키 → 라벨. ★mobile/utils/notificationSource.ts 의 NOTIFICATION_SOURCES 와
 * 정확히 동일해야 한다(parity 체크 스크립트가 강제). 라벨은 출처마다 고유(중복 0).
 *
 * 트랙 키(체결): 'paper-simulation'·'intraday-scalp' + 4전략 preset key.
 * 타입 키(체결 외): 'disclosure'·'signal'·'exit'·'thesis'.
 * 철학 스타일 키(체결): BUFFETT·LYNCH·GREENBLATT·DRUCKENMILLER(개장 체결 정렬 2026-07-06).
 * 전략 forward 체결은 strategyKey='strategy:<key>' — sourceByKey 가 접두사를 벗겨 정규화한다.
 */
export const NOTIFICATION_SOURCES: Record<string, NotificationSource> = {
  // ── 체결 외(NotificationType 파생) ──────────────────────────────────────────
  disclosure: { key: 'disclosure', label: '공시' },
  signal: { key: 'signal', label: '매수신호' },
  exit: { key: 'exit', label: '청산' },
  thesis: { key: 'thesis', label: '논리훼손' },
  // ── 체결(트랙 strategyKey) ──────────────────────────────────────────────────
  'paper-simulation': { key: 'paper-simulation', label: '모의' },
  'intraday-scalp': { key: 'intraday-scalp', label: '단타' },
  'event-edge': { key: 'event-edge', label: '이벤트엣지' },
  'short-momentum': { key: 'short-momentum', label: '단기모멘텀' },
  'conservative-value': { key: 'conservative-value', label: '보수가치' },
  'aggressive-diversified': { key: 'aggressive-diversified', label: '공격분산' },
  // ── 체결(철학 스타일 4종 — 개장 체결 정렬 2026-07-06로 철학 트랙도 체결 알림 발행) ──
  BUFFETT: { key: 'BUFFETT', label: '버핏' },
  LYNCH: { key: 'LYNCH', label: '린치' },
  GREENBLATT: { key: 'GREENBLATT', label: '그린블라트' },
  DRUCKENMILLER: { key: 'DRUCKENMILLER', label: '드러켄밀러' },
  // ── 리스크·운영(DAR-473 P01·NotificationType 파생) ──────────────────────────
  risk: { key: 'risk', label: '리스크' },
  ops: { key: 'ops', label: '운영' },
};

/** 미상 출처 폴백(미등록 strategyKey 등). */
export const FALLBACK_SOURCE: NotificationSource = {
  key: 'unknown',
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

/** 출처 키로 출처 조회(미상은 폴백).
 *  전략 forward 체결(개장 체결 정렬 2026-07-06)은 styleTag('strategy:<key>')를 strategyKey 로
 *  그대로 싣는다 — 접두사를 벗겨 프리셋 키로 정규화해 동일 라벨 SSOT 를 재사용한다. */
export function sourceByKey(key?: string | null): NotificationSource {
  if (!key) return FALLBACK_SOURCE;
  const normalized = key.startsWith('strategy:') ? key.slice('strategy:'.length) : key;
  return NOTIFICATION_SOURCES[normalized] ?? FALLBACK_SOURCE;
}

/** NotificationType(체결 외) → 출처. 체결 타입은 strategyKey 가 필요하므로 폴백. */
export function sourceByType(type: NotificationType): NotificationSource {
  return sourceByKey(TYPE_SOURCE_KEY[type]);
}

/** 출처 라벨 프리픽스(예: '모의') — 푸시 제목 '{출처} · {내용}' 템플릿용. */
export function sourcePrefix(src: NotificationSource): string {
  return src.label;
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
