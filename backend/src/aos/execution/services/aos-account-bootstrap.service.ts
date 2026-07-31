import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../prisma/prisma.service';

/** 사용자 확정 배분정책 50/30/20을 계좌 간 계획 weight로만 만든다. 송금·보전은 하지 않는다. */
@Injectable()
export class AosAccountBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureSeparatedAccounts(userId: string, systemCapital?: number) {
    return this.prisma.$transaction(async (tx) => {
      const longTerm = await tx.aosTradingAccount.upsert({
        where: {
          userId_accountType_label: {
            userId,
            accountType: 'LONG_TERM',
            label: 'AOS 장기자산',
          },
        },
        create: { userId, accountType: 'LONG_TERM', label: 'AOS 장기자산' },
        update: {},
      });
      const system = await tx.aosTradingAccount.upsert({
        where: {
          userId_accountType_label: {
            userId,
            accountType: 'SYSTEM_TRADING',
            label: 'AOS 시스템 트레이딩',
          },
        },
        create: { userId, accountType: 'SYSTEM_TRADING', label: 'AOS 시스템 트레이딩' },
        update: {},
      });
      await Promise.all([
        this.ensureBucket(tx, longTerm.id, 'SPGI', 0.5),
        this.ensureBucket(tx, longTerm.id, 'VTI', 0.3),
        this.ensureBucket(tx, system.id, 'SYSTEM_TRADING', 0.2, systemCapital),
      ]);
      return Object.freeze({ longTermAccountId: longTerm.id, systemAccountId: system.id });
    });
  }

  private async ensureBucket(
    tx: Prisma.TransactionClient,
    tradingAccountId: string,
    bucketType: 'SPGI' | 'VTI' | 'SYSTEM_TRADING',
    targetWeight: number,
    availableAmount?: number,
  ) {
    return tx.aosCapitalBucket.upsert({
      where: { tradingAccountId_bucketType: { tradingAccountId, bucketType } },
      create: {
        tradingAccountId,
        bucketType,
        targetWeight,
        availableAmount,
        autoReplenishAllowed: false,
      },
      update: {},
    });
  }
}
