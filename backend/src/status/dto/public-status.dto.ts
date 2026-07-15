import { ApiProperty } from '@nestjs/swagger';

// 공개 /status 응답 DTO — status.service.ts 의 PublicStatusSnapshot 과 1:1(Swagger 노출 전용).

export class PublicStatusServiceDto {
  @ApiProperty({ description: '서비스 상태', enum: ['OK', 'DEGRADED'] })
  status!: 'OK' | 'DEGRADED';

  @ApiProperty({ description: '표시 라벨(한국어)', example: '정상 가동' })
  label!: string;

  @ApiProperty({ description: '서버 프로세스 연속 가동(초)' })
  uptimeSeconds!: number;
}

export class PublicStatusDisclosureDto {
  @ApiProperty({ description: '오늘(KST) 적재된 라이브 공시 건수(백필 제외)' })
  todayCollectedCount!: number;

  @ApiProperty({ description: '마지막 수집 성공 시각 ISO8601. 없으면 null', nullable: true })
  lastCollectedAt!: string | null;
}

export class PublicStatusPipelineDto {
  @ApiProperty({ description: '파싱 파이프라인 상태', enum: ['OK', 'DEGRADED'] })
  status!: 'OK' | 'DEGRADED';

  @ApiProperty({ description: '표시 라벨(한국어)', example: '정상' })
  label!: string;

  @ApiProperty({ description: '지연 판정된 파이프라인 잡 키', type: [String] })
  staleJobKeys!: string[];
}

export class PublicStatusCronDto {
  @ApiProperty({ description: '집계 윈도(시간)', example: 24 })
  windowHours!: number;

  @ApiProperty({ description: '최근 24h 종료된 실행 수(RUNNING 제외)' })
  totalRuns!: number;

  @ApiProperty({ description: '정상 실행 수(SUCCESS + SKIPPED)' })
  okRuns!: number;

  @ApiProperty({ description: '성공률(%). 실행 0건이면 null', nullable: true })
  successRatePct!: number | null;
}

export class PublicStatusSnapshotDto {
  @ApiProperty({ description: '집계 생성 시각 ISO8601' })
  generatedAt!: string;

  @ApiProperty({ type: PublicStatusServiceDto })
  service!: PublicStatusServiceDto;

  @ApiProperty({ type: PublicStatusDisclosureDto })
  disclosure!: PublicStatusDisclosureDto;

  @ApiProperty({ type: PublicStatusPipelineDto })
  pipeline!: PublicStatusPipelineDto;

  @ApiProperty({ type: PublicStatusCronDto })
  cron!: PublicStatusCronDto;
}
