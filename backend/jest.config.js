/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  // 통합테스트(*.integration-spec.ts, 실 Postgres)는 단위 `npm test`에서 제외.
  // 별도 실행: `npm run test:integration` (jest.integration.config.js).
  testPathIgnorePatterns: ['/node_modules/', '\\.integration-spec\\.ts$'],
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { tsconfig: '<rootDir>/../tsconfig.json', isolatedModules: true },
    ],
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
};
