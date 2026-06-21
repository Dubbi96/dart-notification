// backend/src/engine1-disclosure/disclosure-documents/disclosure-documents.trade-priority.spec.ts
// DAR-394: processPendingBatch 가 거래대상(신호 생산) 공시를 우선 선택하고, 부족분만
//   비거래로 채우며(전량 커버리지 보존), skipNonTrade 옵션이 비거래를 배제하는지 검증.

import { ParseStatus, DisclosureDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { DisclosureDocumentsService } from './disclosure-documents.service';

describe('DisclosureDocumentsService 거래대상 우선 fetch (DAR-394)', () => {
  /**
   * findMany 를 호출별로 라우팅하는 prisma 목.
   * - parseStatus PENDING + disclosure(OR keyword) → 거래대상 prefilter 호출
   * - parseStatus PENDING + rcpNo notIn → 비거래 fill 호출
   * - 그 외(FIFO) → fifoDocs
   */
  function build(opts: {
    tradeCandidates: { rcpNo: string; reportName: string }[];
    fillDocs: { rcpNo: string }[];
    fifoDocs?: { rcpNo: string }[];
  }) {
    const parsed: string[] = [];

    const findMany = jest.fn().mockImplementation((args: any) => {
      const where = args?.where ?? {};
      if (where.disclosure?.OR) {
        // 거래대상 prefilter — reportName 포함해 반환.
        return Promise.resolve(
          opts.tradeCandidates.map((c) => ({
            rcpNo: c.rcpNo,
            disclosure: { reportName: c.reportName },
          })),
        );
      }
      if (where.rcpNo?.notIn) {
        const excluded = new Set<string>(where.rcpNo.notIn);
        return Promise.resolve(
          opts.fillDocs.filter((d) => !excluded.has(d.rcpNo)),
        );
      }
      return Promise.resolve(opts.fifoDocs ?? []);
    });

    const prisma = {
      disclosureDocument: { findMany },
    } as unknown as PrismaService;

    const service = new DisclosureDocumentsService(
      prisma,
      {} as unknown as DartApiService,
    );

    // parseDisclosure 를 스텁 — 실제 fetch 없이 선택 순서만 검증(DONE 처리).
    jest
      .spyOn(
        service as unknown as {
          parseDisclosure: (rcpNo: string) => Promise<DisclosureDocument>;
        },
        'parseDisclosure',
      )
      .mockImplementation(async (rcpNo: string) => {
        parsed.push(rcpNo);
        return { rcpNo, parseStatus: ParseStatus.DONE } as DisclosureDocument;
      });

    return { service, parsed, findMany };
  }

  it('거래대상이 limit 을 채우면 비거래 fill 을 호출하지 않는다', async () => {
    const { service, parsed, findMany } = build({
      tradeCandidates: [
        { rcpNo: 'T1', reportName: '단일판매ㆍ공급계약체결' },
        { rcpNo: 'T2', reportName: '주요사항보고서(자기주식취득결정)' },
      ],
      fillDocs: [{ rcpNo: 'N1' }],
    });

    const res = await service.processPendingBatch(2);

    expect(res.tradeRelevant).toBe(2);
    expect(parsed.sort()).toEqual(['T1', 'T2']);
    // fill(notIn) 쿼리는 호출되지 않아야 한다(거래대상으로 limit 충족).
    const calledNotIn = findMany.mock.calls.some(
      (c) => c[0]?.where?.rcpNo?.notIn,
    );
    expect(calledNotIn).toBe(false);
  });

  it('거래대상 키워드 거짓양성은 정밀 분류로 떨어내고 거래대상만 우선한다', async () => {
    const { service, parsed } = build({
      tradeCandidates: [
        { rcpNo: 'T1', reportName: '단일판매ㆍ공급계약체결' }, // 진짜 거래대상
        { rcpNo: 'F1', reportName: '배당 관련 안내 정정(거짓양성)' }, // '배당' 키워드만, 룰 미매칭
      ],
      fillDocs: [{ rcpNo: 'N1' }, { rcpNo: 'N2' }],
    });

    const res = await service.processPendingBatch(3);

    // T1 만 거래대상 확정 → 나머지 2칸은 비거래 fill(N1,N2)로 채움.
    expect(res.tradeRelevant).toBe(1);
    expect(parsed).toContain('T1');
    expect(parsed).toContain('N1');
    expect(parsed).toContain('N2');
    expect(parsed).not.toContain('F1');
  });

  it('skipNonTrade=true 면 거래대상만 처리하고 비거래 fill 을 건너뛴다', async () => {
    const { service, parsed, findMany } = build({
      tradeCandidates: [{ rcpNo: 'T1', reportName: '현금ㆍ현물배당결정' }],
      fillDocs: [{ rcpNo: 'N1' }, { rcpNo: 'N2' }],
    });

    const res = await service.processPendingBatch(5, { skipNonTrade: true });

    expect(res.tradeRelevant).toBe(1);
    expect(parsed).toEqual(['T1']);
    const calledNotIn = findMany.mock.calls.some(
      (c) => c[0]?.where?.rcpNo?.notIn,
    );
    expect(calledNotIn).toBe(false);
  });

  it('prioritizeTradeRelevant=false 면 FIFO(enqueue 순)로 선택한다', async () => {
    const { service, parsed, findMany } = build({
      tradeCandidates: [{ rcpNo: 'T1', reportName: '단일판매ㆍ공급계약체결' }],
      fillDocs: [],
      fifoDocs: [{ rcpNo: 'A' }, { rcpNo: 'B' }],
    });

    const res = await service.processPendingBatch(2, {
      prioritizeTradeRelevant: false,
    });

    expect(res.tradeRelevant).toBe(0);
    expect(parsed.sort()).toEqual(['A', 'B']);
    // 거래대상 prefilter(OR) 쿼리는 호출되지 않아야 한다.
    const calledOr = findMany.mock.calls.some((c) => c[0]?.where?.disclosure?.OR);
    expect(calledOr).toBe(false);
  });
});
