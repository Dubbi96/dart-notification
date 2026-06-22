/**
 * IntradayScalpController — 분봉 단타 모의전략 현황 표면화 (DAR-411)
 *
 * 전용 엔드포인트 — DAR-404 전략 비교(/strategies/comparison)는 백테스트 기반인 반면,
 *   분봉 단타는 forward-only(백테스트 불가)라 별도 트랙으로 노출(표본0/저표본 graceful).
 * 게스트 조회 허용(OptionalJwt) — 모의 트랙은 공개 성과.
 */

import { Controller, Get } from '@nestjs/common';
import { IntradayScalpService, ScalpStatus } from './intraday-scalp.service';

@Controller('paper-trading/simulation/intraday-scalp')
export class IntradayScalpController {
  constructor(private readonly scalp: IntradayScalpService) {}

  /** GET /paper-trading/simulation/intraday-scalp/status — forward 누적 성과·보유 현황. */
  @Get('status')
  async getStatus(): Promise<ScalpStatus> {
    return this.scalp.getStatus();
  }
}
