/**
 * PositionThesisService — 매수 신호 → Thesis 자동 생성 + 생명주기 관리 (M7, DAR-11)
 *
 * AI 금지영역:
 *   - PositionThesis 생성·평가는 순수 Rule 기반. AI/LLM 개입 절대 금지.
 *   - exitRules·maxWeight는 AI 변경 불가. Engine5 Risk가 최종 강제.
 *   - 최종 주문 승인·손절가 결정: 이 서비스 범위 외.
 */

import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  PositionThesisRecord,
  CreatePositionThesisParams,
  ThesisStatus,
  DEFAULT_EXIT_RULES,
  DEFAULT_MAX_WEIGHT,
  MAX_WEIGHT_HARD_LIMIT,
  canTransition,
} from '../domain/position-thesis.types';
import { validateInvalidConditions } from '../domain/invalid-condition.types';
import { InMemoryPositionThesisRepository } from '../repositories/in-memory-position-thesis.repository';

// 매수 등급 — Thesis 자동 생성 대상
const BUY_SIGNAL_GRADES = new Set(['STRONG_BUY_CANDIDATE', 'BUY_CANDIDATE']);

export interface TradingSignalInput {
  id: string;
  rcpNo: string;
  corpCode: string;
  signal: string;           // SignalGrade
  entryConditionMet: string[];
  riskFactors: string[];
  signalSummary?: string | null;
}

@Injectable()
export class PositionThesisService {
  constructor(
    private readonly repository: InMemoryPositionThesisRepository,
  ) {}

  /**
   * BUY 등급 TradingSignal당 PositionThesis 1:1 자동 생성.
   * 이미 생성된 경우(tradingSignalId UNIQUE) 기존 Thesis 반환.
   *
   * AI 금지: invalidConditions·exitRules·maxWeight는 Rule 기반으로만 결정.
   */
  async createFromSignal(
    signal: TradingSignalInput,
    overrides?: Partial<CreatePositionThesisParams>,
  ): Promise<PositionThesisRecord> {
    if (!BUY_SIGNAL_GRADES.has(signal.signal)) {
      throw new Error(
        `createFromSignal: signal must be BUY grade (got ${signal.signal})`,
      );
    }

    const existing = await this.repository.findBySignalId(signal.id);
    if (existing) return existing;

    const params: CreatePositionThesisParams = {
      tradingSignalId: signal.id,
      rcpNo: signal.rcpNo,
      corpCode: signal.corpCode,
      entryReason: overrides?.entryReason ?? this.buildEntryReason(signal),
      initialThesis: overrides?.initialThesis ?? this.buildInitialThesis(signal),
      invalidConditions: overrides?.invalidConditions ?? this.buildDefaultInvalidConditions(),
      exitRules: overrides?.exitRules ?? DEFAULT_EXIT_RULES,
      maxWeight: overrides?.maxWeight ?? DEFAULT_MAX_WEIGHT,
    };

    return this.create(params);
  }

  /**
   * PositionThesis 직접 생성 (파라미터 완전 지정).
   * invalidConditions 기계 평가 가능성 검증 포함.
   */
  async create(params: CreatePositionThesisParams): Promise<PositionThesisRecord> {
    if (!validateInvalidConditions(params.invalidConditions)) {
      throw new Error(
        'invalidConditions must be machine-evaluable structured types (no abstract natural language)',
      );
    }

    const maxWeight = Math.min(
      params.maxWeight ?? DEFAULT_MAX_WEIGHT,
      MAX_WEIGHT_HARD_LIMIT, // 하드룰: AI 우회 불가
    );

    const now = new Date();
    const thesis: PositionThesisRecord = {
      id: randomUUID(),
      tradingSignalId: params.tradingSignalId,
      rcpNo: params.rcpNo,
      corpCode: params.corpCode,
      entryReason: params.entryReason,
      initialThesis: params.initialThesis,
      invalidConditions: params.invalidConditions,
      exitRules: params.exitRules ?? DEFAULT_EXIT_RULES,
      maxWeight,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
    };

    return this.repository.save(thesis);
  }

  /**
   * Thesis를 INVALIDATED 상태로 전이 (논리 훼손 판정).
   * ACTIVE → INVALIDATED만 허용.
   */
  async invalidate(id: string): Promise<PositionThesisRecord> {
    const thesis = await this.repository.findById(id);
    if (!thesis) throw new Error(`PositionThesis ${id} not found`);
    if (!canTransition(thesis.status, 'INVALIDATED')) {
      throw new Error(
        `Cannot transition from ${thesis.status} to INVALIDATED`,
      );
    }
    return this.repository.updateStatus(id, 'INVALIDATED');
  }

  /**
   * Thesis를 CLOSED 상태로 전이 (포지션 청산 완료).
   * ACTIVE|INVALIDATED → CLOSED 허용.
   */
  async close(id: string): Promise<PositionThesisRecord> {
    const thesis = await this.repository.findById(id);
    if (!thesis) throw new Error(`PositionThesis ${id} not found`);
    if (!canTransition(thesis.status, 'CLOSED')) {
      throw new Error(`Cannot transition from ${thesis.status} to CLOSED`);
    }
    return this.repository.updateStatus(id, 'CLOSED');
  }

  async findBySignalId(tradingSignalId: string): Promise<PositionThesisRecord | null> {
    return this.repository.findBySignalId(tradingSignalId);
  }

  async findByStatus(status: ThesisStatus): Promise<PositionThesisRecord[]> {
    return this.repository.findByStatus(status);
  }

  async findAll(): Promise<PositionThesisRecord[]> {
    return this.repository.findAll();
  }

  // ─── Rule 기반 기본값 생성 (AI 개입 없음) ────────────────────────

  private buildEntryReason(signal: TradingSignalInput): string {
    const met = signal.entryConditionMet.slice(0, 2).join(', ');
    return `BUY 신호(${signal.signal}) — 진입조건: ${met || '조건 충족'}`;
  }

  private buildInitialThesis(signal: TradingSignalInput): string[] {
    const points: string[] = [`신호등급: ${signal.signal}`];
    if (signal.signalSummary) points.push(signal.signalSummary);
    signal.entryConditionMet.slice(0, 3).forEach((c) => points.push(c));
    return points;
  }

  private buildDefaultInvalidConditions() {
    // Rule 기반 기본 무효 조건 — 기계 평가 가능 구조화 형태
    return [
      { type: 'AMENDMENT_NEGATIVE' as const },
      { type: 'STOP_LOSS_PCT' as const, value: 8 },
      { type: 'MAX_HOLD_DAYS' as const, value: 20 },
      { type: 'VOLUME_COLLAPSE' as const, threshold: 0.3 },
      { type: 'EVENT_STUDY_UNDERPERFORM' as const, horizon: 'D5' as const, threshold: 0 },
    ];
  }
}
