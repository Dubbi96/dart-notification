import {
  FALLBACK_SOURCE,
  NOTIFICATION_SOURCES,
  sourceByKey,
  sourceByType,
  sourcePrefix,
  stripSourceEmoji,
} from '@utils/notificationSource';

// 알림 출처 라벨 SSOT(백엔드 notification-source.ts 미러) 회귀 가드.
describe('utils/notificationSource', () => {
  it('등록된 출처 키 전수가 자기 자신을 해소하고 라벨이 비어있지 않다', () => {
    for (const [key, source] of Object.entries(NOTIFICATION_SOURCES)) {
      expect(sourceByKey(key)).toBe(source);
      expect(source.key).toBe(key);
      expect(source.label.length).toBeGreaterThan(0);
    }
  });

  it("전략 forward 체결 키('strategy:<key>')는 접두사를 벗겨 프리셋으로 정규화한다", () => {
    expect(sourceByKey('strategy:intraday-scalp')).toBe(
      NOTIFICATION_SOURCES['intraday-scalp'],
    );
    expect(sourceByKey('strategy:BUFFETT')).toBe(NOTIFICATION_SOURCES.BUFFETT);
  });

  it('미상 키·빈 키는 폴백 출처(알림)로 해소한다', () => {
    expect(sourceByKey('no-such-source')).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(null)).toBe(FALLBACK_SOURCE);
    expect(sourceByKey(undefined)).toBe(FALLBACK_SOURCE);
  });

  it('NotificationType → 출처 매핑(체결 외 6종 + 폴백)', () => {
    expect(sourceByType('DISCLOSURE').key).toBe('disclosure');
    expect(sourceByType('SIGNAL').key).toBe('signal');
    expect(sourceByType('EXIT').key).toBe('exit');
    expect(sourceByType('THESIS_VIOLATED').key).toBe('thesis');
    expect(sourceByType('RISK_ALERT').key).toBe('risk');
    expect(sourceByType('OPS_ALERT').key).toBe('ops');
  });

  it('sourcePrefix 는 라벨 텍스트를 그대로 반환한다(푸시 제목 템플릿용)', () => {
    expect(sourcePrefix(NOTIFICATION_SOURCES.disclosure)).toBe('공시');
    expect(sourcePrefix(FALLBACK_SOURCE)).toBe('알림');
  });

  it('레거시 출처 이모지만 제거하고 임의 텍스트는 보존한다', () => {
    expect(stripSourceEmoji('⚡ 단타 · 삼성전자 매도 +2.10%')).toBe(
      '단타 · 삼성전자 매도 +2.10%',
    );
    expect(stripSourceEmoji('📢공시 · 새 공시')).toBe('공시 · 새 공시');
    expect(stripSourceEmoji('공시 · 새 공시')).toBe('공시 · 새 공시');
  });
});
