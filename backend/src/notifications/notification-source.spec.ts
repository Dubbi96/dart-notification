import { NotificationType } from '@prisma/client';
import {
  NOTIFICATION_SOURCES,
  FALLBACK_SOURCE,
  sourceByKey,
  sourceByType,
  sourcePrefix,
  gradeLabel,
  truncateForTitle,
} from './notification-source';

describe('notification-source SSOT (DAR-432)', () => {
  it('출처별 고유 이모지·라벨 매핑(기획 명세 1:1)', () => {
    expect(NOTIFICATION_SOURCES.disclosure).toMatchObject({ emoji: '📢', label: '공시' });
    expect(NOTIFICATION_SOURCES.signal).toMatchObject({ emoji: '📈', label: '매수신호' });
    expect(NOTIFICATION_SOURCES['paper-simulation']).toMatchObject({ emoji: '🤖', label: '모의' });
    expect(NOTIFICATION_SOURCES['intraday-scalp']).toMatchObject({ emoji: '⚡', label: '단타' });
    expect(NOTIFICATION_SOURCES['event-edge']).toMatchObject({ emoji: '🎯', label: '이벤트엣지' });
    expect(NOTIFICATION_SOURCES['conservative-value']).toMatchObject({ emoji: '🛡️', label: '보수가치' });
    expect(NOTIFICATION_SOURCES['short-momentum']).toMatchObject({ emoji: '🚀', label: '단기모멘텀' });
    expect(NOTIFICATION_SOURCES['aggressive-diversified']).toMatchObject({ emoji: '💥', label: '공격분산' });
  });

  it('이모지는 출처마다 고유(중복 0)', () => {
    const emojis = Object.values(NOTIFICATION_SOURCES).map((s) => s.emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
  });

  it('sourceByKey — 미상 키는 폴백(🔔)', () => {
    expect(sourceByKey('intraday-scalp').emoji).toBe('⚡');
    expect(sourceByKey('nope')).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(null)).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(undefined)).toBe(FALLBACK_SOURCE);
  });

  it('sourceByType — 체결 외 타입 매핑', () => {
    expect(sourceByType(NotificationType.DISCLOSURE).emoji).toBe('📢');
    expect(sourceByType(NotificationType.SIGNAL).emoji).toBe('📈');
    expect(sourceByType(NotificationType.EXIT).emoji).toBe('🔻');
    expect(sourceByType(NotificationType.THESIS_VIOLATED).emoji).toBe('⚠️');
    // 체결 타입은 strategyKey 가 필요 → 폴백.
    expect(sourceByType(NotificationType.TRADE_ENTRY)).toBe(FALLBACK_SOURCE);
  });

  it('sourcePrefix — "이모지 라벨"', () => {
    expect(sourcePrefix(NOTIFICATION_SOURCES['paper-simulation'])).toBe('🤖 모의');
  });

  it('gradeLabel — 한국어 등급, 미상은 원본', () => {
    expect(gradeLabel('STRONG_BUY_CANDIDATE')).toBe('적극매수');
    expect(gradeLabel('BUY_CANDIDATE')).toBe('매수');
    expect(gradeLabel('XYZ')).toBe('XYZ');
    expect(gradeLabel(null)).toBe('');
  });

  it('truncateForTitle — maxLen 초과만 … 부착', () => {
    expect(truncateForTitle('단일판매ㆍ공급계약', 24)).toBe('단일판매ㆍ공급계약');
    expect(truncateForTitle('가나다라마바사', 4)).toBe('가나다…');
    expect(truncateForTitle('', 10)).toBe('');
  });
});
