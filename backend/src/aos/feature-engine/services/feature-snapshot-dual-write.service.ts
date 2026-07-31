import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { FeatureSnapshotInput } from '../domain/feature-snapshot.types';
import { FreezeFeatureSnapshotService } from './freeze-feature-snapshot.service';

export const FEATURE_SNAPSHOT_DUAL_WRITE_FLAG = 'AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED';

export type FeatureSnapshotDualWriteResult =
  | { readonly status: 'DISABLED' }
  | { readonly status: 'WRITTEN'; readonly contentHash: string }
  | { readonly status: 'FAILED' };

/**
 * 점진 전환용 fail-open adapter. 이 서비스의 실패는 legacy TradingSignal을 되돌리지 않는다.
 * 정본 전환과 fail-closed 적용은 reconciliation 이후 별도 Issue에서만 허용한다.
 */
@Injectable()
export class FeatureSnapshotDualWriteService {
  private readonly logger = new Logger(FeatureSnapshotDualWriteService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly freezer: FreezeFeatureSnapshotService,
  ) {}

  isEnabled(): boolean {
    const enabled = this.config.get<string | boolean>(FEATURE_SNAPSHOT_DUAL_WRITE_FLAG, false);
    return enabled === true || enabled === 'true';
  }

  async tryFreeze(input: FeatureSnapshotInput): Promise<FeatureSnapshotDualWriteResult> {
    if (!this.isEnabled()) return { status: 'DISABLED' };

    try {
      const snapshot = await this.freezer.freeze(input);
      return { status: 'WRITTEN', contentHash: snapshot.contentHash };
    } catch (error) {
      this.logger.warn(
        `[AOS:FeatureSnapshot] dual-write 실패 — legacy signal 유지: ${safeErrorName(error)}`,
      );
      return { status: 'FAILED' };
    }
  }
}

function safeErrorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : 'UnknownError';
}
