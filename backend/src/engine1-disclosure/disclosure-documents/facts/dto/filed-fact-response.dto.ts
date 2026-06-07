// backend/src/engine1-disclosure/disclosure-documents/facts/dto/filed-fact-response.dto.ts
// DAR-112: rcpNo별 정량 fact 조회 응답 DTO (read-only, Swagger 문서화용)

import { ApiProperty } from '@nestjs/swagger';

export class FiledFactResponseDto {
  @ApiProperty({ description: 'DART 접수번호', example: '20240101000001' })
  rcpNo!: string;

  @ApiProperty({ description: '기업 고유번호(corpCode)', example: '00126380' })
  corpCode!: string;

  @ApiProperty({
    description: '표준 fact 키',
    example: 'CONTRACT_AMOUNT',
  })
  factKey!: string;

  @ApiProperty({ description: '정규화 문자열 값', example: '1500000000' })
  value!: string;

  @ApiProperty({
    description: '숫자형 값(텍스트형 fact는 null)',
    example: 1500000000,
    nullable: true,
  })
  numericValue!: number | null;

  @ApiProperty({ description: '단위(원·주·% 등)', example: '원', nullable: true })
  unit!: string | null;

  @ApiProperty({
    description: '기간/일자 정보',
    example: '2024-12-31',
    nullable: true,
  })
  period!: string | null;

  @ApiProperty({
    description: '추출 출처 경로',
    example: 'parsedJson.contractAmount',
    nullable: true,
  })
  sectionPath!: string | null;

  @ApiProperty({
    description: '정규화 소스 docType(이벤트 유형)',
    example: 'SUPPLY_CONTRACT',
    nullable: true,
  })
  docType!: string | null;
}
