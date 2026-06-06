// backend/src/engine1-disclosure/insider-holdings/insider-holdings.service.ts
// DART 지분공시(majorstock/elestock) 수집 → InsiderHoldingChange 멱등 적재.
// 레이트리밋 배치 순회 + DART 미설정 graceful 종료. AI 미개입(순수 Rule).

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartApiUnavailableError,
} from '../dart-api/dart-api.service';
import {
  InsiderHoldingChangeInput,
  mapMajorStockItem,
  mapExecutiveStockItem,
} from './insider-holding.mapper';

export interface CollectInsiderOptions {
  /** 명시 종목(없으면 우선종목 자동 선정). */
  corpCodes?: string[];
  /** 수집 종목 상한 (없으면 무제한). */
  limit?: number;
  /** 종목 간 호출 지연(ms) — DART 레이트리밋 대비. */
  rateLimitMs?: number;
  triggeredBy?: 'CRON' | 'MANUAL' | 'EVENT';
}

export interface CollectInsiderResult {
  target: number;
  saved: number;
  failed: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  message?: string;
}

/** 지분변동 조회 필터 (DAR-88, read-only). */
export interface FindInsiderChangesQuery {
  corpCode?: string;
  tradeType?: 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';
  source?: 'MAJOR_STOCK' | 'EXECUTIVE';
  /** 보고일(reportedAt) 시작 YYYYMMDD */
  from?: string;
  /** 보고일(reportedAt) 종료 YYYYMMDD */
  to?: string;
  page?: number;
  limit?: number;
}

/** BigInt → number 직렬화 안전 변환(JSON 직렬화 불가 회피). 결측 null. */
function bigIntToNumber(v: bigint | null): number | null {
  return v == null ? null : Number(v);
}

/** 조회 응답 행 (BigInt 직렬화 회피용 DTO). */
export interface InsiderHoldingChangeView {
  id: string;
  source: string;
  rcptNo: string;
  corpCode: string;
  reporter: string;
  relation: string | null;
  isExecutive: boolean | null;
  isRegistered: boolean | null;
  isMajorShareholder: boolean | null;
  sharesAfter: number | null;
  sharesChange: number | null;
  ratioAfter: number | null;
  ratioChange: number | null;
  tradeType: string;
  unitPrice: number | null;
  reportReason: string | null;
  reportedAt: Date | null;
}

export interface FindInsiderChangesResult {
  items: InsiderHoldingChangeView[];
  meta: { page: number; limit: number; total: number };
}

