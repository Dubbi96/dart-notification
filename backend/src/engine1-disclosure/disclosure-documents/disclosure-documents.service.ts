// backend/src/disclosure-documents/disclosure-documents.service.ts
// 파싱 파이프라인 오케스트레이터 (M1)

import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ParseStatus, DisclosureDocument, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartApiUnavailableError,
} from '../dart-api/dart-api.service';
import { RawTextStoreService } from '../../common/storage/raw-text-store.service';
import { TablesStoreService } from '../../common/storage/tables-store.service';
import { RawHtmlStoreService } from '../../common/storage/raw-html-store.service';
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
// DQ-1: 반드시 값 import — `import type` 은 컴파일 시 지워져 design:paramtypes 가 Object 로
//   퇴화하고, Nest 가 DI 토큰을 찾지 못해 @Optional() 이 항상 undefined 를 주입한다
//   (파싱→추출 직결 체이닝이 런타임에서 침묵 미발화). 회귀 가드: disclosure-documents.chaining.spec.ts
// 순환 참조 없음: disclosure-events.service 는 이 파일이 아닌 types/·utils/ 만 역참조한다
//   (모듈 레벨은 disclosure-documents.module 의 forwardRef(() => DisclosureEventsModule) 유지)
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
// DAR-293: 파싱 재시도 캡 SSOT — pipeline-integrity.service와 공유(발산 방지)
import { PARSE_MAX_RETRY as MAX_RETRY } from './disclosure-documents.constants';
// DAR-394: 거래대상(신호 생산) 우선 fetch — 보고서명 메타데이터 선별(쿼터 최적화)
import {
  isTradeRelevantReportName,
  tradeRelevantReportNameFilter,
} from '../disclosure-events/extractors/trade-relevance';

// ─── 상수 ────────────────────────────────────────────────────────────────────
const MAX_RAWTEXT_LENGTH = 200_000;  // 200KB 상한
const MAX_LAST_ERROR_LENGTH = 500;
const BATCH_CONCURRENCY = 5;
const DEFAULT_BATCH_LIMIT = 50;
const MAX_BATCH_LIMIT = 200;
const DEFAULT_RETRY_LIMIT = 20;
// 빈 문서 기준 (P-03)
const EMPTY_DOCUMENT_THRESHOLD = 50;

/** DAR-394: 배치 파싱 선택 옵션. */
export interface ProcessPendingOptions {
  /** 거래대상(신호 생산) 공시를 우선 선택 (기본 true). false 면 enqueue 순(FIFO). */
  prioritizeTradeRelevant?: boolean;
  /**
   * 비거래대상 공시를 이번 배치에서 제외 (기본 false). true 면 쿼터를 거래대상에만
   * 집중(신호 커버리지 극대화)하되 비거래 문서는 후일로 미룬다. prioritizeTradeRelevant
   * 가 true 일 때만 의미가 있다.
   */
  skipNonTrade?: boolean;
}

/** 배치 파싱 결과 — DAR-394: 이번 배치의 거래대상 선택 수(tradeRelevant) 포함. */
export interface ProcessPendingResult {
  success: number;
  failed: number;
  durationMs: number;
  /** 이번 배치에서 거래대상으로 선택된 문서 수(가시성·검증용). */
  tradeRelevant: number;
}

@Injectable()
export class DisclosureDocumentsService {
  private readonly logger = new Logger(DisclosureDocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApiService: DartApiService,
    // M2 체이닝: DisclosureEventsService가 없어도(미배포 시) 정상 동작하도록 @Optional() 사용
    @Optional()
    private readonly disclosureEventsService?: DisclosureEventsService,
    // DAR-95: 파싱 완료 후 표준 fact 영구 적재(@Optional — 미배포 시 무중단)
    @Optional()
    private readonly dartFiledFactService?: DartFiledFactService,
    // DAR-395: 원문 rawText 객체 스토리지 오프로드(@Optional — StorageModule 미배선 시 기존 동작 보존).
    @Optional()
    private readonly rawTextStore?: RawTextStoreService,
    // DAR-399: 파싱 표(tables) 객체 스토리지 오프로드(@Optional — 미배선 시 기존 동작 보존).
    @Optional()
    private readonly tablesStore?: TablesStoreService,
    // DAR-401: 공시 원본 HTML 저장을 S3/객체 스토리지로 고정(로컬 디스크 write 제거).
    //   @Optional — StorageModule(@Global) 미배선 시 원본 HTML 저장만 비활성(파이프라인 무중단).
    @Optional()
    private readonly rawHtmlStore?: RawHtmlStoreService,
  ) {
    // DQ-1: 침묵 실패 방지 — M2 체이닝 미배선(주입 실패)이면 부팅 로그에 경고 1줄.
    //   과거 `import type` 회귀로 주입이 항상 undefined 였는데도 로그가 없어 미발화를 놓쳤다.
    if (!this.disclosureEventsService) {
      this.logger.warn(
        'M2 체이닝 미배선: DisclosureEventsService 주입 실패(undefined) — 파싱 완료 시 이벤트 추출 직결이 발화하지 않습니다(pipeline 드레인 회수에만 의존).',
      );
    }
  }

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
    let rawHtmlS3Key: string | null = null;

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

