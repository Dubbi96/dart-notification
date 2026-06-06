/**
 * Persona 철학 엔진 P-A — 4종 시드 데이터 (DAR-48)
 *
 * 워렌버핏·피터린치·조엘그린블라트·스탠리드러켄밀러.
 * 모두 공개 자료(주주서한·저서·공개 강연/인터뷰) 기반 요약이며 AI 미개입.
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §2-2
 *
 * 각 철학의 metric weight 합은 1.0 이어야 한다(시드 정합성 spec 으로 검증).
 */
import { InvestorPhilosophySeed } from './types/philosophy.types';

/** 1) 워렌 버핏 — 가치·해자·장기 */
const BUFFETT: InvestorPhilosophySeed = {
  philosophyId: 'BUFFETT',
  investorName: '워렌 버핏 (Warren Buffett)',
  styleTags: ['VALUE', 'MOAT', 'LONG_TERM'],
  corePrinciples: [
    '이해할 수 있는 사업에만 투자',
    '경제적 해자(지속 가능한 경쟁우위) 확인',
    '뛰어나고 정직한 경영진',
    '내재가치 대비 합리적인 가격(안전마진)',
    '장기 보유(좋은 기업은 영원히)',
  ],
  applicableAssets: ['KR_STOCK', 'US_STOCK'],
  checklistItems: [
    '사업 모델을 한 문단으로 설명할 수 있는가',
    '10년 뒤에도 해자가 유지되는가',
    'ROE 가 꾸준히 높은가',
    '부채 의존도가 낮은가',
    '잉여현금흐름이 안정적으로 양수인가',
  ],
  riskProfile: '보수적·장기보유(변동성보다 영구적 자본손실을 경계)',
  scoreFormula:
    '버핏 스코어(0~100) = ROE×20 + 부채비율×20 + PER×15 + PBR×10 + 영업이익률×15 + FCF×10 + 해자점수×10',
  metrics: [
    { metricKey: 'ROE', operator: 'GT', threshold: 15, weight: 0.2, description: '자기자본이익률 ≥ 15% (3년 평균)' },
    { metricKey: 'DEBT_RATIO', operator: 'LT', threshold: 50, weight: 0.2, description: '부채비율(총부채/자기자본) ≤ 50%' },
    { metricKey: 'PER', operator: 'LT', threshold: 20, weight: 0.15, description: '주가수익비율 ≤ 20' },
    { metricKey: 'PBR', operator: 'LT', threshold: 2.0, weight: 0.1, description: '주가순자산비율 ≤ 2.0' },
    { metricKey: 'OPERATING_MARGIN', operator: 'GT', threshold: 10, weight: 0.15, description: '영업이익률 ≥ 10%' },
    { metricKey: 'FCF_POSITIVE', operator: 'GT', threshold: 0, weight: 0.1, description: '잉여현금흐름 3년 연속 양수' },
    { metricKey: 'MOAT_SCORE', operator: 'GT', threshold: 7, weight: 0.1, description: '해자 점수 ≥ 7 (AI 해석 0~10 환산, P-C 이후 공급)' },
  ],
  sources: [
    {
      type: 'SHAREHOLDER_LETTER',
      title: '버크셔 해서웨이 주주서한 (1977~현재)',
      year: 1977,
      url: 'https://www.berkshirehathaway.com/letters/letters.html',
    },
  ],
};

/** 2) 피터 린치 — 성장·생활주·GARP */
const LYNCH: InvestorPhilosophySeed = {
  philosophyId: 'LYNCH',
  investorName: '피터 린치 (Peter Lynch)',
  styleTags: ['GROWTH', 'GARP'],
  corePrinciples: [
    '아는 것에 투자(소비자가 아는 제품)',
    '성장주를 합리적인 가격에(GARP)',
    'PEG 비율로 성장 대비 밸류 판단',
    '소형~중형 성장주 선호',
    '스토리(왜 성장하는가)를 검증',
  ],
  applicableAssets: ['KR_STOCK', 'US_STOCK'],
  checklistItems: [
    '제품/서비스를 일상에서 직접 접하는가',
    'EPS 성장률이 견고한가',
    'PEG 가 1.0 내외인가',
    '매출 성장이 동반되는가',
    '아직 시장이 주목하지 않은 중소형주인가',
  ],
  riskProfile: '중립·성장지향(성장 둔화 시 빠른 재평가)',
  scoreFormula:
    '린치 스코어(0~100) = PEG×30 + EPS성장률×25 + PER×15 + 매출성장률×15 + 시가총액×15',
  metrics: [
    { metricKey: 'PEG', operator: 'LT', threshold: 1.0, weight: 0.3, description: 'PEG(PER/EPS성장률) ≤ 1.0 최적, ≤ 1.5 허용' },
    { metricKey: 'EPS_GROWTH_YOY', operator: 'GT', threshold: 20, weight: 0.25, description: 'EPS 성장률(YoY) ≥ 20%' },
    { metricKey: 'PER', operator: 'LT', threshold: 30, weight: 0.15, description: '주가수익비율 ≤ 30' },
    { metricKey: 'REVENUE_GROWTH_YOY', operator: 'GT', threshold: 15, weight: 0.15, description: '매출 성장률(YoY) ≥ 15%' },
    { metricKey: 'MARKET_CAP_TIER', operator: 'LT', threshold: 1_000_000_000_000, weight: 0.15, description: '시가총액 ≤ 1조 원(코스피 기준 중소형주 가중)' },
  ],
  sources: [
    {
      type: 'BOOK',
      title: '전설로 떠나는 월가의 영웅 (One Up on Wall Street)',
      year: 1989,
    },
  ],
};

