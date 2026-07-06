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

describe('notification-source SSOT (DAR-432 · 2026-07-06 이모지 제거 개정)', () => {
  it('출처별 라벨 매핑(기획 명세 1:1)', () => {
    expect(NOTIFICATION_SOURCES.disclosure).toMatchObject({ label: '공시' });
    expect(NOTIFICATION_SOURCES.signal).toMatchObject({ label: '매수신호' });
    expect(NOTIFICATION_SOURCES['paper-simulation']).toMatchObject({ label: '모의' });
    expect(NOTIFICATION_SOURCES['intraday-scalp']).toMatchObject({ label: '단타' });
    expect(NOTIFICATION_SOURCES['event-edge']).toMatchObject({ label: '이벤트엣지' });
    expect(NOTIFICATION_SOURCES['conservative-value']).toMatchObject({ label: '보수가치' });
    expect(NOTIFICATION_SOURCES['short-momentum']).toMatchObject({ label: '단기모멘텀' });
    expect(NOTIFICATION_SOURCES['aggressive-diversified']).toMatchObject({ label: '공격분산' });
    // 개장 체결 정렬(2026-07-06): 철학 스타일 4종 체결 알림 출처.
    expect(NOTIFICATION_SOURCES.BUFFETT).toMatchObject({ label: '버핏' });
    expect(NOTIFICATION_SOURCES.LYNCH).toMatchObject({ label: '린치' });
    expect(NOTIFICATION_SOURCES.GREENBLATT).toMatchObject({ label: '그린블라트' });
    expect(NOTIFICATION_SOURCES.DRUCKENMILLER).toMatchObject({ label: '드러켄밀러' });
    // DAR-473(P01): 리스크·운영 출처.
    expect(NOTIFICATION_SOURCES.risk).toMatchObject({ label: '리스크' });
    expect(NOTIFICATION_SOURCES.ops).toMatchObject({ label: '운영' });
  });

  it('출처 키 개수 = 16 — mobile/scripts/check-notification-sources.ts EXPECTED 와 동수(be↔fe SSOT)', () => {
    expect(Object.keys(NOTIFICATION_SOURCES)).toHaveLength(16);
  });

  it('라벨은 출처마다 고유(중복 0) — 이모지 없이 텍스트만으로 식별 성립', () => {
    const labels = Object.values(NOTIFICATION_SOURCES).map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('출처 라벨에 이모지 미포함(2026-07-06 사용자 결정)', () => {
    const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u;
    for (const src of [...Object.values(NOTIFICATION_SOURCES), FALLBACK_SOURCE]) {
      expect(src.label).not.toMatch(EMOJI_RE);
      expect(src.label).not.toContain('\uFE0F');
      expect(sourcePrefix(src)).not.toMatch(EMOJI_RE);
    }
  });

  it('sourceByKey — 미상 키는 폴백(알림)', () => {
    expect(sourceByKey('intraday-scalp').label).toBe('단타');
    expect(sourceByKey('nope')).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(null)).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(undefined)).toBe(FALLBACK_SOURCE);
  });

  it('sourceByKey — 전략 styleTag(strategy:<key>) 접두사 정규화(개장 체결 정렬 2026-07-06)', () => {
    expect(sourceByKey('strategy:event-edge').label).toBe('이벤트엣지');
    expect(sourceByKey('strategy:short-momentum').label).toBe('단기모멘텀');
    expect(sourceByKey('BUFFETT').label).toBe('버핏');
    expect(sourceByKey('DRUCKENMILLER').label).toBe('드러켄밀러');
    // 미등록 전략 키는 접두사를 벗겨도 미상 → 폴백(위장 라벨 금지).
    expect(sourceByKey('strategy:nope')).toBe(FALLBACK_SOURCE);
  });

  it('sourceByType — 체결 외 타입 매핑', () => {
    expect(sourceByType(NotificationType.DISCLOSURE).label).toBe('공시');
    expect(sourceByType(NotificationType.SIGNAL).label).toBe('매수신호');
    expect(sourceByType(NotificationType.EXIT).label).toBe('청산');
    expect(sourceByType(NotificationType.THESIS_VIOLATED).label).toBe('논리훼손');
    // 체결 타입은 strategyKey 가 필요 → 폴백.
    expect(sourceByType(NotificationType.TRADE_ENTRY)).toBe(FALLBACK_SOURCE);
    // DAR-473(P01): 리스크·운영 타입 매핑.
    expect(sourceByType(NotificationType.RISK_ALERT).label).toBe('리스크');
    expect(sourceByType(NotificationType.OPS_ALERT).label).toBe('운영');
  });

  it('sourcePrefix — 라벨 텍스트만(이모지 없음)', () => {
    expect(sourcePrefix(NOTIFICATION_SOURCES['paper-simulation'])).toBe('모의');
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
