/**
 * 모바일 유닛 테스트 설정 (갭분석 W15 ①) — jest-expo(Expo SDK 56 매칭) + RNTL.
 *
 * - 대상: stores/utils 순수 로직 + 소수의 컴포넌트 렌더 스모크(__tests__/).
 * - 경로 alias(@stores/@utils/@components 등)는 babel.config.js 의
 *   babel-plugin-module-resolver 가 transform 시점에 해소한다(별도 moduleNameMapper 불요).
 * - 테스트 파일은 tsc 본선(tsconfig.json)에서 제외되고 tsconfig.test.json 이 담당한다.
 */
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts', '<rootDir>/__tests__/**/*.test.tsx'],
  // RN/Expo 생태계는 ESM 원본으로 배포되는 패키지가 많아 변환 허용 목록이 필요하다
  // (jest-expo 공식 권장 패턴 + 이 프로젝트가 실제 사용하는 패키지 가산).
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)/|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|react-native-paper|phosphor-react-native|zustand)',
  ],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  clearMocks: true,
};
