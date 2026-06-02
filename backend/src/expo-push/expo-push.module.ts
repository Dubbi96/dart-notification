import { Module } from '@nestjs/common';
import { ExpoPushService } from './expo-push.service';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [DevicesModule],
  providers: [ExpoPushService],
  exports: [ExpoPushService],
})
export class ExpoPushModule {}
