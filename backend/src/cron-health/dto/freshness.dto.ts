import { ApiProperty } from '@nestjs/swagger';

// 데이터 신선도 응답 DTO (DAR-110) — freshness.ts 의 결과 형태와 1:1.
// Swagger 노출 전용. 판정 로직은 순수 함수가 담당(여기엔 없음).

export class FreshnessJobResultDto {
  @ApiProperty({ description: '잡 식별 키', example: 'signal.generate' })
  jobKey!: string;

  @ApiProperty({ description: '표시 라벨', example: '매수 신호 생성' })
  label!: string;

  @ApiProperty({ description: '카덴스 설명', example: '평일 19:00' })
  cadence!: string;

  @ApiProperty({
    description: '현재 윈도에서 stale 판정을 적용했는가(false=장외시간 등 보류)',
  })
  applicable!: boolean;

  @ApiProperty({ description: 'stale(정체) 여부' })
  isStale!: boolean;

  @ApiProperty({
    description: '마지막 성공 종료시각 ISO8601. 없으면 null',
    nullable: true,
  })
  lastSuccessAt!: string | null;

  @ApiProperty({
    description: '마지막 실행 상태. 기록 없으면 null',
    nullable: true,
  })
  lastStatus!: string | null;

  @ApiProperty({
    description: '마지막 성공 실행의 처리/신규 건수. 없으면 null',
    nullable: true,
  })
  lastItemCount!: number | null;

  @ApiProperty({
    description: '마지막 성공 이후 경과(분). 없으면 null',
    nullable: true,
  })
  ageMinutes!: number | null;

  @ApiProperty({ description: '사람이 읽는 판정 사유' })
  reason!: string;
}

export class FreshnessReportDto {
  @ApiProperty({ description: '집계 생성 시각 ISO8601' })
  generatedAt!: string;

  @ApiProperty({
    description: '적용 가능한 잡 중 하나라도 stale 이면 true(수집 안전망 경보)',
  })
  anyStale!: boolean;

  @ApiProperty({
    description: 'stale 로 판정된 잡 키 목록',
    type: [String],
  })
  staleJobs!: string[];

  @ApiProperty({ type: [FreshnessJobResultDto] })
  jobs!: FreshnessJobResultDto[];
}
