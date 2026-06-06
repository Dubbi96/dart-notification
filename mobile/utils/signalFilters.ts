// 등급무관 분석 탐색(DAR-46)의 필터·정렬 옵션 정본.
// 화면은 이 옵션 테이블을 import 해 칩/세그먼트를 렌더하고, value를 그대로 서비스 파라미터로 전달한다.
// 라벨 평문은 signalDisplay(gradeLabel)·disclosureType(EVENT_TYPE_LABEL)과 단일 출처를 공유한다.

import { gradeLabel } from './signalDisplay';
import { EVENT_TYPE_LABEL } from './disclosureType';

import type { SignalGrade, SignalSort } from '@app-types/signal.types';

export interface GradeFilterOption {
  /** undefined = 전체(등급무관) */
  value: SignalGrade | undefined;
  label: string;
}

// 등급은 강한매수→회피 순으로 노출(BLOCKED는 탐색 가치가 낮아 마지막).
const GRADE_ORDER: SignalGrade[] = [
  'STRONG_BUY',
  'BUY',
  'WATCH',
  'NEUTRAL',
  'AVOID',
  'BLOCKED',
];

export const GRADE_FILTER_OPTIONS: GradeFilterOption[] = [
  { value: undefined, label: '전체' },
  ...GRADE_ORDER.map((g) => ({ value: g, label: gradeLabel(g) })),
];

export interface PersonaFilterOption {
  /** undefined = 전체 */
  value: string | undefined;
  label: string;
}

// 백엔드 PERSONA_TYPES(GROWTH|VALUE|MOMENTUM|EVENT_DRIVEN)와 1:1.
export const PERSONA_FILTER_OPTIONS: PersonaFilterOption[] = [
  { value: undefined, label: '전체' },
  { value: 'GROWTH', label: '성장' },
  { value: 'VALUE', label: '가치' },
  { value: 'MOMENTUM', label: '모멘텀' },
  { value: 'EVENT_DRIVEN', label: '이벤트' },
];

export interface EventTypeFilterOption {
  /** undefined = 전체 */
  value: string | undefined;
  label: string;
}

// 이벤트유형은 EVENT_TYPE_LABEL(평문 매핑 단일 출처)에서 파생.
export const EVENT_TYPE_FILTER_OPTIONS: EventTypeFilterOption[] = [
  { value: undefined, label: '전체' },
  ...Object.entries(EVENT_TYPE_LABEL).map(([value, label]) => ({ value, label })),
];

export interface SignalSortOption {
  value: SignalSort;
  label: string;
  /** Feather 아이콘명 */
  icon: 'trending-down' | 'clock';
}

export const SIGNAL_SORT_OPTIONS: SignalSortOption[] = [
  { value: 'score', label: '점수순', icon: 'trending-down' },
  { value: 'latest', label: '최신순', icon: 'clock' },
];
