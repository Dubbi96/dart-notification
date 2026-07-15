import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { WebSurfaceController } from './web-surface.controller';
import { WebSurfaceService } from './web-surface.service';

describe('WebSurfaceController', () => {
  const getSharePage = jest.fn();
  const getLandingHtml = jest.fn();

  let controller: WebSurfaceController;

  /** passthrough @Res 대역 — status/setHeader 호출 기록 */
  function createResMock() {
    const headers: Record<string, string> = {};
    let statusCode = HttpStatus.OK;
    const res = {
      status: jest.fn((code: number) => {
        statusCode = code;
        return res;
      }),
      setHeader: jest.fn((name: string, value: string) => {
        headers[name] = value;
        return res;
      }),
    } as unknown as Response;
    return { res, headers, getStatus: () => statusCode };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [WebSurfaceController],
      providers: [
        { provide: WebSurfaceService, useValue: { getSharePage, getLandingHtml } },
      ],
    }).compile();
    controller = moduleRef.get(WebSurfaceController);
  });

  it('존재하는 공시 — 200 + text/html + 장기 캐시 헤더', async () => {
    getSharePage.mockResolvedValue({ found: true, html: '<html>ok</html>' });
    const { res, headers, getStatus } = createResMock();

    const body = await controller.getSharePage('20260714000123', res);

    expect(body).toBe('<html>ok</html>');
    expect(getStatus()).toBe(HttpStatus.OK);
    expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(headers['Cache-Control']).toBe('public, max-age=86400');
  });

  it('존재하지 않는 공시 — 404 + no-store (404 페이지 캐시 금지)', async () => {
    getSharePage.mockResolvedValue({ found: false, html: '<html>404</html>' });
    const { res, headers, getStatus } = createResMock();

    const body = await controller.getSharePage('20269999999999', res);

    expect(body).toBe('<html>404</html>');
    expect(getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(headers['Content-Type']).toBe('text/html; charset=utf-8');
    expect(headers['Cache-Control']).toBe('no-store');
  });

  it('랜딩 — 서비스가 만든 HTML을 그대로 반환한다', () => {
    getLandingHtml.mockReturnValue('<html>landing</html>');

    expect(controller.getLanding()).toBe('<html>landing</html>');
    expect(getLandingHtml).toHaveBeenCalledTimes(1);
  });
});
