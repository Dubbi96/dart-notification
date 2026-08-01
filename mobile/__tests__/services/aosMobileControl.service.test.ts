import { api } from '@services/api';
import { aosMobileControlService } from '@services/aosMobileControl.service';

jest.mock('@services/api', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

const mockedApi = api as jest.Mocked<typeof api>;

describe('aosMobileControlService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('운영자 bootstrap을 기존 인증 세션으로 조회한다', async () => {
    mockedApi.get.mockResolvedValueOnce({ data: { success: true, data: { mode: 'READ_ONLY' } } });

    await expect(aosMobileControlService.getBootstrap()).resolves.toEqual({ mode: 'READ_ONLY' });
    expect(mockedApi.get).toHaveBeenCalledWith('/aos/operator/bootstrap');
  });

  it('1회용 emergency step-up 뒤 신규 진입 FULL_HALT만 발동한다', async () => {
    mockedApi.post
      .mockResolvedValueOnce({ data: { success: true, data: { token: 'one-use-token' } } })
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 'event-1', receiptHash: 'receipt-hash' } },
      });

    const result = await aosMobileControlService.activateNewEntryHalt({
      password: 'password-123',
      reason: '가격 수집 장애 확인',
      correlationId: 'mobile-kill:test-1',
    });

    expect(result).toMatchObject({ id: 'event-1', receiptHash: 'receipt-hash' });
    expect(mockedApi.post).toHaveBeenNthCalledWith(1, '/aos/operator/auth/step-up', {
      password: 'password-123',
      scope: 'EMERGENCY_CONTROL',
    });
    expect(mockedApi.post).toHaveBeenNthCalledWith(
      2,
      '/aos/operator/emergency/kill-switch',
      {
        command: 'ACTIVATE',
        scope: 'NEW_ENTRY',
        mode: 'FULL_HALT',
        reason: '가격 수집 장애 확인',
        correlationId: 'mobile-kill:test-1',
      },
      { headers: { 'x-aos-step-up-token': 'one-use-token' } },
    );
  });

  it('step-up 실패 시 Kill Switch 명령을 보내지 않는다', async () => {
    mockedApi.post.mockRejectedValueOnce(new Error('step-up rejected'));

    await expect(
      aosMobileControlService.activateNewEntryHalt({
        password: 'wrong-password',
        reason: '위험 신호 확인',
        correlationId: 'mobile-kill:test-2',
      }),
    ).rejects.toThrow('step-up rejected');
    expect(mockedApi.post).toHaveBeenCalledTimes(1);
  });
});
