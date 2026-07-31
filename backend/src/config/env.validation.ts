import * as Joi from 'joi';

/**
 * 환경변수 검증 스키마 (DAR-253).
 *
 * 기존 ConfigModule.forRoot 에는 validate/validationSchema 가 없어 필수 env 누락·오타가
 * 부팅을 차단하지 못했다(fail-late). JWT_SECRET 미설정 시 약한 서명/첫 요청 실패,
 * DATABASE_URL 오타는 첫 쿼리까지 지연 폭발 — 헬스체크는 통과하나 실트래픽에서 깨지는 부분가동.
 *
 * 이 스키마를 ConfigModule 에 연결해 부팅 시점에 fail-fast 로 검증한다.
 * - required(): 누락 시 부팅 즉시 실패시킬 boot-critical 비밀/연결정보.
 * - default(): 코드가 이미 폴백을 갖고 있어 누락은 허용하되, 설정 시 타입/형식을 검증.
 *
 * validationOptions.abortEarly:false 와 함께 사용해 누락된 모든 필수 env 를 한 번에 보고한다.
 */
export const envValidationSchema = Joi.object({
  // ── Boot-critical: 누락 시 부팅 차단 ──────────────────────────────
  // DB 연결 — 오타/누락 시 첫 쿼리까지 지연 폭발하므로 부팅에서 차단.
  DATABASE_URL: Joi.string().required(),
  // JWT 서명 비밀 — 미설정 시 약한 서명/검증 실패. 약한 시크릿 방지 위해 최소 길이 강제.
  JWT_SECRET: Joi.string().min(16).required(),
  JWT_REFRESH_SECRET: Joi.string().min(16).required(),
  // 핵심 외부 데이터/연동 키 — 없으면 핵심 기능(수집·AI·로그인)이 침묵 실패.
  DART_API_KEY: Joi.string().required(),
  LLM_API_KEY: Joi.string().required(),
  KAKAO_REST_API_KEY: Joi.string().required(),

  // ── 선택/기본값 보유: 설정 시 타입·형식만 검증 ──────────────────────
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),

  // Redis / BullMQ — 코드 기본값(localhost:6379) 보존.
  REDIS_HOST: Joi.string().default('localhost'),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),

  // JWT 만료(초)
  JWT_ACCESS_EXPIRATION: Joi.number().positive().default(900),
  JWT_REFRESH_EXPIRATION: Joi.number().positive().default(604800),

  // LLM (Engine2) — 키 외 베이스/모델은 OpenAI 기본값.
  LLM_BASE_URL: Joi.string().uri().default('https://api.openai.com/v1'),
  LLM_MODEL: Joi.string().default('gpt-4o-mini'),

  // KRX (Engine3 시세) — 키는 조건부 할당(DAR-8), 베이스 URL 기본값 보유.
  KRX_API_KEY: Joi.string().allow('').optional(),
  KRX_BASE_URL: Joi.string().uri().default('http://data-dbg.krx.co.kr/svc/apis'),

  // Kakao — CLIENT_SECRET 은 사용 시에만(미사용 빈 값 허용).
  KAKAO_CLIENT_SECRET: Joi.string().allow('').optional(),

  // 기타 선택
  EXPO_PUSH_ACCESS_TOKEN: Joi.string().allow('').optional(),
  API_BASE_URL: Joi.string().uri().default('http://localhost:3000/api'),
  STORAGE_DRIVER: Joi.string().valid('local', 's3').default('local'),
  LOCAL_STORAGE_PATH: Joi.string().default('./storage'),
  // DAR-395: 객체 스토리지(공시 원문 오프로드). 로컬 객체 루트는 LOCAL_STORAGE_PATH/objects 기본.
  OBJECT_STORAGE_LOCAL_PATH: Joi.string().optional(),
  // S3(또는 호환) — STORAGE_DRIVER=s3 시 사용. 미설정이면 로컬 폴백(graceful·비차단).
  // 자격증명 미지정 시 SDK 기본 자격증명 체인(IAM 역할 등) 사용.
  AWS_REGION: Joi.string().allow('').optional(),
  AWS_ACCESS_KEY_ID: Joi.string().allow('').optional(),
  AWS_SECRET_ACCESS_KEY: Joi.string().allow('').optional(),
  S3_BUCKET: Joi.string().allow('').optional(),
  S3_ENDPOINT: Joi.string().allow('').optional(),
  S3_PREFIX: Joi.string().allow('').optional(),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').optional(),

  // AOS A3-2: 기존 TradingSignal 입력을 append-only FeatureSnapshot으로 함께 기록.
  // reconciliation 전까지 기본 OFF이며, 실패는 legacy 신호 경로와 격리한다.
  AOS_FEATURE_SNAPSHOT_DUAL_WRITE_ENABLED: Joi.string().valid('true', 'false').default('false'),
});

/**
 * ConfigModule.forRoot 의 validationOptions.
 * - abortEarly:false → 누락된 필수 env 를 한 번에 모두 보고(하나씩 고치는 왕복 제거).
 * - allowUnknown:true → 스키마에 선언하지 않은 env(KIS_*, PAPER_SIM_*, TZ 등) 통과.
 */
export const envValidationOptions = {
  abortEarly: false,
  allowUnknown: true,
};
