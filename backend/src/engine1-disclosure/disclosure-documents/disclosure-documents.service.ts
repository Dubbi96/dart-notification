// backend/src/disclosure-documents/disclosure-documents.service.ts
// 파싱 파이프라인 오케스트레이터 (M1)

import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ParseStatus, DisclosureDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartApiUnavailableError,
} from '../dart-api/dart-api.service';
import { LocalStorageService } from './storage/storage.service';
import { cleanHtml } from './parsers/html-cleaner';
import { parseXmlSections } from './parsers/xml.parser';
import { parseTables } from './parsers/table.parser';
import { mapKeyValues } from './mappers/key-value.mapper';
import {
  detectAmendment,
  extractOriginalRcpNo,
} from './mappers/amendment.detector';
import { computeAmendmentDiff } from './mappers/amendment.differ';
import { classifyInvestmentEventType } from '../disclosures/constants/disclosure-types.constant';
import { ParsedJson } from './types/parsed-json.type';
import { DartFiledFactService } from './facts/dart-filed-fact.service';
import { Table } from './types/table.type';
import { AmendmentDiff } from './types/amendment-diff.type';
// M2 체이닝: @Optional() 주입 — DisclosureEventsService가 미배포 상태에서도 M1 파이프라인 무중단 동작
// 순환 참조 방지: disclosure-events 모듈이 disclosure-documents 모듈을 import하지 않음
import type { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';

// ─── 상수 ────────────────────────────────────────────────────────────────────
const MAX_RETRY = 3;
const MAX_RAWTEXT_LENGTH = 200_000;  // 200KB 상한
const MAX_LAST_ERROR_LENGTH = 500;
const BATCH_CONCURRENCY = 5;
const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 200;
const DEFAULT_RETRY_LIMIT = 20;
// 빈 문서 기준 (P-03)
const EMPTY_DOCUMENT_THRESHOLD = 50;

@Injectable()
export class DisclosureDocumentsService {
  private readonly logger = new Logger(DisclosureDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    private readonly storageService: LocalStorageService,
    // M2 체이닝: DisclosureEventsService가 없어도(미배포 시) 정상 동작하도록 @Optional() 사용
    @Optional()
    private readonly disclosureEventsService?: DisclosureEventsService,
    // DAR-95: 파싱 완료 후 표준 fact 영구 적재(@Optional — 미배포 시 무중단)
    @Optional()
    private readonly dartFiledFactService?: DartFiledFactService,
  ) {}

  /**
   * 단건 파싱 파이프라인 (스케줄러 자동 트리거 또는 수동 트리거)
   *
   * 상태 전이: PENDING → FETCHING → PARSING → DONE
   *            실패 시: → FETCH_FAILED 또는 PARSE_FAILED
   *            MAX_RETRY 초과: → SKIPPED
   *
   * @throws 절대 throw하지 않음 — 모든 오류를 파싱 상태로 기록 후 return
   */
  async parseDisclosure(rcpNo: string): Promise<DisclosureDocument> {
    // 0. Disclosure 존재 확인
    const disclosure = await this.prisma.disclosure.findUnique({
      where: { rcpNo },
    });

    if (!disclosure) {
      // 계약 §5-2: Disclosure 미존재 시 404 (UNKNOWN 레코드 생성 금지)
      throw new NotFoundException(
        `Disclosure(rcpNo=${rcpNo})가 존재하지 않습니다. 먼저 수집(M0)이 필요합니다.`,
      );
    }

    // 0-1. 현재 상태 확인
    const existing = await this.prisma.disclosureDocument.findUnique({
      where: { rcpNo },
    });

    // DONE 상태면 재처리 스킵
    if (existing?.parseStatus === ParseStatus.DONE) {
      return existing;
    }

    // MAX_RETRY 초과 확인
    if (existing && existing.retryCount >= MAX_RETRY) {
      const skipped = await this.prisma.disclosureDocument.update({
        where: { rcpNo },
        data: { parseStatus: ParseStatus.SKIPPED },
      });
      return skipped;
    }

    // FETCHING 상태로 upsert
    const doc = await this.prisma.disclosureDocument.upsert({
      where: { rcpNo },
      create: {
        rcpNo,
        corpCode: disclosure.corpCode,
        parseStatus: ParseStatus.FETCHING,
      },
      update: {
        parseStatus: ParseStatus.FETCHING,
      },
    });

    // ─── Step 1: 원문 다운로드 ─────────────────────────────────────────────
    let html: string | undefined;
    let xml: string | undefined;
    let rawFilePath: string | undefined;

    try {
      const zipBuffer = await this.dartApiService.downloadDocument(rcpNo);
      const extracted = await this.dartApiService.extractDocumentFromZip(
        zipBuffer,
        rcpNo,
      );
      html = extracted.html;
      xml = extracted.xml;

      // ZIP 내 파일 없음 처리 (규칙 P-04)
      if (!html && !xml) {
        return await this.updateDocFailed(
          rcpNo,
          ParseStatus.FETCH_FAILED,
          'EMPTY_ZIP',
          doc.retryCount,
        );
      }

      // 로컬 저장 (개발 환경)
      const content = html ?? xml ?? '';
      if (content) {
        rawFilePath = await this.storageService.save(
          rcpNo,
          'index.html',
          content,
        );
      }

      await this.prisma.disclosureDocument.update({
        where: { rcpNo },
        data: {
          fetchedAt: new Date(),
          rawFilePath: rawFilePath ?? null,
        },
      });
    } catch (error) {
      const errMsg =
        error instanceof DartApiUnavailableError
          ? error.message
          : truncate((error as Error).message, MAX_LAST_ERROR_LENGTH);

      return await this.updateDocFailed(
        rcpNo,
        ParseStatus.FETCH_FAILED,
        errMsg,
        doc.retryCount,
      );
    }

    // ─── Step 2~6: 파싱 ──────────────────────────────────────────────────
    await this.prisma.disclosureDocument.update({
      where: { rcpNo },
      data: { parseStatus: ParseStatus.PARSING },
    });

    try {
      // Step 2: 텍스트 추출
      let rawTextFull: string;
      if (html) {
        rawTextFull = cleanHtml(html);
      } else {
        rawTextFull = parseXmlSections(xml!).join('\n');
      }

      // 빈 문서 처리 (P-03)
      if (rawTextFull.trim().length < EMPTY_DOCUMENT_THRESHOLD) {
        return await this.prisma.disclosureDocument.update({
          where: { rcpNo },
          data: {
            parseStatus: ParseStatus.SKIPPED,
            lastError: 'EMPTY_DOCUMENT',
            wordCount: 0,
            tables: [],
            parsedJson: {},
          },
        });
      }

      const wordCount = rawTextFull.length;
      // 200KB 상한 truncate (규칙 P-05, R-09)
      const rawText = rawTextFull.slice(0, MAX_RAWTEXT_LENGTH);
      const wasTruncated = wordCount > MAX_RAWTEXT_LENGTH;

      // Step 3: 표 추출 — 원본 전체에서 수행 (truncate 이전, P-05)
      // 실제 DART 문서는 대부분 XML(<TABLE><TE>)이므로 html 없으면 xml에서도 표 추출 (라이브 검증 발견)
      const tableSource = html ?? xml ?? '';
      const tables: Table[] = tableSource ? parseTables(tableSource) : [];

      // Step 4: key-value 매핑
      const eventType = classifyInvestmentEventType(disclosure.reportName);
      const parsedJson: ParsedJson = mapKeyValues(tables, eventType, rawText);

      // Step 5: 정정공시 판별
      const amendmentDetected = detectAmendment(
        disclosure.rmk ?? '',
        disclosure.reportName,
      );

      let isAmendment = false;
      let originalRcpNo: string | null = null;
      let amendmentDiff: AmendmentDiff | null = null;

      if (amendmentDetected) {
        isAmendment = true;
        // rmk에서 원공시 rcpNo 추출 (A-03)
        originalRcpNo = extractOriginalRcpNo(disclosure.rmk ?? '');

        // DB 룩업으로 보완 (A-04)
        if (!originalRcpNo) {
          originalRcpNo = await this.findOriginalRcpNoByLookup(
            disclosure.corpCode,
            disclosure.reportName,
            disclosure.rcpDt,
          );
        }

        // 원공시가 복수 정정 체인이면 최초 원공시까지 거슬러 올라감 (A-05)
        if (originalRcpNo) {
          originalRcpNo = await this.resolveRootOriginalRcpNo(originalRcpNo);
        }

        // diff 계산
        if (originalRcpNo) {
          // computeAmendmentDiff 는 parsedJson 만 사용 — rawText(200KB) over-fetch 방지
          const originalDoc = await this.prisma.disclosureDocument.findUnique({
            where: { rcpNo: originalRcpNo },
            select: { parsedJson: true },
          });
          if (originalDoc?.parsedJson) {
            amendmentDiff = computeAmendmentDiff(
              originalDoc.parsedJson as unknown as ParsedJson,
              parsedJson,
              originalRcpNo,
              rcpNo,
            );
          }
        }
      }

      // Step 6: 완료 저장
      const lastErrorMsg = wasTruncated ? 'TRUNCATED_AT_200KB' : null;

      const updatedDoc = await this.prisma.disclosureDocument.update({
        where: { rcpNo },
        data: {
          parseStatus: ParseStatus.DONE,
          rawText,
          wordCount,
          tables: tables as unknown as object,
          parsedJson: parsedJson as unknown as object,
          isAmendment,
          originalRcpNo,
          amendmentDiff: (amendmentDiff as unknown as object) ?? null,
          parsedAt: new Date(),
          lastError: lastErrorMsg,
        },
      });

      this.logger.log(
        `파싱 완료: rcpNo=${rcpNo}, eventType=${eventType}, tables=${tables.length}`,
      );

      // DAR-95: 파싱 완료 직후 표준 정량 fact 영구 적재(이미 받은 XML 재활용, 신규 호출 0)
      // await 없음 — fact 적재 실패가 M1 결과에 영향을 주지 않도록(graceful)
      if (this.dartFiledFactService) {
        this.dartFiledFactService
          .persistFromParsedJson(rcpNo, disclosure.corpCode, parsedJson)
          .catch((err: Error) =>
            this.logger.warn(
              `DartFiledFact 적재 실패 rcpNo=${rcpNo}: ${err.message}`,
            ),
          );
      }

      // M2 체이닝: 파싱 완료(parseStatus = DONE) 직후 비동기 이벤트 추출 시작
      // await 없음 — M2 실패가 M1 결과에 영향을 주지 않도록
      if (this.disclosureEventsService) {
        this.disclosureEventsService
          .onDocumentParsed(rcpNo)
          .catch((err: Error) =>
            this.logger.warn(`M2 체이닝 실패 rcpNo=${rcpNo}: ${err.message}`),
          );
      }

      return updatedDoc;
    } catch (error) {
      this.logger.error(`파싱 실패: rcpNo=${rcpNo}`, error);
      return await this.updateDocFailed(
        rcpNo,
        ParseStatus.PARSE_FAILED,
        truncate((error as Error).message, MAX_LAST_ERROR_LENGTH),
        doc.retryCount,
      );
    }
  }

  /**
   * PENDING 상태 건 배치 처리
   * 동시 처리 최대 5건 (Promise.allSettled 사용)
   */
  async processPendingBatch(
    limit = DEFAULT_BATCH_LIMIT,
  ): Promise<{ success: number; failed: number; durationMs: number }> {
    const safeLimit = Math.min(limit, MAX_BATCH_LIMIT);
    const startTime = Date.now();

    const pendingDocs = await this.prisma.disclosureDocument.findMany({
      where: { parseStatus: ParseStatus.PENDING },
      take: safeLimit,
      orderBy: { createdAt: 'asc' },
      select: { rcpNo: true },
    });

    if (pendingDocs.length === 0) {
      return { success: 0, failed: 0, durationMs: Date.now() - startTime };
    }

    this.logger.log(`배치 파싱 시작: ${pendingDocs.length}건`);

    let success = 0;
    let failed = 0;

    // BATCH_CONCURRENCY 단위로 청크 분할
    const chunks = chunkArray(
      pendingDocs.map((d) => d.rcpNo),
      BATCH_CONCURRENCY,
    );

    for (const chunk of chunks) {
      const results = await Promise.allSettled(
        chunk.map((rcpNo) => this.parseDisclosure(rcpNo)),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.parseStatus === ParseStatus.DONE) {
            success++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this.logger.log(
      `배치 파싱 완료: 성공=${success}, 실패=${failed}, 소요=${durationMs}ms`,
    );

    return { success, failed, durationMs };
  }

  /**
   * 수집 완료 후 파싱 큐 등록
   * - DONE 상태인 rcpNo는 skip
   * - corpCode를 Disclosure 테이블에서 조회해 함께 upsert
   */
  async enqueueParsing(rcpNos: string[]): Promise<void> {
    if (rcpNos.length === 0) return;

    // 기존 DONE 상태 rcpNo 조회
    const existing = await this.prisma.disclosureDocument.findMany({
      where: { rcpNo: { in: rcpNos }, parseStatus: ParseStatus.DONE },
      select: { rcpNo: true },
    });
    const doneSet = new Set(existing.map((d) => d.rcpNo));

    const toEnqueue = rcpNos.filter((r) => !doneSet.has(r));
    if (toEnqueue.length === 0) return;

    // Disclosure에서 corpCode 조회
    const disclosures = await this.prisma.disclosure.findMany({
      where: { rcpNo: { in: toEnqueue } },
      select: { rcpNo: true, corpCode: true },
    });
    const corpCodeMap = new Map(disclosures.map((d) => [d.rcpNo, d.corpCode]));

    // PENDING으로 upsert (이미 있으면 status 유지)
    for (const rcpNo of toEnqueue) {
      const corpCode = corpCodeMap.get(rcpNo);
      if (!corpCode) continue;

      await this.prisma.disclosureDocument.upsert({
        where: { rcpNo },
        create: {
          rcpNo,
          corpCode,
          parseStatus: ParseStatus.PENDING,
        },
        update: {}, // 이미 있으면 현재 상태 유지
      });
    }

    this.logger.log(`파싱 큐 등록: ${toEnqueue.length}건`);
  }

  /**
   * 재처리 대상 조회
   * parseStatus IN [FETCH_FAILED, PARSE_FAILED] AND retryCount < MAX_RETRY
   */
  async getRetryQueue(
    limit = DEFAULT_RETRY_LIMIT,
  ): Promise<Pick<DisclosureDocument, 'rcpNo'>[]> {
    // claim·parseDisclosure 는 rcpNo 만 사용하므로 select 로 경량화한다.
    // select 없이 조회하면 행마다 rawText(@db.Text 최대 200KB)·parsedJson·tables
    // 등 대용량 컬럼을 DB→앱으로 불필요 전송한다(매 30분 재처리 스케줄러).
    return this.prisma.disclosureDocument.findMany({
      where: {
        parseStatus: {
          in: [ParseStatus.FETCH_FAILED, ParseStatus.PARSE_FAILED],
        },
        retryCount: { lt: MAX_RETRY },
      },
      take: limit,
      orderBy: { updatedAt: 'asc' },
      select: { rcpNo: true },
    });
  }

  /**
   * 재처리 큐 강제 실행
   *
   * DAR-283: getRetryQueue(SELECT) → setImmediate fire-and-forget 사이에는
   * claim이 없어, 백그라운드 파싱이 30분(스케줄러 간격)을 넘기거나 프로세스
   * 재시작이 겹치면 다음 틱이 아직 FETCH_FAILED/PARSE_FAILED 인 동일 문서를
   * 재선택 → 중복 parseDisclosure(DART 재fetch 낭비·retryCount 경합)가 발생했다.
   * 선택 직후 각 문서를 조건부 updateMany 로 FETCHING(인-플라이트)으로 원자적
   * claim 한다. 단일 UPDATE ... WHERE 는 DB가 직렬화하므로, 오버랩한 두 실행이
   * 동일 문서를 보더라도 status 가이드(FETCH_FAILED/PARSE_FAILED)에 한 번만
   * 매칭되어 정확히 한 쪽만 claim(count===1)하고 다른 쪽은 skip(count===0)한다.
   * parseDisclosure 가 즉시 FETCHING 으로 전이하던 기존 흐름과 동일한 상태라
   * 성공/실패 종결 흐름·MAX_RETRY 경계는 불변이다.
   */
  async runRetryQueue(limit = DEFAULT_RETRY_LIMIT): Promise<{ queued: number }> {
    const candidates = await this.getRetryQueue(limit);
    if (candidates.length === 0) return { queued: 0 };

    // 원자적 claim: 재처리 대상 상태에서 직접 전이에 성공한 문서만 이번 실행의 몫.
    // 오버랩/재시작으로 경쟁한 다른 실행은 count===0 으로 해당 문서를 건너뛴다.
    const claimed: Pick<DisclosureDocument, 'rcpNo'>[] = [];
    for (const doc of candidates) {
      const { count } = await this.prisma.disclosureDocument.updateMany({
        where: {
          rcpNo: doc.rcpNo,
          parseStatus: {
            in: [ParseStatus.FETCH_FAILED, ParseStatus.PARSE_FAILED],
          },
          retryCount: { lt: MAX_RETRY },
        },
        data: { parseStatus: ParseStatus.FETCHING },
      });
      if (count === 1) claimed.push(doc);
    }

    if (claimed.length === 0) return { queued: 0 };

    this.logger.log(`재처리 실행: ${claimed.length}건 claim`);

    // 비동기 처리 (await 없이 실행 — 응답 후 백그라운드)
    setImmediate(async () => {
      for (const doc of claimed) {
        try {
          await this.parseDisclosure(doc.rcpNo);
        } catch (error) {
          this.logger.error(`재처리 실패: rcpNo=${doc.rcpNo}`, error);
        }
      }
    });

    return { queued: claimed.length };
  }

  /**
   * 파싱 상태 현황 집계
   */
  async getStats(): Promise<Record<ParseStatus, number>> {
    const groups = await this.prisma.disclosureDocument.groupBy({
      by: ['parseStatus'],
      _count: { rcpNo: true },
    });

    // 모든 ParseStatus 초기화
    const stats = Object.values(ParseStatus).reduce(
      (acc, status) => {
        acc[status] = 0;
        return acc;
      },
      {} as Record<ParseStatus, number>,
    );

    for (const group of groups) {
      stats[group.parseStatus] = group._count.rcpNo;
    }

    return stats;
  }

  /**
   * 단건 파싱 결과 조회 (rawText 제외)
   */
  async findOne(rcpNo: string): Promise<DisclosureDocument> {
    // rawText는 응답 DTO(ParseResultDto)에서 제외되므로 엔티티는 전체 조회
    const doc = await this.prisma.disclosureDocument.findUnique({
      where: { rcpNo },
    });

    if (!doc) {
      throw new NotFoundException(`파싱 결과 없음: rcpNo=${rcpNo}`);
    }

    return doc;
  }

  // ─── Private 헬퍼 ────────────────────────────────────────────────────────

  private async updateDocFailed(
    rcpNo: string,
    status: 'FETCH_FAILED' | 'PARSE_FAILED',
    errorMsg: string,
    currentRetryCount: number,
  ): Promise<DisclosureDocument> {
    const newRetryCount = currentRetryCount + 1;

    // MAX_RETRY 초과 시 SKIPPED로 전환
    const finalStatus =
      newRetryCount >= MAX_RETRY ? ParseStatus.SKIPPED : status;

    return this.prisma.disclosureDocument.update({
      where: { rcpNo },
      data: {
        parseStatus: finalStatus,
        lastError: truncate(errorMsg, MAX_LAST_ERROR_LENGTH),
        retryCount: newRetryCount,
      },
    });
  }

  /**
   * DB 룩업으로 원공시 rcpNo 보완 (규칙 A-04)
   * 동일 corpCode + 동일 공시 유형 + 현재 공시 이전 30일 이내 공시 중 가장 최근 1건
   */
  private async findOriginalRcpNoByLookup(
    corpCode: string,
    reportName: string,
    rcpDt: string,
  ): Promise<string | null> {
    // 정정 패턴 제거 후 유사 reportName
    const cleanedName = reportName
      .replace(/\[기재정정\]|\[첨부정정\]|\[자진정정\]|\[정정\]|\(정정\)/g, '')
      .trim();

    if (!cleanedName) return null;

    // 30일 이전 날짜 계산 (YYYYMMDD 형식)
    const rcpDate = parseRcpDt(rcpDt);
    if (!rcpDate) return null;

    const thirtyDaysAgo = new Date(rcpDate);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoStr = formatDate(thirtyDaysAgo);

    const candidates = await this.prisma.disclosure.findMany({
      where: {
        corpCode,
        rcpDt: { gte: thirtyDaysAgoStr, lt: rcpDt },
        reportName: { contains: cleanedName.slice(0, 10) },
        rmk: { not: { contains: '[기재정정]' } },
      },
      orderBy: { rcpDt: 'desc' },
      take: 2,
      select: { rcpNo: true },
    });

    // 1건만 매칭되면 해당 rcpNo 반환
    return candidates.length === 1 ? candidates[0].rcpNo : null;
  }

  /**
   * 복수 정정 시 최초 원공시 rcpNo로 체인 해소 (규칙 A-05)
   */
  private async resolveRootOriginalRcpNo(rcpNo: string): Promise<string> {
    let current = rcpNo;
    const visited = new Set<string>();

    while (true) {
      if (visited.has(current)) break; // 무한 루프 방지
      visited.add(current);

      const doc = await this.prisma.disclosureDocument.findUnique({
        where: { rcpNo: current },
        select: { isAmendment: true, originalRcpNo: true },
      });

      if (!doc || !doc.isAmendment || !doc.originalRcpNo) break;
      current = doc.originalRcpNo;
    }

    return current;
  }
}

// ─── 유틸 함수 ───────────────────────────────────────────────────────────────

function truncate(str: string, maxLen: number): string {
  return str.length > maxLen ? str.slice(0, maxLen) : str;
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function parseRcpDt(rcpDt: string): Date | null {
  if (!rcpDt || rcpDt.length < 8) return null;
  const y = parseInt(rcpDt.slice(0, 4), 10);
  const m = parseInt(rcpDt.slice(4, 6), 10) - 1;
  const d = parseInt(rcpDt.slice(6, 8), 10);
  const date = new Date(y, m, d);
  return isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
