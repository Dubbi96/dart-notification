import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UnifiedSearchDto } from './unified-search.dto';

// DAR-282: q 에 @MaxLength(100) 경계 추가 — 무제한 검색어 contains 쿼리 도달 차단
describe('UnifiedSearchDto (DAR-282 q length bound)', () => {
  const validateDto = (payload: unknown) =>
    validate(plainToInstance(UnifiedSearchDto, payload));

  it('정상 검색어 통과', async () => {
    const errors = await validateDto({ q: '삼성전자' });
    expect(errors).toHaveLength(0);
  });

  it('100자 경계 입력 통과', async () => {
    const errors = await validateDto({ q: 'a'.repeat(100) });
    expect(errors).toHaveLength(0);
  });

  it('100자 초과(101자) 거부 → maxLength 위반', async () => {
    const errors = await validateDto({ q: 'a'.repeat(101) });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('q');
    expect(errors[0].constraints).toHaveProperty('maxLength');
  });

  it('기존 limit 경계(@Min/@Max) 회귀 보존', async () => {
    const errors = await validateDto({ q: '삼성', companyLimit: 99 });
    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('companyLimit');
  });
});
