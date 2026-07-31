import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  JsonObject,
  MissingFeaturePolicy,
  RuleImplementationRegistry,
  VersionedRule,
} from '@dart-notification/aos-rule-engine';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  BuyScoreParams,
  BuySignalResult,
  BuySignalService,
} from '../../../engine3-quant-market/buy-signal/buy-signal.service';
import { EvaluateAndRecordDecisionService } from './evaluate-and-record-decision.service';
import { FreezeMarketRegimeSnapshotService } from './freeze-market-regime-snapshot.service';

export const DECISION_DUAL_WRITE_FLAG = 'AOS_DECISION_DUAL_WRITE_ENABLED';
const LEGACY_STRATEGY_KEY = 'legacy-dart-swing';
const LEGACY_RISK_HASH = '2e5ec19d466684943a971670bb695a66db7c5840bec9227139a104cebc05cb3e';

export interface LegacyDecisionDualWriteInput {
  readonly featureSnapshotId: string;
  readonly featureSnapshotHash: string;
  readonly featureSchemaVersion: string;
  readonly snapshotAsOf: Date;
  readonly marketSessionDate: string;
  readonly stockCode: string;
  readonly persona: string;
  readonly features: JsonObject;
  readonly marketFacts: JsonObject;
  readonly marketSourceRefs: JsonObject;
  readonly tradingSignalId: string;
  readonly params: BuyScoreParams;
  readonly legacyResult: BuySignalResult;
}

export type LegacyDecisionDualWriteResult =
  | { readonly status: 'DISABLED' }
  | { readonly status: 'WRITTEN'; readonly decisionId: string; readonly parityStatus: string }
  | { readonly status: 'FAILED' };

@Injectable()
export class LegacyDecisionDualWriteService {
  private readonly logger = new Logger(LegacyDecisionDualWriteService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly buySignal: BuySignalService,
    private readonly regimeFreezer: FreezeMarketRegimeSnapshotService,
    private readonly evaluator: EvaluateAndRecordDecisionService,
  ) {}

  isEnabled(): boolean {
    const value = this.config.get<string | boolean>(DECISION_DUAL_WRITE_FLAG, false);
    return value === true || value === 'true';
  }

  async tryRecord(input: LegacyDecisionDualWriteInput): Promise<LegacyDecisionDualWriteResult> {
    if (!this.isEnabled()) return { status: 'DISABLED' };
    try {
      const pinned = await this.loadPinnedBaseline();
      const regime = await this.regimeFreezer.freeze({
        asOf: input.snapshotAsOf,
        marketSessionDate: input.marketSessionDate,
        schemaVersion: 'legacy-market-observation.v1',
        // 승인된 regime threshold가 없으므로 관측값만 동결한다.
        regimeKey: 'UNCLASSIFIED',
        confidence: null,
        facts: input.marketFacts,
        sourceRefs: input.marketSourceRefs,
        quality: {
          classification: 'NOT_EVALUATED',
          reason: 'NO_APPROVED_REGIME_RULE',
        },
      });
      const recomputed = this.buySignal.computeBuyScore(input.params);
      const registry: RuleImplementationRegistry = {
        'legacy.risk-penalty.v1': () => ({
          status: recomputed.signal === 'BLOCKED' ? 'FAIL' : 'PASS',
          scoreDelta: 0,
          reasonCodes:
            recomputed.signal === 'BLOCKED' ? ['LEGACY_HARD_RISK_BLOCK'] : ['LEGACY_RISK_PASS'],
          facts: {
            riskPenalty: recomputed.riskPenalty,
            blockedReason: recomputed.blockedReason ?? null,
          },
        }),
        'legacy.buy-score.v1': () => ({
          status: recomputed.signal === 'BLOCKED' ? 'ABSTAIN' : 'PASS',
          scoreDelta: recomputed.buyScore,
          reasonCodes: [`LEGACY_GRADE_${recomputed.signal}`],
          facts: {
            signal: recomputed.signal,
            entryReady: recomputed.entryReady,
          },
        }),
      };
      const result = await this.evaluator.execute({
        mode: 'LEGACY_PARITY',
        featureSnapshotId: input.featureSnapshotId,
        marketRegimeSnapshotId: regime.id,
        strategyVersionId: pinned.strategy.id,
        riskPolicyVersionId: pinned.risk.id,
        legacyTradingSignalId: input.tradingSignalId,
        legacyScore: input.legacyResult.buyScore,
        evaluatedAt: new Date(),
        request: {
          receiptSchemaVersion: 'signal-decision.v1',
          evaluatorVersion: 'aos-rule-engine.0.1.0',
          evaluationKey: `${input.tradingSignalId}:${input.featureSnapshotHash}`,
          version: {
            strategyVersionId: pinned.strategy.id,
            strategyContentHash: pinned.strategy.configHash,
            riskPolicyVersionId: pinned.risk.id,
            riskPolicyContentHash: pinned.risk.configHash,
          },
          snapshot: {
            schemaVersion: input.featureSchemaVersion,
            contentHash: input.featureSnapshotHash,
            asOf: input.snapshotAsOf.toISOString(),
            subject: { market: 'KR_STOCK', assetKey: input.stockCode },
            values: input.features,
          },
          rules: pinned.rules,
        },
        registry,
      });
      return { status: 'WRITTEN', decisionId: result.id, parityStatus: result.parityStatus };
    } catch (error) {
      const name = error instanceof Error && error.name ? error.name : 'UnknownError';
      this.logger.warn(`[AOS:Decision] dual-write 실패 — legacy signal 유지: ${name}`);
      return { status: 'FAILED' };
    }
  }

  private async loadPinnedBaseline(): Promise<{
    strategy: { id: string; configHash: string };
    risk: { id: string; configHash: string };
    rules: readonly VersionedRule[];
  }> {
    const [strategy, risk] = await Promise.all([
      this.prisma.strategyVersion.findFirst({
        where: { strategy: { key: LEGACY_STRATEGY_KEY }, version: 1, status: 'BACKTESTED' },
        select: {
          id: true,
          configHash: true,
          rules: {
            orderBy: [{ priority: 'asc' }, { ruleDefinition: { key: 'asc' } }],
            select: {
              priority: true,
              enabled: true,
              weight: true,
              parametersJson: true,
              parameterHash: true,
              ruleDefinition: { select: { key: true, category: true, implementationKey: true } },
            },
          },
        },
      }),
      this.prisma.riskPolicyVersion.findFirst({
        where: { configHash: LEGACY_RISK_HASH, status: 'BACKTESTED' },
        select: { id: true, configHash: true },
      }),
    ]);
    if (!strategy || !risk) throw new Error('AosLegacyBaselineMissing');
    const rules = strategy.rules.map((row) => {
      const metadata = jsonRecord(row.parametersJson);
      return {
        ruleKey: row.ruleDefinition.key,
        implementationKey: row.ruleDefinition.implementationKey,
        category: row.ruleDefinition.category,
        priority: row.priority,
        enabled: row.enabled,
        weight: row.weight?.toNumber() ?? 0,
        parameterHash: row.parameterHash,
        parameters: metadata,
        requiredFeatures: stringArray(metadata.requiredFeatures),
        missingFeaturePolicy: missingPolicy(metadata.missingFeaturePolicy),
      } satisfies VersionedRule;
    });
    return { strategy, risk, rules: Object.freeze(rules) };
  }
}

function jsonRecord(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonObject;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? Object.freeze([...value])
    : Object.freeze([]);
}

function missingPolicy(value: unknown): MissingFeaturePolicy {
  return value === 'ABSTAIN' ? 'ABSTAIN' : 'BLOCK';
}
