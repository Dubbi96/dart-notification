/** @type {import('ts-jest').JestConfigWithTsJest} */
// 통합테스트 전용 설정 — 실 dev Postgres에 연결해 Prisma 어댑터 save→find 왕복 검증.
// 단위(jest.config.js)와 분리: testRegex가 *.integration-spec.ts만 매칭.
// 격리: 각 테스트는 인터랙티브 트랜잭션 내부에서 실행 후 롤백 → 잔여 row 0, 데모DB 무변경.
// 실행: `npm run test:integration` (DATABASE_URL 필요; .env는 setup에서 로드).
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.integration-spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.json', isolatedModules: true },
    ],
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../jest.integration.setup.js'],
  testTimeout: 30000,
};
