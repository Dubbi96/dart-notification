import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateWatchlistDto } from './create-watchlist.dto';

// DAR-282: corpName 에 @MaxLength(100) 경계 추가 — corpCode 와 일관되게 무제한 차단
describe('CreateWatchlistDto (DAR-282 corpName length bound)', () => {
  const base = { corpCode: '00126380' };
  const validateDto = (payload: unknown) =>
    validate(plainToInstance(CreateWatchlistDto, payload));

  it('정상 기업명 통과', async () => {
    const errors = await validateDto({ ...base, corpName: '삼성전자' });
    expect(errors).toHaveLength(0);
  });

  it('100자 경계 입력 통과', async () => {
    const errors = await validateDto({ ...base, corpName: '가'.repeat(100) });
    expect(errors).toHaveLength(0);
  });

  it('100자 초과(101자) 거부 → maxLength 위반', async () => {
    const errors = await validateDto({ ...base, corpName: '가'.repeat(101) });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('corpName');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('기존 @IsNotEmpty 회귀 보존 — 빈 corpName 거부', async () => {
    const errors = await validateDto({ ...base, corpName: '' });
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toHaveProperty('isNotEmpty');
  });

  it('기존 corpCode @Length(8,8) 회귀 보존', async () => {
    const errors = await validateDto({ corpCode: '123', corpName: '삼성전자' });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('corpCode');
  });
});
