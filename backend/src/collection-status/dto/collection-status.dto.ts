import { ApiProperty } from '@nestjs/swagger';

// 수집 성숙도 배지 — 카드별 커버리지 상태를 사용자/운영자에게 정직하게 노출.
// SUFFICIENT(충분): 임계치 이상 누적 / COLLECTING(수집중): 데이터는 있으나 임계치 미만 / WAITING(대기): 0건.
export type CollectionMaturity = 'SUFFICIENT' | 'COLLECTING' | 'WAITING';

// 수집 실행 상태 — *CollectionLog.status 와 동일 도메인. 로그 부재 시 null.
export type CollectionRunStatus =
  | 'RUNNING'
  | 'SUCCESS'
  | 'PARTIAL'
  | 'FAILED'
  | null;

export class DisclosureCoverageDto {
  @ApiProperty({ description: '누적 공시 건수', example: 152340 })
  totalCount!: number;

  @ApiProperty({
    description: '최근 수집 실행 종료(또는 시작) 시각 ISO8601. 로그 없으면 null',
    nullable: true,
    example: '2026-06-06T02:10:00.000Z',
  })
  lastCollectedAt!: string | null;

  @ApiProperty({ description: '최근 수집 실행에서 신규 저장된 건수', example: 87 })
  lastNewCount!: number;

  @ApiProperty({
    description: '최근 수집 실행 상태',
    enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
    nullable: true,
  })
  lastStatus!: CollectionRunStatus;

  @ApiProperty({
    description: '수집 성숙도 배지',
    enum: ['SUFFICIENT', 'COLLECTING', 'WAITING'],
  })
  maturity!: CollectionMaturity;
}

export class FinancialCoverageDto {
  @ApiProperty({ description: '재무 데이터 보유 종목 수(distinct corpCode)', example: 2410 })
  coveredCompanies!: number;

  @ApiProperty({
    description: '최근 보유 분기(사업연도·보고서코드). 데이터 없으면 null',
    nullable: true,
    example: '2025 / 11014',
  })
  latestPeriod!: string | null;

  @ApiProperty({
    description: '최근 재무 수집 실행 종료(또는 시작) 시각 ISO8601. 로그 없으면 null',
    nullable: true,
  })
  lastCollectedAt!: string | null;

  @ApiProperty({
    description: '최근 재무 수집 실행 상태',
    enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
    nullable: true,
  })
  lastStatus!: CollectionRunStatus;

  @ApiProperty({
    description: '수집 성숙도 배지',
    enum: ['SUFFICIENT', 'COLLECTING', 'WAITING'],
  })
  maturity!: CollectionMaturity;
}

export class IndicatorCoverageDto {
  @ApiProperty({ description: '지표 백필 완료 종목 수(distinct stockCode)', example: 2785 })
  coveredStocks!: number;

  @ApiProperty({
    description: '최근 지표 기준 거래일 YYYYMMDD. 데이터 없으면 null',
    nullable: true,
    example: '20260605',
  })
  latestTradeDate!: string | null;

  @ApiProperty({
    description: '최근 시세 수집 실행 종료(또는 시작) 시각 ISO8601. 로그 없으면 null',
    nullable: true,
  })
  lastCollectedAt!: string | null;

  @ApiProperty({
    description: '최근 시세 수집 실행 상태',
    enum: ['RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED'],
    nullable: true,
  })
  lastStatus!: CollectionRunStatus;

  @ApiProperty({
    description: '수집 성숙도 배지',
    enum: ['SUFFICIENT', 'COLLECTING', 'WAITING'],
  })
  maturity!: CollectionMaturity;
}

export class SimulationCoverageDto {
  @ApiProperty({ description: '모의운용 보유(OPEN) 포지션 수', example: 7 })
  openPositions!: number;

  @ApiProperty({ description: '누적 모의 체결(PaperTrade) 건수', example: 142 })
  totalTrades!: number;

  @ApiProperty({
    description: '최근 모의 체결 시각 ISO8601. 데이터 없으면 null',
    nullable: true,
  })
  lastTradeAt!: string | null;

  @ApiProperty({
    description: '수집 성숙도 배지',
    enum: ['SUFFICIENT', 'COLLECTING', 'WAITING'],
  })
  maturity!: CollectionMaturity;
}

export class CollectionStatusDto {
  @ApiProperty({ type: DisclosureCoverageDto })
  disclosure!: DisclosureCoverageDto;

  @ApiProperty({ type: FinancialCoverageDto })
  financial!: FinancialCoverageDto;

  @ApiProperty({ type: IndicatorCoverageDto })
  indicator!: IndicatorCoverageDto;

  @ApiProperty({ type: SimulationCoverageDto })
  simulation!: SimulationCoverageDto;

  @ApiProperty({
    description: '집계 생성 시각 ISO8601',
    example: '2026-06-06T03:00:00.000Z',
  })
  generatedAt!: string;
}
