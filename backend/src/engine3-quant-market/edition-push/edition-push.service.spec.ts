import { EditionPublishPushService } from './edition-push.service';

/**
 * DAR-523(Wave B/B2·P0) — EditionPublishPushService 단위테스트.
 *
 * ★수용기준 1: 빈 에디션(매수등급 0) 날은 producer.enqueueEdition 호출 0(발송 0).
 * ★수용기준: 비어있지 않은 에디션은 조회 API 재사용 결과로 정확히 1회 enqueue(멱등 자연키 editionDate).
 * ★결정론: findDailyEdition 을 목킹하고 now 를 주입해 KST 거래일을 고정한다.
 */

const makeDeps = () => {
  const signals = { findDailyEdition: jest.fn() };
  const producer = { enqueueEdition: jest.fn().mockResolvedValue(undefined) };
  // 기본: 반응 통계 조회는 빈 결과(이벤트 미추출) — 통계 없이 대체 꼬리 폴백.
  const reactionStats = {
    getReactionStatsByRcpNo: jest
      .fn()
      .mockResolvedValue({ rcpNo: '', minSampleSize: 30, generatedAt: '', results: [] }),
  };
  const service = new EditionPublishPushService(
    signals as any,
    producer as any,
    reactionStats as any,
  );
  return { service, signals, producer, reactionStats };
};

// 2026-07-17(금) 19:05 KST = 10:05 UTC — tradeDateFromMs 가 '20260717' 을 산출하는 시각.
const NOW_20260717_1905_KST = new Date('2026-07-17T10:05:00.000Z');