@Injectable()
export class InsiderHoldingsService {
  private readonly logger = new Logger(InsiderHoldingsService.name);
  /** 종목 간 기본 호출 간격(ms) — 종목당 2엔드포인트 호출이라 보수적. */
  private readonly DEFAULT_RATE_LIMIT_MS = 350;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApi: DartApiService,
  ) {}

  /**
   * 단일 종목의 대량보유(majorstock) + 임원·주요주주(elestock) 보고를 수집·정규화·멱등 적재.
   * @returns 적재(upsert)된 행 수
   */
  async collectForCorpCode(corpCode: string): Promise<number> {
    const [major, exec] = await Promise.all([
      this.dartApi.fetchMajorStockHoldings(corpCode),
      this.dartApi.fetchExecutiveStockHoldings(corpCode),
    ]);

    const inputs: InsiderHoldingChangeInput[] = [
      ...(major.list ?? []).map(mapMajorStockItem),
      ...(exec.list ?? []).map(mapExecutiveStockItem),
    ].filter((x): x is InsiderHoldingChangeInput => x !== null);

    // 동일 멱등키(source,rcptNo,reporter) 중복 행은 마지막 값으로 dedup.
    const deduped = new Map<string, InsiderHoldingChangeInput>();
    for (const input of inputs) {
      deduped.set(`${input.source}|${input.rcptNo}|${input.reporter}`, input);
    }

    let saved = 0;
    for (const input of deduped.values()) {
      await this.upsert(input);
      saved++;
    }
    return saved;
  }

  /** 정규화 입력을 멱등키 기준 upsert. corpCode FK 미존재 종목은 graceful skip. */
  private async upsert(input: InsiderHoldingChangeInput): Promise<void> {
    const exists = await this.prisma.company.findUnique({
      where: { corpCode: input.corpCode },
      select: { corpCode: true },
    });
    if (!exists) {
      // FK 정합 — 미등록 회사는 적재하지 않음(고아 레코드 방지).
      return;
    }

    const { source, rcptNo, reporter, ...rest } = input;
    await this.prisma.insiderHoldingChange.upsert({
      where: {
        source_rcptNo_reporter: { source, rcptNo, reporter },
      },
      create: { source, rcptNo, reporter, ...rest },
      update: { ...rest },
    });
  }

  /**
   * 배치 수집 — 우선종목(또는 명시 corpCodes) 순회, 멱등 upsert, 레이트리밋 graceful.
   * DART 미설정 시 안전 종료(FAILED), 다른 수집 경로와 동일 계약.
   */
  async collectBatch(opts: CollectInsiderOptions = {}): Promise<CollectInsiderResult> {
    const rateLimitMs = opts.rateLimitMs ?? this.DEFAULT_RATE_LIMIT_MS;
    const limit = opts.limit;

    let corpCodes: string[];
    if (opts.corpCodes && opts.corpCodes.length > 0) {
      corpCodes = opts.corpCodes.slice(0, limit ?? opts.corpCodes.length);
    } else {
      corpCodes = await this.selectPriorityCorpCodes(limit);
    }

    if (corpCodes.length === 0) {
      return { target: 0, saved: 0, failed: 0, status: 'SUCCESS', message: '수집 대상 종목 없음' };
    }

    let saved = 0;
    let failed = 0;

    for (let i = 0; i < corpCodes.length; i++) {
      const corpCode = corpCodes[i];
      try {
        saved += await this.collectForCorpCode(corpCode);
      } catch (err) {
        if (err instanceof DartApiUnavailableError) {
          this.logger.warn('DART API 미설정 — 지분변동 수집 중단(graceful)');
          return {
            target: corpCodes.length,
            saved,
            failed,
            status: 'FAILED',
            message: 'DART API 미설정',
          };
        }
        failed++;
        this.logger.warn(`지분변동 수집 실패 (${corpCode}): ${(err as Error).message}`);
      }

      // 마지막 항목 뒤에는 지연 불필요.
      if (rateLimitMs > 0 && i < corpCodes.length - 1) {
        await this.sleep(rateLimitMs);
      }
    }

    const status: CollectInsiderResult['status'] = failed === 0 ? 'SUCCESS' : 'PARTIAL';
    return { target: corpCodes.length, saved, failed, status };
  }

  /**
   * 우선 수집 종목 선정 — 신호 → 이벤트 → 관심종목 순으로 dedup 누적.
   * 미공개 주체 매매 신호가 가치 있는 보유/관심 종목에 집중.
   */
  async selectPriorityCorpCodes(limit?: number): Promise<string[]> {
    const cap = limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const add = (rows: { corpCode: string }[]) => {
      for (const r of rows) if (r.corpCode) seen.add(r.corpCode);
    };

    add(
      await this.prisma.tradingSignal.findMany({
        distinct: ['corpCode'],
        select: { corpCode: true },
      }),
    );
    if (seen.size < cap) {
      add(
        await this.prisma.disclosureEvent.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }
    if (seen.size < cap) {
      add(
        await this.prisma.watchList.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }

    const all = Array.from(seen);
    return Number.isFinite(cap) ? all.slice(0, cap) : all;
  }

  /**
   * 지분변동 조회 (DAR-88, read-only).
   * corpCode·tradeType·source·보고일 기간 필터 + 페이지네이션, 보고일(없으면 적재일) 내림차순.
   * BigInt 필드는 number 로 변환해 JSON 직렬화 안전성을 보장.
   */
  async findChanges(
    query: FindInsiderChangesQuery = {},
  ): Promise<FindInsiderChangesResult> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const where: {
      corpCode?: string;
      tradeType?: string;
      source?: string;
      reportedAt?: { gte?: Date; lt?: Date };
    } = {};
    if (query.corpCode) where.corpCode = query.corpCode;
    if (query.tradeType) where.tradeType = query.tradeType;
    if (query.source) where.source = query.source;

    const gte = parseYmdToUtc(query.from);
    const toDate = parseYmdToUtc(query.to);
    // 종료일은 해당 일자 전체 포함 → 다음날 0시 미만(lt).
    const lt = toDate ? new Date(toDate.getTime() + 24 * 60 * 60 * 1000) : undefined;
    if (gte || lt) {
      where.reportedAt = {
        ...(gte ? { gte } : {}),
        ...(lt ? { lt } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.prisma.insiderHoldingChange.findMany({
        where,
        // 최신 보고 우선. reportedAt 결측 행은 적재시각(fetchedAt) 보조 정렬.
        orderBy: [{ reportedAt: 'desc' }, { fetchedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.insiderHoldingChange.count({ where }),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        source: r.source,
        rcptNo: r.rcptNo,
        corpCode: r.corpCode,
        reporter: r.reporter,
        relation: r.relation,
        isExecutive: r.isExecutive,
        isRegistered: r.isRegistered,
        isMajorShareholder: r.isMajorShareholder,
        sharesAfter: bigIntToNumber(r.sharesAfter),
        sharesChange: bigIntToNumber(r.sharesChange),
        ratioAfter: r.ratioAfter,
        ratioChange: r.ratioChange,
        tradeType: r.tradeType,
        unitPrice: r.unitPrice,
        reportReason: r.reportReason,
        reportedAt: r.reportedAt,
      })),
      meta: { page, limit, total },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** YYYYMMDD → UTC 자정 Date. 형식 불일치/결측 → undefined. */
function parseYmdToUtc(raw?: string): Date | undefined {
  if (!raw || !/^\d{8}$/.test(raw)) return undefined;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  return new Date(Date.UTC(year, month - 1, day));
}
