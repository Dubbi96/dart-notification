// backend/src/engine1-disclosure/disclosure-documents/disclosure-documents.rate-limit-isolation.spec.ts
// DAR-392: 레이트리밋/일일쿼터 fetch 실패는 retryCount 를 소모하지 않아 멀쩡한 문서가
//   영구 SKIPPED 되지 않는다(백데이터 풀커버 보호). 진짜 결함만 누적→SKIPPED 격리.

import { ParseStatus, DisclosureDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { LocalStorageService } from './storage/storage.service';
import { DisclosureDocumentsService } from './disclosure-documents.service';

const MAX_RETRY = 3;

describe('DisclosureDocumentsService 레이트리밋/쿼터 retryCount 격리 (DAR-392)', () => {
  let service: DisclosureDocumentsService;
  let updateData: Record<string, unknown> | null;
  let downloadError: Error;

  /** parseDisclosure 의 fetch 실패 경로를 태우기 위한 최소 prisma 목. */
  function build(existingRetryCount: number) {
    updateData = null;
    const prisma = {
      disclosure: {
        findUnique: jest.fn().mockResolvedValue({
          rcpNo: 'R1',
          corpCode: 'C1',
          reportName: '단일판매ㆍ공급계약체결',
          rmk: '',
          rcpDt: '20250101',
        }),
      },
      disclosureDocument: {
        findUnique: jest.fn().mockResolvedValue({
          rcpNo: 'R1',
          parseStatus: ParseStatus.FETCH_FAILED,
          retryCount: existingRetryCount,
        }),
        upsert: jest
          .fn()
          .mockResolvedValue({ retryCount: existingRetryCount }),
        update: jest.fn().mockImplementation(({ data }) => {
          updateData = data;
          return Promise.resolve({
            rcpNo: 'R1',
            ...data,
          } as unknown as DisclosureDocument);
        }),
      },
    } as unknown as PrismaService;

    const dartApi = {
      downloadDocument: jest.fn().mockRejectedValue(downloadError),
    } as unknown as DartApiService;

    service = new DisclosureDocumentsService(
      prisma,
      dartApi,
      {} as unknown as LocalStorageService,
    );
  }

  it('일일쿼터(dartStatus=020) 실패 → FETCH_FAILED, retryCount 비소모·QUOTA 마커', async () => {
    downloadError = new Error(
      'DART document.xml 응답이 ZIP이 아님: httpStatus=200, dartStatus=020, message=요청 제한을 초과하였습니다',
    );
    build(1);

    await service.parseDisclosure('R1');

    expect(updateData?.parseStatus).toBe(ParseStatus.FETCH_FAILED);
    expect(updateData?.retryCount).toBe(1); // 소모 안 함
    expect(String(updateData?.lastError)).toContain('QUOTA');
  });

  it('레이트리밋(HTTP 429) 실패 → FETCH_FAILED, retryCount 비소모·RATE_LIMIT 마커', async () => {
    downloadError = new Error('Request failed with status code 429');
    build(2);

    await service.parseDisclosure('R1');

    expect(updateData?.parseStatus).toBe(ParseStatus.FETCH_FAILED);
    expect(updateData?.retryCount).toBe(2); // 소모 안 함
    expect(String(updateData?.lastError)).toContain('RATE_LIMIT');
  });

  it('★일시적 쿼터는 MAX 직전이어도 영구 SKIPPED 되지 않는다(풀커버 보호)', async () => {
    downloadError = new Error(
      'DART document.xml 응답이 ZIP이 아님: dartStatus=020, message=요청 제한 초과',
    );
    build(MAX_RETRY - 1); // 2 — 일반 실패였다면 다음 실패가 SKIPPED

    await service.parseDisclosure('R1');

    expect(updateData?.parseStatus).toBe(ParseStatus.FETCH_FAILED); // SKIPPED 아님
    expect(updateData?.retryCount).toBe(MAX_RETRY - 1); // 그대로
  });

  it('진짜 결함(일반 fetch 오류)은 기존대로 retryCount 누적', async () => {
    downloadError = new Error('socket hang up');
    build(1);

    await service.parseDisclosure('R1');

    expect(updateData?.parseStatus).toBe(ParseStatus.FETCH_FAILED);
    expect(updateData?.retryCount).toBe(2); // 누적
    expect(String(updateData?.lastError)).toContain('socket hang up');
  });

  it('진짜 결함이 MAX 도달하면 SKIPPED 로 영구 격리(기존 계약 유지)', async () => {
    downloadError = new Error('socket hang up');
    build(MAX_RETRY - 1); // 2 → +1 = 3 = MAX → SKIPPED

    await service.parseDisclosure('R1');

    expect(updateData?.parseStatus).toBe(ParseStatus.SKIPPED);
    expect(updateData?.retryCount).toBe(MAX_RETRY);
  });
});