/** 3) 조엘 그린블라트 — 매직포뮬러 */
const GREENBLATT: InvestorPhilosophySeed = {
  philosophyId: 'GREENBLATT',
  investorName: '조엘 그린블라트 (Joel Greenblatt)',
  styleTags: ['VALUE', 'QUANTITATIVE'],
  corePrinciples: [
    '좋은 기업(높은 ROC)을 싸게(높은 이익수익률) 산다',
    'ROC 순위 + 이익수익률(EY) 순위 합산',
    '시스템적·기계적 접근(감정 배제)',
    '유니버스 내 상대 순위가 핵심',
    '충분한 분산(20~30종목)',
  ],
  applicableAssets: ['KR_STOCK', 'US_STOCK'],
  checklistItems: [
    '유니버스가 최소 30종목 이상인가',
    'ROC 순위가 상위권인가',
    '이익수익률(EY) 순위가 상위권인가',
    '금융·유틸리티 등 왜곡 업종을 제외했는가',
    '정기 리밸런싱 규칙을 정했는가',
  ],
  riskProfile: '시스템적·분산(개별 종목보다 포뮬러 전체 성과를 신뢰)',
  scoreFormula:
    '그린블라트 스코어 = 유니버스 전체 대비 (ROC 순위 + EY 순위) 합산 → 0~100 정규화 (최소 30종목 유니버스 필요)',
  metrics: [
    { metricKey: 'ROC', operator: 'GT', threshold: 70, weight: 0.5, description: 'ROC(EBIT/(순운전자본+순고정자산)) 유니버스 내 순위 상위 30%(백분위 ≥ 70)' },
    { metricKey: 'EARNINGS_YIELD', operator: 'GT', threshold: 70, weight: 0.5, description: '이익수익률(EBIT/EV) 유니버스 내 순위 상위 30%(백분위 ≥ 70)' },
  ],
  sources: [
    {
      type: 'BOOK',
      title: '주식시장을 이기는 작은 책 (The Little Book That Still Beats the Market)',
      year: 2010,
    },
  ],
};

/** 4) 스탠리 드러켄밀러 — 매크로·모멘텀·집중투자 */
const DRUCKENMILLER: InvestorPhilosophySeed = {
  philosophyId: 'DRUCKENMILLER',
  investorName: '스탠리 드러켄밀러 (Stanley Druckenmiller)',
  styleTags: ['MACRO', 'MOMENTUM'],
  corePrinciples: [
    '거시경제 사이클을 선행해서 파악',
    '유동성·금리·통화 환경으로 방향 판단',
    '모멘텀 확인 후 집중 투자',
    '틀리면 빠르게 손절',
    '확신이 클 때 크게 베팅',
  ],
  applicableAssets: ['KR_STOCK', 'US_STOCK', 'CRYPTO'],
  checklistItems: [
    '매크로 환경(유동성·금리)이 우호적인가',
    '가격이 신고가 부근에서 강세인가',
    '업종 대비 상대강도가 양호한가',
    '거래량이 추세를 확인해 주는가',
    '기관·외국인 수급이 들어오는가',
    '틀렸을 때의 손절 라인을 정했는가',
  ],
  riskProfile: '공격적·집중투자·빠른 손절(큰 확신엔 크게, 오판엔 즉시 청산)',
  scoreFormula:
    '드러켄밀러 스코어(0~100) = 신고가근접×20 + 상대강도×20 + 거래량추세×15 + 매크로점수×30 + 기관수급×15',
  metrics: [
    { metricKey: 'PRICE_NEAR_52W_HIGH', operator: 'GT', threshold: 90, weight: 0.2, description: '52주 고점 대비 -10% 이내(고점의 90%↑)' },
    { metricKey: 'RELATIVE_STRENGTH_1M', operator: 'GT', threshold: 0, weight: 0.2, description: '1개월 업종 대비 상대수익률 > 0%' },
    { metricKey: 'VOLUME_TREND', operator: 'GT', threshold: 150, weight: 0.15, description: '거래량 20일 평균 대비 150%↑' },
    { metricKey: 'MACRO_ENV_SCORE', operator: 'GT', threshold: 6, weight: 0.3, description: '매크로 환경 점수 ≥ 6 (AI 해석 0~10 환산, P-C 이후 공급)' },
    { metricKey: 'INSTITUTIONAL_BUYING', operator: 'GT', threshold: 0, weight: 0.15, description: '외국인·기관 5일 순매수 > 0' },
  ],
  sources: [
    {
      type: 'PUBLIC_STATEMENT',
      title: 'Sohn Investment Conference 강연 및 Bloomberg·CNBC 공개 인터뷰',
      year: 2015,
    },
  ],
};

/** 초기 시드 철학 4종 (멱등 적용 단위) */
export const PHILOSOPHY_SEEDS: InvestorPhilosophySeed[] = [
  BUFFETT,
  LYNCH,
  GREENBLATT,
  DRUCKENMILLER,
];
