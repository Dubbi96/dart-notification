import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateSavedDisclosureDto } from './create-saved-disclosure.dto';

// DAR-282: rcpNo 에 @Length(14,14)+@Matches(/^[0-9]{14}$/) 형식 경계 추가
describe('CreateSavedDisclosureDto (DAR-282 rcpNo format bound)', () => {
  const validateDto = (payload: unknown) =>
    validate(plainToInstance(CreateSavedDisclosureDto, payload));

  it('정상 14자리 접수번호 통과', async () => {
    const errors = await validateDto({ rcpNo: '20260306000885' });
    expect(errors).toHaveLength(0);
  });

  it('14자리 미만(13자) 거부 → length 위반', async () => {
    const errors = await validateDto({ rcpNo: '2026030600088' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isLength');
  });

  it('14자리지만 숫자 외 문자 포함 거부 → matches 위반', async () => {
    const errors = await validateDto({ rcpNo: '2026030600088X' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('matches');
  });

  it('14자리 초과(임의 긴 문자열) 거부', async () => {
    const errors = await validateDto({ rcpNo: 'a'.repeat(50) });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('rcpNo');
  });
});
