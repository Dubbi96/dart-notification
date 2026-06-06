import 'reflect-metadata';
import { FinancialsController } from './financials.controller';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';

// DAR-96: 재무 펀더멘털 카드는 종목 상세에서 게스트도 열람한다(DAR-54 패턴).
// 읽기 전용 GET /financials/latest 는 OptionalJwtAuthGuard, 쓰기(collect/backfill)는
// JwtAuthGuard 로 보호되어야 한다. 가드 메타데이터를 직접 검증해 회귀를 막는다.
const GUARDS_METADATA = '__guards__';

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) as unknown[]) ?? [];
}

describe('FinancialsController 인증 가드 정합 (DAR-96)', () => {
  const proto = FinancialsController.prototype as unknown as Record<string, object>;

  it('클래스 레벨에는 가드를 두지 않는다 (메서드별로 분기)', () => {
    expect(guardsOf(FinancialsController)).toHaveLength(0);
  });

  it('GET /financials/latest 는 OptionalJwtAuthGuard 로 게스트 열람을 허용한다', () => {
    const guards = guardsOf(proto.latest);
    expect(guards).toContain(OptionalJwtAuthGuard);
    expect(guards).not.toContain(JwtAuthGuard);
  });

  it('POST /financials/collect 는 JwtAuthGuard 로 보호된다', () => {
    expect(guardsOf(proto.collect)).toContain(JwtAuthGuard);
  });

  it('POST /financials/backfill 는 JwtAuthGuard 로 보호된다', () => {
    expect(guardsOf(proto.backfill)).toContain(JwtAuthGuard);
  });
});
