import { envValidationSchema, envValidationOptions } from './env.validation';

/**
 * DAR-253 — 필수 env 검증 스키마 fail-fast 단위 검증.
 *
 * ConfigModule.forRoot 는 이 스키마를 부팅 시점에 적용하므로, 스키마가
 * required env 누락을 거부하고(부팅 차단) 정상 env 를 통과시키는지(부팅 통과)를
 * 스키마 단위로 결정론적으로 검증한다.
 */
describe('envValidationSchema (DAR-253)', () => {
  // 부팅을 통과해야 하는 최소 정상 env.
  const validEnv = {
    DATABASE_URL: 'postgresql://postgres:password@localhost:5432/dart_notification?schema=public',
    JWT_SECRET: 'a-sufficiently-long-jwt-secret',
    JWT_REFRESH_SECRET: 'a-sufficiently-long-refresh-secret',
    DART_API_KEY: 'dart-key',
    LLM_API_KEY: 'llm-key',
    KAKAO_REST_API_KEY: 'kakao-key',
  };

  const REQUIRED_KEYS = [
    'DATABASE_URL',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
    'DART_API_KEY',
    'LLM_API_KEY',
    'KAKAO_REST_API_KEY',
  ];

  it('정상 env 는 통과한다(부팅 통과)', () => {
    const { error } = envValidationSchema.validate(validEnv, envValidationOptions);
    expect(error).toBeUndefined();
  });

  it.each(REQUIRED_KEYS)('필수 env %s 누락 시 검증 실패(부팅 차단)', (missingKey) => {
    const env: Record<string, string> = { ...validEnv };
    delete env[missingKey];

    const { error } = envValidationSchema.validate(env, envValidationOptions);

    expect(error).toBeDefined();
    // 명확한 에러: 어느 키가 required 인지 메시지에 드러난다.
    expect(error?.message).toContain(missingKey);
  });

  it('abortEarly:false → 여러 필수 env 누락을 한 번에 모두 보고한다', () => {
    const env = { ...validEnv };
    delete (env as Record<string, string>).DATABASE_URL;
    delete (env as Record<string, string>).JWT_SECRET;
    delete (env as Record<string, string>).LLM_API_KEY;

    const { error } = envValidationSchema.validate(env, envValidationOptions);

    expect(error).toBeDefined();
    // 3건 모두 details 에 누적되어야 한다(왕복 없이 한 번에 수정 가능).
    expect(error?.details).toHaveLength(3);
  });

  it('약한 JWT_SECRET(짧은 길이)은 거부한다', () => {
    const env = { ...validEnv, JWT_SECRET: 'short' };
    const { error } = envValidationSchema.validate(env, envValidationOptions);
    expect(error).toBeDefined();
    expect(error?.message).toContain('JWT_SECRET');
  });

  it('선택 env 는 누락해도 통과하고 기본값이 채워진다', () => {
    const { error, value } = envValidationSchema.validate(validEnv, envValidationOptions);
    expect(error).toBeUndefined();
    // 코드 폴백과 동일한 기본값이 검증 결과에 주입된다.
    expect(value.REDIS_HOST).toBe('localhost');
    expect(value.REDIS_PORT).toBe(6379);
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.STORAGE_DRIVER).toBe('local');
    expect(value.AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED).toBe('false');
    expect(value.AOS_DECISION_DUAL_WRITE_ENABLED).toBe('false');
    expect(value.AOS_CANONICAL_PAPER_LEDGER_ENABLED).toBe('false');
    expect(value.AOS_OPERATOR_MUTATIONS_ENABLED).toBe('false');
    expect(value.AOS_OPERATOR_BOOTSTRAP_EMAILS).toBe('');
  });

  it('allowUnknown → 스키마 미선언 env(KIS_*/PAPER_SIM_* 등)는 통과시킨다', () => {
    const env = {
      ...validEnv,
      KIS_APP_KEY: 'x',
      PAPER_SIM_REAL_FEED: 'true',
      TZ: 'Asia/Seoul',
    };
    const { error } = envValidationSchema.validate(env, envValidationOptions);
    expect(error).toBeUndefined();
  });

  it('잘못된 형식(비-숫자 PORT)은 거부한다', () => {
    const env = { ...validEnv, PORT: 'not-a-number' };
    const { error } = envValidationSchema.validate(env, envValidationOptions);
    expect(error).toBeDefined();
    expect(error?.message).toContain('PORT');
  });

  it('FeatureSnapshot dual-write 플래그는 명시적 true/false만 허용한다', () => {
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED: 'true' },
        envValidationOptions,
      ).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED: '1' },
        envValidationOptions,
      ).error?.message,
    ).toContain('AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED');
  });

  it('SignalDecision dual-write 플래그는 명시적 true/false만 허용한다', () => {
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_DECISION_DUAL_WRITE_ENABLED: 'true' },
        envValidationOptions,
      ).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_DECISION_DUAL_WRITE_ENABLED: 'yes' },
        envValidationOptions,
      ).error?.message,
    ).toContain('AOS_DECISION_DUAL_WRITE_ENABLED');
  });

  it('canonical Paper 원장 플래그는 명시적 true/false만 허용한다', () => {
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_CANONICAL_PAPER_LEDGER_ENABLED: 'true' },
        envValidationOptions,
      ).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_CANONICAL_PAPER_LEDGER_ENABLED: 'on' },
        envValidationOptions,
      ).error?.message,
    ).toContain('AOS_CANONICAL_PAPER_LEDGER_ENABLED');
  });

  it('Operator mutation은 기본 OFF이며 명시적 true/false만 허용한다', () => {
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_OPERATOR_MUTATIONS_ENABLED: 'true' },
        envValidationOptions,
      ).error,
    ).toBeUndefined();
    expect(
      envValidationSchema.validate(
        { ...validEnv, AOS_OPERATOR_MUTATIONS_ENABLED: 'enabled' },
        envValidationOptions,
      ).error?.message,
    ).toContain('AOS_OPERATOR_MUTATIONS_ENABLED');
  });
});
