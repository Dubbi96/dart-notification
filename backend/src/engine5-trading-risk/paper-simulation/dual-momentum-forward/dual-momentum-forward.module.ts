/**
 * DualMomentumForwardModule — 듀얼모멘텀 코어 forward 트랙(모의) 배선 (DAR-494 [견고화 W1·P13])
 *
 * P16 위험조정 게이트 통과(룰북 §9.3.2) 코어 트랙을 월말 리밸런싱 forward 로 활성한다.
 * 분봉 단타(IntradayScalpModule) 전례와 동일한 additive 트랙 — 기존 측정 트랙 무접촉.
 *
 * - PrismaModule: EtfDailyPrice/DualMomentumForwardTrade/Portfolio 조회·기록.
 * - NotificationProducerModule: 판정 결측 fail-safe OPS_ALERT(P02).
 * - TradingRiskModule: 공유 KillSwitchManager 싱글톤(REDUCE_ONLY — 신규 매수 차단·매도 허용).
 *   ★별도 인스턴스 금지(in-memory 발동 상태 전파 안 되면 우회 재발 — 단타 F5 교훈 계승).
 * - CronRunRecorderService 는 @Global(CronHealthModule) — 스케줄러가 @Optional 로 주입(모듈 import 불요).
 *
 * ★ 모의 전용 — 실주문 없음. 판정·사이징·체결은 순수 Rule(AI 미개입).
 */

import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { NotificationProducerModule } from '../../../notifications/notification-producer.module';
import { TradingRiskModule } from '../../trading-risk.module';
import { DualMomentumForwardService } from './dual-momentum-forward.service';
import { DualMomentumForwardController } from './dual-momentum-forward.controller';
import { DualMomentumForwardScheduler } from './dual-momentum-forward.scheduler';

@Module({
  imports: [PrismaModule, NotificationProducerModule, TradingRiskModule],
  controllers: [DualMomentumForwardController],
  providers: [DualMomentumForwardService, DualMomentumForwardScheduler],
  exports: [DualMomentumForwardService],
})
export class DualMomentumForwardModule {}