      // DAR-401: 원본 HTML 저장을 S3/객체 스토리지로 고정(로컬 디스크 storage/{rcpNo}/index.html 제거).
      //   gzip 업로드 후 반환 S3 키를 rawHtmlS3Key 포인터에 기록한다. 저장 실패는 graceful(키 null,
      //   파이프라인 무중단). rawFilePath 는 더 이상 신규 기록하지 않는다(레거시 로컬 경로 — null 고정).
      // DAR-397: 로컬 원시 파일(rawFilePath) write 는 #352(DAR-401)에서 이미 제거됨 — 본 계층화 PR은
      //   로컬 최소화 의도를 그대로 충족(신규 write 0). 잔존 레거시 rawFilePath 회수는 storage-ops 의
      //   POST /storage/cleanup-local-artifacts 가 담당한다.
      const content = html ?? xml ?? '';
      if (content) {
        rawHtmlS3Key = await this.saveRawHtml(rcpNo, content);
      }

      await this.prisma.disclosureDocument.update({
        where: { rcpNo },
        data: {
          fetchedAt: new Date(),
          rawHtmlS3Key,
          rawFilePath: null,
        },
      });
    } catch (error) {
      const rawMsg =
        error instanceof DartApiUnavailableError
          ? error.message
          : (error as Error).message;

      // DAR-392: 레이트리밋/일일쿼터(020/021/429)는 '문서 결함' 이 아니라 '일시적 처리 한도' 다.
      // retryCount 를 증가시키면 쿼터가 회복되기 전에 MAX_RETRY 를 소진해 멀쩡한 문서가 영구
      // SKIPPED 된다(백데이터 풀커버를 사일런트로 갉아먹음). → FETCH_FAILED 로 두되 retryCount 는
      // 소모하지 않아(countRetry=false) 재처리 큐가 계속 재시도하고, 다음날 쿼터 리셋 후 자동 회복.
      // 진짜 결함(OTHER: EMPTY_ZIP·파싱불가 등)만 기존대로 retryCount 누적 → MAX 초과 시 SKIPPED 격리.
      // ★FETCH_FAILED 로 두므로 배치 실패카운트에는 잡혀 스케줄러 적응형 백오프(실패율)는 그대로 작동.
      const klass = classifyFetchError(rawMsg);
      const errMsg = truncate(
        klass === 'OTHER' ? rawMsg : `${klass}: ${rawMsg}`,
        MAX_LAST_ERROR_LENGTH,
      );

      return await this.updateDocFailed(
        rcpNo,
        ParseStatus.FETCH_FAILED,
        errMsg,
        doc.retryCount,
        /* countRetry */ klass === 'OTHER',
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

      // DAR-395: 원문 rawText 오프로드 — 추출 시점에만 필요한 콜드 데이터를 객체 스토리지(S3/로컬)로
      //   내보내고 DB rawText 컬럼은 비운다(멀티이어 백필 시 DB 폭증 방지). 오프로드 실패는 graceful:
      //   rawText 를 DB 에 보존해 데이터 손실/기능 차단을 막는다(자격증명 후속 주입까지 안전).
      const { rawTextColumn, rawTextS3Key } = await this.offloadRawText(
        rcpNo,
        rawText,
      );

      // DAR-399: 파싱 표(tables)도 즉시 오프로드 — disclosure_documents TOAST 의 진짜 bulk(~1.6GB).
      //   신규 문서가 로컬 DB 에 tables 를 누적하지 않도록 파싱 완료 시점에 객체 스토리지로 내보낸다.
      //   이후 SHARE_BUYBACK 폴백 스캔(M2)은 tablesS3Key 로 lazy fetch. 오프로드 실패는 graceful(DB 보존).
      const { tablesColumn, tablesS3Key } = await this.offloadTables(
        rcpNo,
        tables,
      );

      const updatedDoc = await this.prisma.disclosureDocument.update({
        where: { rcpNo },
        data: {
          parseStatus: ParseStatus.DONE,
          rawText: rawTextColumn,
          rawTextS3Key,
          wordCount,
          tables: tablesColumn,
          tablesS3Key,
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
   * DAR-401: 원본 HTML 저장 결정 — 객체 스토리지(S3/로컬 폴백)로 gzip 업로드하고 DB rawHtmlS3Key 에
   *   넣을 포인터를 산출한다. 로컬 디스크 write 는 하지 않는다.
   * - rawHtmlStore 미주입(레거시 배선): 저장 비활성(키 null) — 파이프라인은 무중단(원본 HTML 은
   *   런타임에서 재사용되지 않는 쓰기전용 데이터라 저장 누락이 기능을 막지 않는다).
   * - 저장 성공: rawHtmlS3Key=객체 키.
   * - 저장 실패(스토리지 오류): 키 null(graceful) — fetch/파싱은 계속 진행.
   */
  private async saveRawHtml(
    rcpNo: string,
    html: string,
  ): Promise<string | null> {
    if (!this.rawHtmlStore) {
      return null;
    }
    try {
      return await this.rawHtmlStore.save(rcpNo, html);
    } catch (err) {
      this.logger.warn(
        `원본 HTML 저장 실패 → 건너뜀(graceful): rcpNo=${rcpNo}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * DAR-395: rawText 오프로드 결정 — 객체 스토리지로 내보내고 DB 컬럼에 넣을 값을 산출한다.
   * - rawTextStore 미주입(레거시 배선): 기존대로 rawText 를 DB 에 보존(오프로드 비활성).
   * - 오프로드 성공: rawText=null(DB 경량화) + rawTextS3Key=객체 키.
   * - 오프로드 실패(스토리지 오류): rawText 를 DB 에 보존(graceful·데이터 손실 0) + 키 null.
   */
  private async offloadRawText(
    rcpNo: string,
    rawText: string,
  ): Promise<{ rawTextColumn: string | null; rawTextS3Key: string | null }> {
    if (!this.rawTextStore) {
      return { rawTextColumn: rawText, rawTextS3Key: null };
    }
    try {
      const key = await this.rawTextStore.offload(rcpNo, rawText);
      return { rawTextColumn: null, rawTextS3Key: key };
    } catch (err) {
      this.logger.warn(
        `rawText 오프로드 실패 → DB 보존(graceful): rcpNo=${rcpNo}: ${(err as Error).message}`,
      );
      return { rawTextColumn: rawText, rawTextS3Key: null };
    }
  }

  /**
   * DAR-399: tables 오프로드 결정 — 객체 스토리지로 내보내고 DB 컬럼에 넣을 값을 산출한다.
   * - tablesStore 미주입(레거시 배선): 기존대로 tables 를 DB 에 보존(오프로드 비활성).
   * - 오프로드 성공: tables=null(DB 경량화·TOAST bulk 해소) + tablesS3Key=객체 키.
   * - 오프로드 실패(스토리지 오류): tables 를 DB 에 보존(graceful·데이터 손실 0) + 키 null.
   */
  private async offloadTables(
    rcpNo: string,
    tables: Table[],
  ): Promise<{
    tablesColumn: Prisma.InputJsonValue | typeof Prisma.DbNull;
    tablesS3Key: string | null;
  }> {
    const keep = tables as unknown as Prisma.InputJsonValue;
    if (!this.tablesStore) {
      return { tablesColumn: keep, tablesS3Key: null };
    }
    try {
      const key = await this.tablesStore.offload(rcpNo, tables);
      // 오프로드 성공 → DB 컬럼은 SQL NULL(Prisma.DbNull)로 비워 TOAST 용량을 회수 대상에 둔다.
      return { tablesColumn: Prisma.DbNull, tablesS3Key: key };
    } catch (err) {
      this.logger.warn(
        `tables 오프로드 실패 → DB 보존(graceful): rcpNo=${rcpNo}: ${(err as Error).message}`,
      );
      return { tablesColumn: keep, tablesS3Key: null };
    }
  }

  /**
   * PENDING 상태 건 배치 처리
   * 동시 처리 최대 5건 (Promise.allSettled 사용)
   *
   * DAR-394(쿼터 최적): 선택을 거래대상(신호 생산) 우선으로 정렬한다. 한정된 DART
   *   일일 fetch 쿼터를 신호를 만드는 공시(공급계약·자사주·유상증자·CB/BW·실적 등)에
   *   먼저 쓰기 위함. 거래대상은 보고서명 메타데이터만으로 fetch 전에 선별하므로 추가
   *   쿼터 소모가 없다. 기본은 비거래대상도 후순위로 채워(skipNonTrade=false) 전량
   *   커버리지를 보존한다 — 순서만 바뀌고 누락은 없다(회귀 0).
   */
  async processPendingBatch(
    limit = DEFAULT_BATCH_LIMIT,
    options: ProcessPendingOptions = {},
  ): Promise<ProcessPendingResult> {
    const { prioritizeTradeRelevant = true, skipNonTrade = false } = options;
    const safeLimit = Math.min(limit, MAX_BATCH_LIMIT);
    const startTime = Date.now();

    const selection = prioritizeTradeRelevant
      ? await this.selectPrioritizedPending(safeLimit, skipNonTrade)
      : { rcpNos: await this.selectPendingFifo(safeLimit), tradeRelevant: 0 };

    const rcpNos = selection.rcpNos;
    if (rcpNos.length === 0) {
      return {
        success: 0,
        failed: 0,
        durationMs: Date.now() - startTime,
        tradeRelevant: 0,
      };
    }

    this.logger.log(
      `배치 파싱 시작: ${rcpNos.length}건` +
        (prioritizeTradeRelevant
          ? ` (거래대상 우선=${selection.tradeRelevant}, 비거래=${rcpNos.length - selection.tradeRelevant})`
          : ''),
    );

    let success = 0;
    let failed = 0;

    // BATCH_CONCURRENCY 단위로 청크 분할
    const chunks = chunkArray(rcpNos, BATCH_CONCURRENCY);

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

    return { success, failed, durationMs, tradeRelevant: selection.tradeRelevant };
  }

  /** PENDING 문서를 enqueue 순(createdAt asc)으로 선택 — 우선순위 미적용 경로. */
  private async selectPendingFifo(limit: number): Promise<string[]> {
    const docs = await this.prisma.disclosureDocument.findMany({
      where: { parseStatus: ParseStatus.PENDING },
      take: limit,
      orderBy: { createdAt: 'asc' },
      select: { rcpNo: true },
    });
    return docs.map((d) => d.rcpNo);
  }

  /**
   * DAR-394: PENDING 문서를 거래대상(신호 생산) 우선으로 선택한다.
   *
   * 1) 거래대상 후보를 보고서명 키워드로 DB 사전선별(상위집합) 후, 정밀 정규식
   *    (isTradeRelevantReportName, classifier SSOT)으로 확정. 최신 접수일(rcpDt desc)
   *    우선 — 백테스트 최근 구간을 빠르게 채운다.
   * 2) 거래대상이 limit 미만이고 skipNonTrade=false 면, 나머지를 비거래 PENDING
   *    (enqueue 순 createdAt asc)으로 채워 전량 커버리지를 보존한다.
   *
   * 멱등·read-only 선택(상태 전이는 parseDisclosure 가 수행). 쿼터는 본 선택에서
   * 소모되지 않는다(보고서명은 이미 백필된 메타데이터).
   */
  private async selectPrioritizedPending(
    limit: number,
    skipNonTrade: boolean,
  ): Promise<{ rcpNos: string[]; tradeRelevant: number }> {
    // 1) 거래대상 후보 prefilter — 키워드 매칭 PENDING 을 최신 접수일 우선으로.
    //    take 를 약간 넉넉히(×1.5) 잡아 정밀 정규식이 일부 거짓양성을 떨궈도
    //    limit 을 채울 거래대상 풀을 확보한다(MAX_BATCH_LIMIT×2 상한).
    const prefilterTake = Math.min(Math.ceil(limit * 1.5), MAX_BATCH_LIMIT * 2);
    const candidates = await this.prisma.disclosureDocument.findMany({
      where: {
        parseStatus: ParseStatus.PENDING,
        disclosure: tradeRelevantReportNameFilter(),
      },
      take: prefilterTake,
      // 최신 접수일 우선(백테스트 최근 구간 우선 충전). rcpNo 동률 정렬로 결정론 보장.
      orderBy: [{ disclosure: { rcpDt: 'desc' } }, { rcpNo: 'desc' }],
      select: { rcpNo: true, disclosure: { select: { reportName: true } } },
    });

    // 정밀 확정(정규식 SSOT) — 키워드 거짓양성 제거.
    const tradeRelevant = candidates
      .filter((d) => isTradeRelevantReportName(d.disclosure.reportName))
      .map((d) => d.rcpNo)
      .slice(0, limit);

    if (tradeRelevant.length >= limit || skipNonTrade) {
      return { rcpNos: tradeRelevant, tradeRelevant: tradeRelevant.length };
    }

    // 2) 비거래 fill — 거래대상으로 다 못 채운 잔여를 enqueue 순으로 보충.
    //    notIn 으로 이미 선택한 거래대상은 배제(중복 방지).
    const remaining = limit - tradeRelevant.length;
    const fill = await this.prisma.disclosureDocument.findMany({
      where: {
        parseStatus: ParseStatus.PENDING,
        rcpNo: { notIn: tradeRelevant },
      },
      take: remaining,
      orderBy: { createdAt: 'asc' },
      select: { rcpNo: true },
    });

    return {
      rcpNos: [...tradeRelevant, ...fill.map((d) => d.rcpNo)],
      tradeRelevant: tradeRelevant.length,
    };
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
    // DAR-392: false 면 retryCount 를 소모하지 않는다(레이트리밋/쿼터 — 영구 SKIPPED 금지).
    countRetry = true,
  ): Promise<DisclosureDocument> {
    const newRetryCount = countRetry ? currentRetryCount + 1 : currentRetryCount;

    // MAX_RETRY 초과 시 SKIPPED로 전환. retryCount 비소모(countRetry=false)면 SKIPPED 로 가지 않아
    // 일시적 레이트리밋/쿼터로 멀쩡한 문서가 영구 격리되지 않는다(다음 재처리 사이클에서 재시도).
    const finalStatus =
      countRetry && newRetryCount >= MAX_RETRY ? ParseStatus.SKIPPED : status;

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

/** DART fetch 실패 분류(DAR-392). QUOTA=일일쿼터·조회회사수 소진, RATE_LIMIT=일시 제한, OTHER=일반 결함. */
type FetchErrorClass = 'QUOTA' | 'RATE_LIMIT' | 'OTHER';

/**
 * DART fetch 오류 메시지를 분류한다(DAR-392).
 * downloadDocument 는 ZIP 이 아닌 응답에서 `dartStatus=NNN` 을 포함한 Error 를 던진다.
 *  - 020(요청 제한 초과=일일쿼터 20,000건)·021(조회 가능 회사수 초과) → QUOTA
 *  - HTTP 429 / "too many requests" / "rate limit" → RATE_LIMIT
 *  - 그 외(EMPTY_ZIP·타임아웃·파싱불가·키 미설정 등) → OTHER(기존대로 retryCount 누적→SKIPPED)
 *
 * QUOTA·RATE_LIMIT 는 retryCount 를 소모하지 않게 처리해(updateDocFailed countRetry=false)
 * 일시적 한도로 멀쩡한 문서가 영구 SKIPPED 되는 것을 막는다.
 */
function classifyFetchError(message: string): FetchErrorClass {
  const raw = message ?? '';
  const m = raw.toLowerCase();
  // 일일 쿼터·조회회사수 초과(영구 SKIPPED 금지 — 다음날 회복).
  if (
    m.includes('dartstatus=020') ||
    m.includes('dartstatus=021') ||
    raw.includes('요청 제한') ||
    raw.includes('요청제한')
  ) {
    return 'QUOTA';
  }
  // 일시적 레이트리밋(HTTP 429 등) — 짧은 회복 후 재시도.
  if (
    m.includes('429') ||
    m.includes('too many requests') ||
    m.includes('rate limit') ||
    m.includes('rate-limit')
  ) {
    return 'RATE_LIMIT';
  }
  return 'OTHER';
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
