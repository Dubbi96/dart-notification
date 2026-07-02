// backend/src/engine1-disclosure/disclosure-documents/disclosure-documents.chaining.spec.ts
// DQ-1: 파싱→이벤트추출(M1→M2) 직결 체이닝 발화 보증
//
// 회귀 원인: disclosure-documents.service.ts 의 `import type { DisclosureEventsService }` 가
// 컴파일 시 지워져 design:paramtypes 가 Object 로 퇴화 → Nest 가 DI 토큰을 찾지 못해
// @Optional() 주입이 항상 undefined → 파싱 완료 후 onDocumentParsed 체이닝이 침묵 미발화.
// 본 스펙은 ① DI 메타데이터(paramtypes) ② Nest DI 실주입 + 호출 스파이 ③ 미주입 부팅 경고를 고정한다.

import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ParseStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
import { DisclosureDocumentsService } from './disclosure-documents.service';

const RCP_NO = '20260702000001';

/** 단건 파싱 happy-path 를 통과시키는 최소 Prisma 목. */
function makePrismaMock() {
  return {
    disclosure: {
      findUnique: jest.fn().mockResolvedValue({
        rcpNo: RCP_NO,
        corpCode: 'C1',
        reportName: '주요사항보고서(유상증자결정)',
        rmk: '',
        rcpDt: '20260701',
      }),
    },
    disclosureDocument: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ rcpNo: RCP_NO, retryCount: 0 }),
      // update 는 fetchedAt → PARSING → DONE 순으로 3회 호출된다. 반환값은 마지막(DONE)만 사용.
      update: jest.fn(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ rcpNo: RCP_NO, corpCode: 'C1', ...data }),
      ),
    },
  };
}

/** EMPTY_DOCUMENT 임계(50자)를 넘는 본문을 가진 DART 목. */
function makeDartApiMock() {
  const body = '유상증자 결정에 관한 공시 본문입니다. '.repeat(10);
  return {
    downloadDocument: jest.fn().mockResolvedValue(Buffer.from('zip')),
    extractDocumentFromZip: jest.fn().mockResolvedValue({
      html: `<html><body><p>${body}</p></body></html>`,
      xml: undefined,
    }),
  };
}

describe('DQ-1 — M2 체이닝 DI 토큰 보존 (import type 회귀 가드)', () => {
  it('생성자 paramtypes[2] 가 DisclosureEventsService 클래스다 (Object 퇴화 아님)', () => {
    const paramtypes = Reflect.getMetadata(
      'design:paramtypes',
      DisclosureDocumentsService,
    ) as unknown[];

    // `import type` 이면 토큰이 Object 로 지워져 @Optional 주입이 항상 undefined 가 된다.
    expect(paramtypes[2]).toBe(DisclosureEventsService);
    expect(paramtypes[2]).not.toBe(Object);
  });
});

describe('DQ-1 — Nest DI 실주입 + 파싱 완료 시 체이닝 발화', () => {
  it('파싱 DONE 직후 disclosureEventsService.onDocumentParsed(rcpNo) 가 호출된다', async () => {
    const prismaMock = makePrismaMock();
    const dartApiMock = makeDartApiMock();
    const eventsMock = {
      onDocumentParsed: jest.fn().mockResolvedValue(undefined),
    };

    // 실제 Nest DI 컨테이너로 조립 — @Optional 이 undefined 로 새는지(회귀) 직접 검증.
    const moduleRef = await Test.createTestingModule({
      providers: [
        DisclosureDocumentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: DartApiService, useValue: dartApiMock },
        { provide: DisclosureEventsService, useValue: eventsMock },
      ],
    }).compile();

    const service = moduleRef.get(DisclosureDocumentsService);
    const result = await service.parseDisclosure(RCP_NO);

    // happy-path 완주(DONE) — 체이닝 분기(parseStatus=DONE 직후)까지 도달했음을 보장.
    expect(result.parseStatus).toBe(ParseStatus.DONE);
    // 체이닝 발화: 주입이 undefined 였다면(회귀) 호출 0 으로 실패한다.
    expect(eventsMock.onDocumentParsed).toHaveBeenCalledTimes(1);
    expect(eventsMock.onDocumentParsed).toHaveBeenCalledWith(RCP_NO);
  });
});

describe('DQ-1 — 주입 실패 침묵 방지 (부팅 경고)', () => {
  it('DisclosureEventsService 미주입이면 경고 로그 1줄을 남긴다', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      new DisclosureDocumentsService(
        makePrismaMock() as unknown as PrismaService,
        makeDartApiMock() as unknown as DartApiService,
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('M2 체이닝 미배선'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('정상 주입이면 경고 로그가 없다', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    try {
      new DisclosureDocumentsService(
        makePrismaMock() as unknown as PrismaService,
        makeDartApiMock() as unknown as DartApiService,
        { onDocumentParsed: jest.fn() } as unknown as DisclosureEventsService,
      );
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
