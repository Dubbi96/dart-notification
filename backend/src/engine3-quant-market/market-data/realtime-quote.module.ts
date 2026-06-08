import { Global, Module } from '@nestjs/common';
import { RealtimeQuoteCache } from './realtime-quote.cache';

/**
 * 실시간 현재가 캐시 모듈 (DAR-140) — @Global.
 *
 * KIS 폴러(engine3)와 모의운용 평가(engine5 SimulationPriceSourceService)가 '같은 인메모리
 * 인스턴스'를 공유해야 하므로 전역 단일 provider 로 노출한다(모듈 import 없이 @Optional 주입).
 * 스키마/DB 변경 0 — 프로세스 메모리 캐시.
 */
@Global()
@Module({
  providers: [RealtimeQuoteCache],
  exports: [RealtimeQuoteCache],
})
export class RealtimeQuoteModule {}
