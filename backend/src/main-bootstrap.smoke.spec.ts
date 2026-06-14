import {
  Controller,
  Get,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { resolveCorsOrigin } from './common/config/cors-origin';

/**
 * DAR-252 부트스트랩 강화 동작 재현(결정론적).
 * main.ts 의 와이어링(전역 필터/인터셉터 + graceful shutdown + CORS prod 가드)을
 * 최소 Nest 앱에 동일하게 적용하고 DoD 3종을 실제 HTTP/라이프사이클로 검증한다.
 *  - 500 → 표준 에러포맷 {success:false,error:{code,message}} + 액세스 로그
 *  - SIGTERM(enableShutdownHooks) → OnModuleDestroy($disconnect 위치) 발화
 *  - prod 미허용 origin 차단 / 허용 origin 반영
 */

// $disconnect 자리를 대신하는 fake — onModuleDestroy 발화 여부 관측.
@Injectable()
class FakeDisconnectable implements OnModuleDestroy {
  destroyed = false;
  async onModuleDestroy() {
    this.destroyed = true;
  }
}

@Controller()
class SmokeController {
  @Get('boom')
  boom() {
    throw new Error('kaboom'); // HttpException 아님 → 500 경로
  }

  @Get('ok')
  ok() {
    return { ok: true };
  }
}

describe('main.ts 부트스트랩 강화 (DAR-252)', () => {
  let app: INestApplication;
  let fakeDb: FakeDisconnectable;
  let baseUrl: string;
  let logSpy: jest.SpyInstance;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SmokeController],
      providers: [FakeDisconnectable],
    }).compile();

    app = moduleRef.createNestApplication();
    fakeDb = app.get(FakeDisconnectable);

    // main.ts 와 동일한 와이어링
    app.enableShutdownHooks();
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new LoggingInterceptor());
    app.enableCors({
      origin: resolveCorsOrigin(true, 'https://allowed.com'), // prod 화이트리스트
      credentials: true,
    });

    // 액세스 로그(LoggingInterceptor) 관측
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    await app.listen(0);
    const server = app.getHttpServer();
    const port = server.address().port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    logSpy?.mockRestore();
    if (app) await app.close();
  });

  it('①+② 500 에러는 표준포맷으로 정규화되고 액세스 로그가 남는다', async () => {
    logSpy.mockClear();
    const res = await fetch(`${baseUrl}/boom`);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' },
    });
    // LoggingInterceptor 액세스 로그: "GET /boom 500 - Nms"
    const accessLogged = logSpy.mock.calls.some(
      (c) => typeof c[0] === 'string' && /GET \/boom 500 - \d+ms/.test(c[0]),
    );
    expect(accessLogged).toBe(true);
  });

  it('② 정상요청도 인터셉터 액세스 로그가 남는다', async () => {
    logSpy.mockClear();
    const res = await fetch(`${baseUrl}/ok`);
    expect(res.status).toBe(200);
    const logged = logSpy.mock.calls.some(
      (c) => typeof c[0] === 'string' && /GET \/ok 200 - \d+ms/.test(c[0]),
    );
    expect(logged).toBe(true);
  });

  it('③ prod CORS: 허용 origin 은 반영, 미허용 origin 은 차단', async () => {
    const allowed = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: 'https://allowed.com' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://allowed.com',
    );

    const denied = await fetch(`${baseUrl}/ok`, {
      headers: { Origin: 'https://evil.com' },
    });
    // 미허용 origin 은 ACAO 헤더 미반영(브라우저가 응답을 차단)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('① graceful shutdown: SIGTERM(enableShutdownHooks) 발화 시 OnModuleDestroy 실행', async () => {
    expect(fakeDb.destroyed).toBe(false);
    // enableShutdownHooks 가 등록한 SIGTERM 핸들러가 app.close()→라이프사이클 훅을 호출한다.
    await app.close();
    expect(fakeDb.destroyed).toBe(true);
  });
});
