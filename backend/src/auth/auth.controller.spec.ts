import { AuthController } from './auth.controller';

/**
 * DAR-443: 카카오 콜백 자동 복귀 실패 회귀 방지.
 *
 * 인앱 브라우저(ASWebAuthenticationSession/Chrome Custom Tabs)는 사용자 제스처
 * 없는 custom-scheme 자동 이동(HTML interstitial + setTimeout)을 차단한다.
 * 콜백은 HTML 응답 대신 HTTP 302 redirect(Location=deepLink)로 전환해야
 * openAuthSessionAsync 가 OS 레벨에서 네비게이션을 가로채 브라우저를 자동 종료한다.
 *
 * 실 Postgres/네트워크 없이 AuthService 와 express Response 를 가짜로 두고
 * 콜백이 res.send(HTML) 가 아니라 res.redirect(deepLink) 를 호출하는지 단정한다.
 */

function createFakeRes() {
  const res: any = {
    redirectedTo: null as string | null,
    sentBody: null as string | null,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    redirect(url: string) {
      this.redirectedTo = url;
      return this;
    },
    send(body: string) {
      this.sentBody = body;
      return this;
    },
  };
  return res;
}

const API_BASE = 'https://api.example.com/api';

function createController(opts?: { kakaoLoginImpl?: jest.Mock }) {
  const kakaoLogin =
    opts?.kakaoLoginImpl ??
    jest.fn().mockResolvedValue({
      accessToken: 'acc',
      refreshToken: 'ref',
      user: { id: 'u1', email: 'a@b.com' },
    });
  const storeAuthResult = jest.fn();
  const fakeService: any = {
    getApiBaseUrl: jest.fn().mockReturnValue(API_BASE),
    kakaoLogin,
    storeAuthResult,
    getAuthResult: jest.fn(),
  };
  const controller = new AuthController(fakeService);
  // 에러 경로 로그가 테스트 출력을 오염시키지 않도록 억제
  jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
  return { controller, fakeService, kakaoLogin, storeAuthResult };
}

describe('AuthController.kakaoCallback (DAR-443)', () => {
  it('성공 시 HTML 이 아니라 302 redirect 로 deepLink(state 포함)을 보낸다', async () => {
    const { controller, storeAuthResult } = createController();
    const res = createFakeRes();
    const returnUrl = 'gongsion://kakao';
    const state = `nonce123~${encodeURIComponent(returnUrl)}`;

    await controller.kakaoCallback('valid-code', state, res);

    // HTML interstitial 을 보내지 않는다 (자동 복귀 차단의 근본 원인 제거)
    expect(res.sentBody).toBeNull();
    // 302 redirect Location = deepLink
    expect(res.redirectedTo).toBe(
      `gongsion://kakao?state=${encodeURIComponent(state)}`,
    );
    // 결과는 state 키로 임시 저장돼 result polling 으로 조회 가능해야 한다
    expect(storeAuthResult).toHaveBeenCalledWith(state, expect.any(Object));
  });

  it('returnUrl 에 기존 쿼리가 있으면 & 로 state 를 이어붙인다', async () => {
    const { controller } = createController();
    const res = createFakeRes();
    const returnUrl = 'exp://127.0.0.1:8081/--/kakao?foo=bar';
    const state = `nonce456~${encodeURIComponent(returnUrl)}`;

    await controller.kakaoCallback('valid-code', state, res);

    expect(res.redirectedTo).toBe(
      `${returnUrl}&state=${encodeURIComponent(state)}`,
    );
  });

  it('에러(redirect_uri mismatch 등) 케이스도 302 로 returnUrl?error= 사유를 전달한다', async () => {
    const kakaoLoginImpl = jest
      .fn()
      .mockRejectedValue(new Error('redirect_uri mismatch'));
    const { controller } = createController({ kakaoLoginImpl });
    const res = createFakeRes();
    const returnUrl = 'gongsion://kakao';
    const state = `nonce789~${encodeURIComponent(returnUrl)}`;

    await controller.kakaoCallback('bad-code', state, res);

    expect(res.sentBody).toBeNull();
    expect(res.redirectedTo).toBe(
      `gongsion://kakao?error=${encodeURIComponent('redirect_uri mismatch')}`,
    );
  });

  it('state 에 returnUrl 이 없으면 custom-scheme 폴백으로 302 redirect 한다', async () => {
    const { controller } = createController();
    const res = createFakeRes();
    const state = 'bare-nonce-without-return-url';

    await controller.kakaoCallback('valid-code', state, res);

    expect(res.redirectedTo).toBe(
      `gongsion://kakao?state=${encodeURIComponent(state)}`,
    );
  });
});
