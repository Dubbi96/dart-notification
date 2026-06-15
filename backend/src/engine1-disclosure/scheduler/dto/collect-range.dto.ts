import {
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  Validate,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DAR-292: bgnDe <= endDe 역전 가드.
 * 두 값이 모두 YYYYMMDD 8자리(@Matches 통과)일 때만 비교한다.
 * 동일 도메인 disclosures 의 from/to 형식 검증과 동일한 @Matches 를 적용하고,
 * 역전 범위(bgnDe > endDe)는 별도 클래스 레벨 검증으로 차단한다.
 */
@ValidatorConstraint({ name: 'bgnDeBeforeEndDe', async: false })
export class BgnDeBeforeEndDeConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { bgnDe, endDe } = args.object as CollectRangeDto;
    // 형식이 어긋난 경우는 @Matches 가 보고하므로 여기서는 통과시킨다.
    if (!/^[0-9]{8}$/.test(bgnDe) || !/^[0-9]{8}$/.test(endDe)) {
      return true;
    }
    // YYYYMMDD 8자리는 사전식 비교가 날짜 순서와 일치한다.
    return bgnDe <= endDe;
  }

  defaultMessage(): string {
    return 'bgnDe는 endDe보다 이후일 수 없습니다 (bgnDe <= endDe)';
  }
}

export class CollectRangeDto {
  @ApiProperty({ description: '수집 시작일(YYYYMMDD)', example: '20240101' })
  @Matches(/^[0-9]{8}$/, { message: 'bgnDe는 YYYYMMDD 8자리여야 합니다' })
  @Validate(BgnDeBeforeEndDeConstraint)
  bgnDe: string;

  @ApiProperty({ description: '수집 종료일(YYYYMMDD)', example: '20240131' })
  @Matches(/^[0-9]{8}$/, { message: 'endDe는 YYYYMMDD 8자리여야 합니다' })
  endDe: string;
}
