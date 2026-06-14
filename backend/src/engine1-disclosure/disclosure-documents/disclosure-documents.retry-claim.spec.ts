// backend/src/engine1-disclosure/disclosure-documents/disclosure-documents.retry-claim.spec.ts
// DAR-283: 재처리 큐 원자적 claim — 오버랩/재시작 시 같은 실패문서 중복 파싱 방지

import { ParseStatus, DisclosureDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { LocalStorageService } from './storage/storage.service';
import { DisclosureDocumentsService } from './disclosure-documents.service';

const MAX_RETRY = 3;

/** setImmediate 백그라운드 콜백 flush */
const flushBackground = () =>
  new Promise<void>((resolve) => setImmediate(resolve));

const makeDoc = (
  rcpNo: string,
  parseStatus: ParseStatus,
  retryCount = 0,
): DisclosureDocument =>
  ({
    rcpNo,
    corpCode: 'C1',
    parseStatus,
    retryCount,
  }) as unknown as DisclosureDocument;

describe('DisclosureDocumentsService.runRetryQueue claim (DAR-283)', () => {
  let service: DisclosureDocumentsService;

  /**
   * DB 상태를 모사하는 인메모리 store.
   * - findMany(getRetryQueue): FETCH_FAILED/PARSE_FAILED & retryCount<MAX 만 반환
   * - updateMany(claim): 동일 where 가이드를 단일 UPDATE 처럼 원자 적용,
   *   매칭 row 수(count)를 반환. claim 성공 시 FETCHING 으로 전이.
   */
  let store: Map<string, DisclosureDocument>;
  let prisma: {
    disclosureDocument: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  const isRetryEligible = (d: DisclosureDocument) =>
    (d.parseStatus === ParseStatus.FETCH_FAILED ||
      d.parseStatus === ParseStatus.PARSE_FAILED) &&
    d.retryCount < MAX_RETRY;

  beforeEach(() => {
    store = new Map();

    prisma = {
      disclosureDocument: {
        findMany: jest.fn(({ take }: { take?: number } = {}) => {
          const eligible = [...store.values()].filter(isRetryEligible);
          return Promise.resolve(
            take ? eligible.slice(0, take) : eligible,
          );
        }),
        updateMany: jest.fn(
          ({
            where,
            data,
          }: {
            where: {
              rcpNo: string;
              parseStatus: { in: ParseStatus[] };
              retryCount: { lt: number };
            };
            data: { parseStatus: ParseStatus };
          }) => {
            const doc = store.get(where.rcpNo);
            // 단일 UPDATE ... WHERE 직렬 적용: 가이드 미충족이면 count 0
            if (
              !doc ||
              !where.parseStatus.in.includes(doc.parseStatus) ||
              doc.retryCount >= where.retryCount.lt
            ) {
              return Promise.resolve({ count: 0 });
            }
            doc.parseStatus = data.parseStatus;
            return Promise.resolve({ count: 1 });
          },
        ),
      },
    };

    service = new DisclosureDocumentsService(
      prisma as unknown as PrismaService,
      {} as unknown as DartApiService,
      {} as unknown as LocalStorageService,
    );
  });

  it('오버랩(동일 배치 2회 연속 호출) 시 같은 rcpNo 가 1회만 parseDisclosure 된다', async () => {
    store.set('R1', makeDoc('R1', ParseStatus.FETCH_FAILED));
    store.set('R2', makeDoc('R2', ParseStatus.PARSE_FAILED));

    // parseDisclosure 는 실제 파이프라인 대신 스파이로 대체(상태는 claim 이 이미 FETCHING 으로 전이).
    const parseSpy = jest
      .spyOn(service, 'parseDisclosure')
      .mockResolvedValue({} as DisclosureDocument);

    // 1차 틱: 둘 다 claim
    const first = await service.runRetryQueue(20);
    // 2차 틱(오버랩): 백그라운드 파싱이 아직 끝나지 않아 findMany 가 stale 하게
    // 같은 문서를 반환하더라도, claim 가이드가 이미 FETCHING 인 문서를 거른다.
    const second = await service.runRetryQueue(20);

    await flushBackground();

    expect(first.queued).toBe(2);
    expect(second.queued).toBe(0);

    const parsed = parseSpy.mock.calls.map((c) => c[0]).sort();
    expect(parsed).toEqual(['R1', 'R2']);
    // 각 rcpNo 정확히 1회
    expect(parsed.filter((r) => r === 'R1')).toHaveLength(1);
    expect(parsed.filter((r) => r === 'R2')).toHaveLength(1);
  });

  it('claim 한 문서만 백그라운드 파싱한다(정상 단일 실행 불변)', async () => {
    store.set('R1', makeDoc('R1', ParseStatus.FETCH_FAILED));

    const parseSpy = jest
      .spyOn(service, 'parseDisclosure')
      .mockResolvedValue({} as DisclosureDocument);

    const result = await service.runRetryQueue(20);
    await flushBackground();

    expect(result.queued).toBe(1);
    expect(parseSpy).toHaveBeenCalledTimes(1);
    expect(parseSpy).toHaveBeenCalledWith('R1');
    // claim 으로 FETCHING 전이 → 재선택 대상에서 제외
    expect(store.get('R1')?.parseStatus).toBe(ParseStatus.FETCHING);
  });

  it('MAX_RETRY 도달 문서는 claim 대상이 아니다(경계 불변)', async () => {
    store.set('R1', makeDoc('R1', ParseStatus.FETCH_FAILED, MAX_RETRY));

    const parseSpy = jest
      .spyOn(service, 'parseDisclosure')
      .mockResolvedValue({} as DisclosureDocument);

    const result = await service.runRetryQueue(20);
    await flushBackground();

    expect(result.queued).toBe(0);
    expect(parseSpy).not.toHaveBeenCalled();
    // 상태 불변(FETCHING 으로 잘못 claim 하지 않음)
    expect(store.get('R1')?.parseStatus).toBe(ParseStatus.FETCH_FAILED);
  });

  it('재처리 대상이 없으면 claim/파싱 없이 0 반환', async () => {
    store.set('R1', makeDoc('R1', ParseStatus.DONE));

    const parseSpy = jest
      .spyOn(service, 'parseDisclosure')
      .mockResolvedValue({} as DisclosureDocument);

    const result = await service.runRetryQueue(20);
    await flushBackground();

    expect(result.queued).toBe(0);
    expect(prisma.disclosureDocument.updateMany).not.toHaveBeenCalled();
    expect(parseSpy).not.toHaveBeenCalled();
  });

  // DAR-288: getRetryQueue 가 rawText(200KB)·parsedJson 등 대용량 컬럼을 행마다
  // over-fetch 하지 않도록 select 로 rcpNo 만 조회하는지 보증한다.
  it('getRetryQueue 는 select: { rcpNo: true } 로 over-fetch 없이 조회한다', async () => {
    store.set('R1', makeDoc('R1', ParseStatus.FETCH_FAILED));

    await service.getRetryQueue(20);

    expect(prisma.disclosureDocument.findMany).toHaveBeenCalledTimes(1);
    const [findArgs] = prisma.disclosureDocument.findMany.mock.calls[0] as [
      { select?: Record<string, boolean> },
    ];
    expect(findArgs.select).toEqual({ rcpNo: true });
  });
});
