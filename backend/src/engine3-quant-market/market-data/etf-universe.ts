/**
 * ETF 유니버스 상수 (DAR-484 [견고화 W1·P10]) — Wave1 듀얼모멘텀/변동성돌파 2트랙 공통 토대.
 *
 * 월단위 듀얼모멘텀 코어(P12/P13)와 변동성 돌파 위성(P14/P15)이 소비할 ETF 일봉 수집 대상.
 *   - 공격A(해외주식 모멘텀) · 공격B(국내주식 모멘텀): 모멘텀 상위 자산에 배분.
 *   - 방어(종합채권) · 현금성(단기채): 모멘텀 음(-)일 때 회피처(Antonacci 듀얼모멘텀의 out-of-market).
 *
 * ★무레버리지 원칙(불가침): 레버리지(2X)·인버스 ETF 는 금지한다. 측정 트랙의 정직성(단순 롱)을
 *   지키고 파생 변동성 왜곡을 배제한다. (isNonLeveragedEtfName 가드 + 스펙으로 회귀 고정.)
 *
 * ★종목 확정 근거(정직 고지): 아래 코드는 국내 상장 무레버리지 ETF 중 규모(AUM)·거래대금 최상위군
 *   에서 도메인 지식으로 선정했다(공격 2종은 이슈 지정). 채권·단기채는 대표 최상위 유동성 종목을
 *   1차 확정하고 대안을 병기했다. '일평균 거래대금 최상위' 라이브 재확인은 Wave 완료 후 가동 시점의
 *   게이트이며(배포 정책: 프로드 가동 전제 검증은 이 이슈 범위 밖), 운영자가 확정용 수동 러너
 *   `etf-universe-liquidity.manual.ts` 로 재확인한다. 확인 결과 상위 종목이 바뀌면 코드를 교체한다.
 */

/** ETF 유니버스 역할 — 듀얼모멘텀/변동성돌파 배분 축. */
export type EtfRole =
  | 'OFFENSE_INTL' // 공격A: 해외주식(미국) 모멘텀
  | 'OFFENSE_DOMESTIC' // 공격B: 국내주식 모멘텀
  | 'DEFENSE_BOND' // 방어: 종합채권(모멘텀 음일 때 회피처)
  | 'CASH_SHORT'; // 현금성: 단기채(초단기 회피처)

/** 유니버스 1종. code 는 KRX 6자리 단축코드. */
export interface EtfUniverseEntry {
  role: EtfRole;
  /** KRX 6자리 단축코드. */
  code: string;
  /** 종목명(한국어). */
  name: string;
  /** 선정 근거(코드 확정 사유·대안). */
  basis: string;
}

/**
 * 수집·전략 대상 ETF 유니버스 (무레버리지·무인버스).
 *
 * ★코드 교체 절차: 라이브 유동성 재확인(러너)에서 상위 종목이 바뀌면, 새 code/name/basis 로 이 배열을
 *   갱신하고 근거를 basis 에 남긴다. 전략 파라미터가 아닌 '데이터 수집 대상'이라 룰북 §8 대상은 아니나,
 *   변경 사유는 코드 주석으로 추적한다(정직 원칙).
 */
export const ETF_UNIVERSE: readonly EtfUniverseEntry[] = [
  {
    role: 'OFFENSE_INTL',
    code: '360750',
    name: 'TIGER 미국S&P500',
    basis: '이슈 지정. 국내 상장 미국 S&P500 추종 ETF 중 규모·거래대금 최상위군(무레버리지·무환헤지 대표).',
  },
  {
    role: 'OFFENSE_DOMESTIC',
    code: '069500',
    name: 'KODEX 200',
    basis: '이슈 지정. KOSPI200 추종 국내 대표 ETF — 상장 이래 거래대금 최상위(무레버리지).',
  },
  {
    role: 'DEFENSE_BOND',
    code: '273130',
    name: 'KODEX 종합채권(AA-이상)액티브',
    basis:
      '국내 최대 규모 종합채권 ETF 군(AA- 이상 우량채, 무레버리지). Antonacci 듀얼모멘텀의 회피처(aggregate bond)에 대응. ' +
      '대안: 114260 KODEX 국고채3년(대표 국고채 3년, 듀레이션 짧음). 라이브 유동성 재확인 시 상위 종목으로 교체.',
  },
  {
    role: 'CASH_SHORT',
    code: '153130',
    name: 'KODEX 단기채권',
    basis:
      '국내 대표 초단기 채권 ETF — 현금성 회피처(저변동·고유동, 무레버리지). ' +
      '대안: 157450 TIGER 단기통안채. 라이브 유동성 재확인 시 상위 종목으로 교체.',
  },
] as const;

/** 유니버스 단축코드 목록(수집기 순회용). */
export const ETF_UNIVERSE_CODES: readonly string[] = ETF_UNIVERSE.map((e) => e.code);

/** 역할 → 유니버스 항목 조회(전략 소비측 편의). */
export function etfByRole(role: EtfRole): EtfUniverseEntry | undefined {
  return ETF_UNIVERSE.find((e) => e.role === role);
}

/** 코드 → 유니버스 항목 조회. */
export function etfByCode(code: string): EtfUniverseEntry | undefined {
  return ETF_UNIVERSE.find((e) => e.code === code);
}

/**
 * 무레버리지·무인버스 종목명 가드 — 레버리지(2X)·인버스 키워드가 없어야 true.
 * 유니버스 진입 전 이름 검사(무레버리지 원칙 회귀 고정)에 쓴다.
 */
export function isNonLeveragedEtfName(name: string): boolean {
  const n = name.replace(/\s/g, '').toUpperCase();
  const forbidden = ['레버리지', '인버스', 'INVERSE', 'LEVERAGE', '2X', '3X', '2배', '곱버스'];
  return !forbidden.some((kw) => n.includes(kw));
}