describe('EditionPublishPushService (DAR-523)', () => {
  it('★빈 에디션(isEmpty=true·QUIET) → enqueue 안 함(발송 0)', async () => {
    const { service, signals, producer } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [],
      meta: { date: '20260717', isEmpty: true, emptyReason: 'QUIET' },
    });

    const result = await service.publishTodayEdition(NOW_20260717_1905_KST);

    // 조회 API 를 그날 거래일로 재사용.
    expect(signals.findDailyEdition).toHaveBeenCalledWith('20260717');
    expect(producer.enqueueEdition).not.toHaveBeenCalled();
    expect(result).toMatchObject({ editionDate: '20260717', published: false, count: 0, emptyReason: 'QUIET' });
  });

  it('★빈 에디션(CLOSED·휴장) → enqueue 안 함', async () => {
    const { service, signals, producer } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [],
      meta: { date: '20260717', isEmpty: true, emptyReason: 'CLOSED' },
    });

    const result = await service.publishTodayEdition(NOW_20260717_1905_KST);

    expect(producer.enqueueEdition).not.toHaveBeenCalled();
    expect(result).toMatchObject({ published: false, emptyReason: 'CLOSED' });
  });

  it('비어있지 않은 에디션 → 정확히 1회 enqueue(editionDate·count·헤드라인·완성 콘텐츠)', async () => {
    const { service, signals, producer } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [
        { corpName: '삼성전자', grade: 'STRONG_BUY' },
        { corpName: 'LG에너지솔루션', grade: 'BUY' },
        { corpName: 'SK하이닉스', grade: 'BUY' },
      ],
      meta: { date: '20260717', isEmpty: false },
    });

    const result = await service.publishTodayEdition(NOW_20260717_1905_KST);

    expect(producer.enqueueEdition).toHaveBeenCalledTimes(1);
    expect(producer.enqueueEdition).toHaveBeenCalledWith({
      editionDate: '20260717',
      count: 3,
      strongBuyCount: 1,
      headlineCorpName: '삼성전자',
      title: '오늘의 투자판단 에디션',
      body: '삼성전자 외 2곳 · 매수 후보 3곳 (적극매수 1)',
      deepLink: '/signals',
    });
    expect(result).toMatchObject({ editionDate: '20260717', published: true, count: 3 });
  });

  it('★DAR-525: 헤드라인 반응 통계(n≥30)를 "한 줄 판단" 본문에 주입해 enqueue', async () => {
    const { service, signals, producer, reactionStats } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [
        {
          corpName: '삼성전자',
          grade: 'STRONG_BUY',
          eventType: 'SUPPLY_CONTRACT',
          relatedDisclosureRcpNo: '20260717000123',
        },
        { corpName: 'LG에너지솔루션', grade: 'BUY' },
        { corpName: 'SK하이닉스', grade: 'BUY' },
      ],
      meta: { date: '20260717', isEmpty: false },
    });
    reactionStats.getReactionStatsByRcpNo.mockResolvedValue({
      rcpNo: '20260717000123',
      minSampleSize: 30,
      generatedAt: '2026-07-17T10:05:00.000Z',
      results: [
        {
          eventType: 'SUPPLY_CONTRACT',
          sampleCount: 142,
          stats: {
            d1: { avgReturn: 0.4, avgAbnormalReturn: 0.2, winRate: 0.55 },
            d5: { avgReturn: 2.1, avgAbnormalReturn: 1.3, winRate: 0.6 },
            d20: { avgReturn: 3.0, avgAbnormalReturn: 1.8, winRate: 0.58 },
          },
          reason: null,
          period: { fromDate: '20250101', toDate: '20260716' },
          calculatedAt: '2026-07-17T09:00:00.000Z',
        },
      ],
    });

    await service.publishTodayEdition(NOW_20260717_1905_KST);

    // 헤드라인 rcpNo 로 Wave A 통계 조회.
    expect(reactionStats.getReactionStatsByRcpNo).toHaveBeenCalledWith('20260717000123');
    expect(producer.enqueueEdition).toHaveBeenCalledTimes(1);
    expect(producer.enqueueEdition).toHaveBeenCalledWith(
      expect.objectContaining({
        editionDate: '20260717',
        count: 3,
        strongBuyCount: 1,
        headlineCorpName: '삼성전자',
        title: '오늘의 투자판단 에디션',
        body: '삼성전자 공급계약 외 2곳 — 유사공시 D+5 평균 +2.1% (n=142)',
        deepLink: '/signals',
      }),
    );
  });

  it('★DAR-525: 반응 통계 n<30 → 통계 생략·대체 꼬리로 폴백(허수 미노출)', async () => {
    const { service, signals, producer, reactionStats } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [
        {
          corpName: '삼성전자',
          grade: 'STRONG_BUY',
          eventType: 'SUPPLY_CONTRACT',
          relatedDisclosureRcpNo: '20260717000123',
        },
        { corpName: 'LG전자', grade: 'BUY' },
      ],
      meta: { date: '20260717', isEmpty: false },
    });
    reactionStats.getReactionStatsByRcpNo.mockResolvedValue({
      rcpNo: '20260717000123',
      minSampleSize: 30,
      generatedAt: '',
      results: [
        {
          eventType: 'SUPPLY_CONTRACT',
          sampleCount: 12,
          stats: null,
          reason: 'INSUFFICIENT_SAMPLE',
          period: { fromDate: '20260101', toDate: '20260716' },
          calculatedAt: '2026-07-17T09:00:00.000Z',
        },
      ],
    });

    await service.publishTodayEdition(NOW_20260717_1905_KST);

    expect(producer.enqueueEdition).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '삼성전자 공급계약 외 1곳 · 매수 후보 2곳 (적극매수 1)',
      }),
    );
  });

  it('반응 통계 조회 예외 → 통계 없이 발행 계속(발송 신뢰 우선)', async () => {
    const { service, signals, producer, reactionStats } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [
        {
          corpName: '삼성전자',
          grade: 'BUY',
          eventType: 'SUPPLY_CONTRACT',
          relatedDisclosureRcpNo: '20260717000123',
        },
      ],
      meta: { date: '20260717', isEmpty: false },
    });
    reactionStats.getReactionStatsByRcpNo.mockRejectedValue(new Error('DB down'));

    const result = await service.publishTodayEdition(NOW_20260717_1905_KST);

    expect(result).toMatchObject({ published: true, count: 1 });
    expect(producer.enqueueEdition).toHaveBeenCalledWith(
      expect.objectContaining({
        body: '삼성전자 공급계약 · 매수 후보 1곳',
      }),
    );
  });

  it('now 를 다른 거래일로 주입하면 그 날짜로 조회·발행(결정론)', async () => {
    const { service, signals, producer } = makeDeps();
    signals.findDailyEdition.mockResolvedValue({
      items: [{ corpName: 'LG전자', grade: 'BUY' }],
      meta: { date: '20260716', isEmpty: false },
    });
    // 2026-07-16 19:05 KST = 2026-07-16T10:05Z.
    const result = await service.publishTodayEdition(new Date('2026-07-16T10:05:00.000Z'));

    expect(signals.findDailyEdition).toHaveBeenCalledWith('20260716');
    expect(producer.enqueueEdition).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ editionDate: '20260716', published: true, count: 1 });
  });
});
