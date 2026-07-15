import {
  PRICE_MOVE_THRESHOLD_PCT,
  SECTOR_MIN_PEERS,
  SECTOR_CO_MOVE_MAX_ABS_Z,
  computeChangePct,
  isPriceMoveTriggered,
  priceMoveRefId,
  naverStockNewsUrl,
  formatSignedPct,
  evaluateSectorCoMove,
  buildPriceMoveTitle,
  buildPriceMoveBody,
  PriceMoveFactCheck,
} from './price-move.domain';

/**
 * 갭분석 W7·W6 — 급변동 알림 순수 도메인 스펙.
 *  - ±5% 판정(경계 포함·판정 불가 null 미발화)
 *  - refId 멱등 자연키(':' 미포함 — BullMQ jobId 안전)
 *  - 업종 cross-sectional z-score(표본 부족·분산 0 정직 보류, 동방향 조건)
 *  - 본문 빌더(공시 병기 3분기 + 무공시 팩트체크 근거 + 준실시간 문구)
 */

describe('price-move.domain (갭분석 W7·W6)', () => {
  // ── computeChangePct ──────────────────────────────────────────────────────
  describe('computeChangePct — 전일 종가 대비 등락률', () => {
    it('상승/하락 등락률(%) 계산', () => {
      expect(computeChangePct(10_500, 10_000)).toBeCloseTo(5.0);
      expect(computeChangePct(9_400, 10_000)).toBeCloseTo(-6.0);
    });

    it('prevClose ≤ 0·비유한 입력은 null(판정 불가)', () => {
      expect(computeChangePct(10_000, 0)).toBeNull();
      expect(computeChangePct(10_000, -100)).toBeNull();
      expect(computeChangePct(NaN, 10_000)).toBeNull();
      expect(computeChangePct(10_000, NaN)).toBeNull();
    });
  });

  // ── isPriceMoveTriggered ──────────────────────────────────────────────────
  describe('isPriceMoveTriggered — ±5% 판정', () => {
    it('정확히 +5% / -5% 는 발화(경계 포함)', () => {
      expect(isPriceMoveTriggered(PRICE_MOVE_THRESHOLD_PCT)).toBe(true);
      expect(isPriceMoveTriggered(-PRICE_MOVE_THRESHOLD_PCT)).toBe(true);
    });

    it('±5% 미만은 미발화', () => {
      expect(isPriceMoveTriggered(4.99)).toBe(false);
      expect(isPriceMoveTriggered(-4.99)).toBe(false);
      expect(isPriceMoveTriggered(0)).toBe(false);
    });

    it('±5% 초과는 발화', () => {
      expect(isPriceMoveTriggered(12.3)).toBe(true);
      expect(isPriceMoveTriggered(-29.9)).toBe(true);
    });

    it('null(판정 불가)은 항상 미발화 — 거짓 발화 금지', () => {
      expect(isPriceMoveTriggered(null)).toBe(false);
    });

    it('임계 재정의 시 해당 임계로 판정', () => {
      expect(isPriceMoveTriggered(3.5, 3)).toBe(true);
      expect(isPriceMoveTriggered(3.5, 4)).toBe(false);
    });
  });

  // ── refId / newsUrl ───────────────────────────────────────────────────────
  it('priceMoveRefId — `<stockCode>-<YYYYMMDD>` 멱등 자연키(":" 미포함)', () => {
    const refId = priceMoveRefId('005930', '20260716');
    expect(refId).toBe('005930-20260716');
    expect(refId).not.toContain(':'); // BullMQ custom jobId 안전
  });

  it('naverStockNewsUrl — 네이버금융 종목 뉴스 링크아웃(수집·저장 0)', () => {
    expect(naverStockNewsUrl('005930')).toBe(
      'https://finance.naver.com/item/news.naver?code=005930',
    );
  });

  it('formatSignedPct — 부호 포함 소수 1자리', () => {
    expect(formatSignedPct(6.24)).toBe('+6.2%');
    expect(formatSignedPct(-5)).toBe('-5.0%');
    expect(formatSignedPct(0)).toBe('+0.0%');
  });

  // ── evaluateSectorCoMove ──────────────────────────────────────────────────
  describe('evaluateSectorCoMove — 업종 cross-sectional z-score', () => {
    it('표본 부족(< SECTOR_MIN_PEERS)이면 zScore=null·isCoMove=false(정직 보류)', () => {
      const r = evaluateSectorCoMove(6, [5, 6, 7]);
      expect(r.zScore).toBeNull();
      expect(r.isCoMove).toBe(false);
      expect(r.peerCount).toBe(3);
    });

    it('업종이 같은 방향으로 함께 움직이고 타깃이 이상치가 아니면 isCoMove=true', () => {
      // 피어 평균 ≈ +5.6%, 타깃 +6% → z 작음 + 동방향 + 평균 ≥ 1% → 동반 변동.
      const r = evaluateSectorCoMove(6, [5, 6, 7, 5.5, 4.5]);
      expect(r.peerCount).toBe(SECTOR_MIN_PEERS);
      expect(r.zScore).not.toBeNull();
      expect(Math.abs(r.zScore!)).toBeLessThanOrEqual(SECTOR_CO_MOVE_MAX_ABS_Z);
      expect(r.isCoMove).toBe(true);
    });

    it('업종은 보합인데 타깃만 급등이면 isCoMove=false(이상치 = 개별 요인)', () => {
      const r = evaluateSectorCoMove(8, [0.2, -0.3, 0.1, 0.4, -0.2, 0.0]);
      expect(r.isCoMove).toBe(false);
    });

    it('타깃과 업종 평균의 방향이 다르면 isCoMove=false', () => {
      // 타깃 -6%, 업종 평균 +5%대 상승 — |z| 가 작아도 동반 변동 아님.
      const r = evaluateSectorCoMove(-6, [5, 6, 7, 5.5, 4.5]);
      expect(r.isCoMove).toBe(false);
    });

    it('피어 분산 0 이면 zScore=null(0 나눗셈 방지·과잉 라벨 방지)', () => {
      const r = evaluateSectorCoMove(6, [5, 5, 5, 5, 5]);
      expect(r.zScore).toBeNull();
      expect(r.isCoMove).toBe(false);
      expect(r.peerMeanPct).toBeCloseTo(5);
    });

    it('비유한 피어 값은 제외하고 판정', () => {
      const r = evaluateSectorCoMove(6, [5, 6, 7, 5.5, 4.5, NaN, Infinity]);
      expect(r.peerCount).toBe(5);
    });
  });

  // ── buildPriceMoveTitle / buildPriceMoveBody ─────────────────────────────
  const baseFact: PriceMoveFactCheck = {
    disclosureCountToday: 0,
    hasDisclosure48h: false,
    status: null,
    sector: null,
    hasInquiryDisclosure: false,
  };

  it('제목 — {기업명} 급변동 {±X.X%} (이모지 0)', () => {
    expect(buildPriceMoveTitle('삼성전자', 6.24)).toBe('삼성전자 급변동 +6.2%');
    expect(buildPriceMoveTitle('테스트기업', -5)).toBe('테스트기업 급변동 -5.0%');
  });

  describe('본문 — 당일 공시 유무 병기(W7) + 무공시 팩트체크(W6)', () => {
    it('오늘 공시 N>0 → "오늘 공시 N건" 병기', () => {
      const body = buildPriceMoveBody(6.2, {
        ...baseFact,
        disclosureCountToday: 2,
        hasDisclosure48h: true,
      });
      expect(body).toContain('전일 종가 대비 +6.2%');
      expect(body).toContain('오늘 공시 2건');
      expect(body).toContain('준실시간(최대 5분 지연)');
      expect(body).not.toContain('관련 공시 없음');
    });

    it('오늘 0건·48h 내 있음 → 오늘 없음 + 48h 내 존재 병기', () => {
      const body = buildPriceMoveBody(-5.5, { ...baseFact, hasDisclosure48h: true });
      expect(body).toContain('오늘 공시 없음 · 최근 48시간 내 공시 있음');
      expect(body).not.toContain('공시 요인 아님');
    });

    it('48h 0건 + 근거 없음 → "관련 공시 없음" + "공시 요인 아님 — 수급·테마 추정"(정직 배제 표기)', () => {
      const body = buildPriceMoveBody(7.1, baseFact);
      expect(body).toContain('관련 공시 없음(최근 48시간)');
      expect(body).toContain('공시 요인 아님 — 수급·테마 추정');
      expect(body).toContain('준실시간(최대 5분 지연)');
    });

    it('48h 0건 + 시장조치 플래그 → (a) 근거 병기(투자주의·이상급등·거래정지)', () => {
      const body = buildPriceMoveBody(9.9, {
        ...baseFact,
        status: { isTradingSuspended: true, isInvestmentCaution: true, isAbnormalSurge: true },
      });
      expect(body).toContain('거래정지');
      expect(body).toContain('투자주의 지정');
      expect(body).toContain('이상급등 지정');
      // 근거가 있으면 '수급·테마 추정' 폴백 문구는 붙지 않는다.
      expect(body).not.toContain('공시 요인 아님 — 수급·테마 추정');
    });

    it('48h 0건 + 업종 동반 변동 → (b) "업종 동반 변동(테마성 추정)" 라벨', () => {
      const body = buildPriceMoveBody(5.8, {
        ...baseFact,
        sector: { zScore: 0.4, isCoMove: true, peerCount: 7, peerMeanPct: 5.1 },
      });
      expect(body).toContain('업종 동반 변동(테마성 추정)');
    });

    it('48h 0건 + 조회공시 존재 → (c) "시황변동 조회공시 있음" 병기', () => {
      const body = buildPriceMoveBody(-8.2, { ...baseFact, hasInquiryDisclosure: true });
      expect(body).toContain('시황변동 조회공시 있음');
    });

    it('공시 있는 케이스는 무공시 팩트체크 근거를 붙이지 않는다(분기 배타)', () => {
      const body = buildPriceMoveBody(6.0, {
        disclosureCountToday: 1,
        hasDisclosure48h: true,
        status: { isTradingSuspended: false, isInvestmentCaution: true, isAbnormalSurge: false },
        sector: { zScore: 0.1, isCoMove: true, peerCount: 8, peerMeanPct: 5 },
        hasInquiryDisclosure: true,
      });
      expect(body).not.toContain('투자주의 지정');
      expect(body).not.toContain('업종 동반 변동');
      expect(body).not.toContain('시황변동 조회공시');
    });
  });
});
