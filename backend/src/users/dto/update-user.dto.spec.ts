import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateUserDto } from './update-user.dto';

// DAR-282: name 에 @MaxLength(40) 경계 추가 — 무제한 표시명 PATCH 차단
describe('UpdateUserDto (DAR-282 name length bound)', () => {
  const validateDto = (payload: unknown) =>
    validate(plainToInstance(UpdateUserDto, payload));

  it('정상 길이(40자) 입력 통과', async () => {
    const errors = await validateDto({ name: 'a'.repeat(40) });
    expect(errors).toHaveLength(0);
  });

  it('일반 한글 표시명 통과', async () => {
    const errors = await validateDto({ name: '김철수' });
    expect(errors).toHaveLength(0);
  });

  it('name 미제공(optional) 통과', async () => {
    const errors = await validateDto({});
    expect(errors).toHaveLength(0);
  });

  it('40자 초과(41자) 거부 → maxLength 위반', async () => {
    const errors = await validateDto({ name: 'a'.repeat(41) });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('기존 @MinLength(2) 회귀 보존 — 1자 거부', async () => {
    const errors = await validateDto({ name: 'a' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('minLength');
  });
});
