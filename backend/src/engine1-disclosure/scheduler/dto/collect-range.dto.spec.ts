import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CollectRangeDto } from './collect-range.dto';

// DAR-292: collect 트리거 bgnDe/endDe 형식(@Matches YYYYMMDD) + 역전(bgnDe<=endDe) 검증
describe('CollectRangeDto (DAR-292 date param validation)', () => {
  const validateDto = (payload: unknown) =>
    validate(plainToInstance(CollectRangeDto, payload));

  it('정상 YYYYMMDD 범위 통과 (동작 불변)', async () => {
    const errors = await validateDto({ bgnDe: '20240101', endDe: '20240131' });
    expect(errors).toHaveLength(0);
  });

  it('동일 날짜(bgnDe === endDe) 통과', async () => {
    const errors = await validateDto({ bgnDe: '20240101', endDe: '20240101' });
    expect(errors).toHaveLength(0);
  });

  it('대시 포함(2024-01-01) 거부 → matches 위반', async () => {
    const errors = await validateDto({ bgnDe: '2024-01-01', endDe: '20240131' });
    const bgn = errors.find((e) => e.property === 'bgnDe');
    expect(bgn).toBeDefined();
    expect(bgn?.constraints).toHaveProperty('matches');
  });

  it('비숫자(abc) 거부 → matches 위반', async () => {
    const errors = await validateDto({ bgnDe: 'abc', endDe: 'defghijk' });
    expect(errors.some((e) => e.property === 'bgnDe')).toBe(true);
    expect(errors.some((e) => e.property === 'endDe')).toBe(true);
  });

  it('6자리 거부 → matches 위반', async () => {
    const errors = await validateDto({ bgnDe: '202401', endDe: '20240131' });
    const bgn = errors.find((e) => e.property === 'bgnDe');
    expect(bgn?.constraints).toHaveProperty('matches');
  });

  it('누락 거부 (required)', async () => {
    const errors = await validateDto({ bgnDe: '20240101' });
    expect(errors.some((e) => e.property === 'endDe')).toBe(true);
  });

  it('역전 범위(bgnDe > endDe) 거부 → 커스텀 제약 위반', async () => {
    const errors = await validateDto({ bgnDe: '20240201', endDe: '20240101' });
    const bgn = errors.find((e) => e.property === 'bgnDe');
    expect(bgn).toBeDefined();
    expect(bgn?.constraints).toHaveProperty('bgnDeBeforeEndDe');
  });

  it('형식 오류 시 역전 제약은 발화하지 않음 (matches 만 보고)', async () => {
    const errors = await validateDto({ bgnDe: 'abc', endDe: '20240101' });
    const bgn = errors.find((e) => e.property === 'bgnDe');
    expect(bgn?.constraints).toHaveProperty('matches');
    expect(bgn?.constraints).not.toHaveProperty('bgnDeBeforeEndDe');
  });
});
