import { DartStockStatusService } from './dart-stock-status.service';
import { PrismaService } from '../../prisma/prisma.service';

/** disclosureEvent.findMany 가 반환하는 형태의 행 */
function ev(
  eventType: string,
  reportName: string,
  rcpDt: string,
  rcpNo = `${rcpDt}0001`,
  corpCode = 'A000040',
) {
  return { corpCode, rcpNo, eventType, disclosure: { reportName, rcpDt } };
}

function makePrisma(rows: ReturnType<typeof ev>[]): jest.Mocked<PrismaService> {
  return {
    disclosureEvent: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  } as unknown as jest.Mocked<PrismaService>;
}

describe('DartStockStatusService.deriveStatus', () => {
  it('TRADING_SUSPENSION 공시 → 거래정지(isHalted) true', async () => {
    const prisma = makePrisma([ev('TRADING_SUSPENSION', '매매거래정지', '20260601')]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isHalted).toBe(true);
    expect(status.isManagement).toBe(false);
    expect(status.statusNote).toContain('거래정지');
    expect(status.sourceRcpNo).toBe('202606010001');
  });

  it('DELISTING_RISK 공시(관리종목 지정) → 관리종목(isManagement) true', async () => {
    const prisma = makePrisma([ev('DELISTING_RISK', '관리종목 지정', '20260601')]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isManagement).toBe(true);
    expect(status.isHalted).toBe(false);
    expect(status.statusNote).toContain('관리종목');
  });

  it('AUDIT_OPINION_RISK 공시(감사의견 거절) → 관리종목 true', async () => {
    const prisma = makePrisma([ev('AUDIT_OPINION_RISK', '감사보고서(감사의견 거절)', '20260315')]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isManagement).toBe(true);
  });

  it('지정 후 더 최근 "해제" 공시가 있으면 상태 해소(false)', async () => {
    const prisma = makePrisma([
      ev('DELISTING_RISK', '관리종목 지정', '20260101'),
      ev('DELISTING_RISK', '관리종목 지정 해제', '20260601'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isManagement).toBe(false);
    expect(status.statusNote).toBeNull();
  });

  it('해제 후 더 최근 "재지정" 공시가 있으면 다시 지정(true)', async () => {
    const prisma = makePrisma([
      ev('DELISTING_RISK', '관리종목 지정 해제', '20260101'),
      ev('DELISTING_RISK', '관리종목 지정', '20260601'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isManagement).toBe(true);
  });

  it('거래정지 + 관리종목 동시 활성 — 둘 다 true, 사유 결합', async () => {
    const prisma = makePrisma([
      ev('TRADING_SUSPENSION', '매매거래정지', '20260601'),
      ev('DELISTING_RISK', '관리종목 지정', '20260520'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isHalted).toBe(true);
    expect(status.isManagement).toBe(true);
    expect(status.statusNote).toContain('관리종목');
    expect(status.statusNote).toContain('거래정지');
    // 대표 근거 공시는 더 최근 공시(거래정지, 20260601)
    expect(status.sourceRcpDt).toBe('20260601');
  });

  it('거래재개("재개") 공시가 최신이면 거래정지 해소', async () => {
    const prisma = makePrisma([
      ev('TRADING_SUSPENSION', '매매거래정지', '20260101'),
      ev('TRADING_SUSPENSION', '매매거래 정지 후 거래재개', '20260201'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isHalted).toBe(false);
  });

  it('상태 이벤트 없음 → 모두 false', async () => {
    const prisma = makePrisma([]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status).toEqual({
      isManagement: false,
      isHalted: false,
      statusNote: null,
      sourceRcpNo: null,
      sourceRcpDt: null,
    });
  });

  it('corpCode 빈 문자열 → 조회 없이 false', async () => {
    const prisma = makePrisma([]);
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('');

    expect(status.isManagement).toBe(false);
    expect(prisma.disclosureEvent.findMany).not.toHaveBeenCalled();
  });

  it('상태 이벤트 타입만 조회한다(WHERE eventType in 3종)', async () => {
    const prisma = makePrisma([]);
    const svc = new DartStockStatusService(prisma);

    await svc.deriveStatus('A000040');

    expect(prisma.disclosureEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          corpCode: 'A000040',
          eventType: { in: ['TRADING_SUSPENSION', 'DELISTING_RISK', 'AUDIT_OPINION_RISK'] },
        },
      }),
    );
  });

  it('조회 예외 시 graceful — 모두 false', async () => {
    const prisma = {
      disclosureEvent: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
    } as unknown as jest.Mocked<PrismaService>;
    const svc = new DartStockStatusService(prisma);

    const status = await svc.deriveStatus('A000040');

    expect(status.isManagement).toBe(false);
    expect(status.isHalted).toBe(false);
  });
});

describe('DartStockStatusService.isManagementStock', () => {
  it('관리종목이면 true', async () => {
    const prisma = makePrisma([ev('DELISTING_RISK', '관리종목 지정', '20260601')]);
    const svc = new DartStockStatusService(prisma);
    expect(await svc.isManagementStock('A000040')).toBe(true);
  });

  it('정상 종목이면 false', async () => {
    const prisma = makePrisma([]);
    const svc = new DartStockStatusService(prisma);
    expect(await svc.isManagementStock('A000040')).toBe(false);
  });
});

describe('DartStockStatusService.deriveAllStatuses', () => {
  it('기업별로 상태를 그룹화해 반환한다', async () => {
    const prisma = makePrisma([
      ev('DELISTING_RISK', '관리종목 지정', '20260601', '202606010001', 'A000040'),
      ev('TRADING_SUSPENSION', '매매거래정지', '20260601', '202606010002', 'A111111'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const map = await svc.deriveAllStatuses();

    expect(map.size).toBe(2);
    expect(map.get('A000040')?.isManagement).toBe(true);
    expect(map.get('A111111')?.isHalted).toBe(true);
  });

  it('해제가 최신인 기업은 false 로 환원(맵에는 포함되나 플래그 false)', async () => {
    const prisma = makePrisma([
      ev('DELISTING_RISK', '관리종목 지정', '20260101', '202601010001', 'A000040'),
      ev('DELISTING_RISK', '관리종목 지정 해제', '20260601', '202606010001', 'A000040'),
    ]);
    const svc = new DartStockStatusService(prisma);

    const map = await svc.deriveAllStatuses();

    expect(map.get('A000040')?.isManagement).toBe(false);
  });
});
