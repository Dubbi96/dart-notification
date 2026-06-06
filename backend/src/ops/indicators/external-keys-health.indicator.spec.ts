import { ConfigService } from '@nestjs/config';
import { ExternalKeysHealthIndicator } from './external-keys-health.indicator';

describe('ExternalKeysHealthIndicator (DAR-111)', () => {
  function makeIndicator(env: Record<string, string | undefined>) {
    const config = {
      get: <T>(k: string): T => env[k] as unknown as T,
    } as unknown as ConfigService;
    return new ExternalKeysHealthIndicator(config);
  }

  it('키가 모두 구성되면 up + 각 키 configured=true', async () => {
    const indicator = makeIndicator({
      DART_API_KEY: 'abcdef0123456789',
      KRX_API_KEY: 'krx-key-12345678',
      LLM_API_KEY: 'sk-llm-1234567890',
    });
    const result = await indicator.isHealthy('externalKeys');
    expect(result.externalKeys.status).toBe('up');
    expect(result.externalKeys.dart).toBe(true);
    expect(result.externalKeys.krx).toBe(true);
    expect(result.externalKeys.llm).toBe(true);
  });

  it('키가 없어도 throw 하지 않고 up + configured=false(graceful, 실호출 0)', async () => {
    const indicator = makeIndicator({});
    const result = await indicator.isHealthy('externalKeys');
    expect(result.externalKeys.status).toBe('up'); // 키 부재는 실패가 아님
    expect(result.externalKeys.dart).toBe(false);
    expect(result.externalKeys.krx).toBe(false);
    expect(result.externalKeys.llm).toBe(false);
  });

  it('짧거나 플레이스홀더 키는 형식 불충족으로 false', async () => {
    const indicator = makeIndicator({
      DART_API_KEY: 'short',
      KRX_API_KEY: 'your-key-here',
      LLM_API_KEY: '   ',
    });
    const result = await indicator.isHealthy('externalKeys');
    expect(result.externalKeys.dart).toBe(false);
    expect(result.externalKeys.krx).toBe(false);
    expect(result.externalKeys.llm).toBe(false);
  });
});
