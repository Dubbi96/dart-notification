import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AosAllocationController } from './aos-allocation.controller';
import { AosAllocationService } from './services/aos-allocation.service';

@Module({
  imports: [PrismaModule],
  controllers: [AosAllocationController],
  providers: [AosAllocationService],
  exports: [AosAllocationService],
})
export class AosAllocationModule {}
