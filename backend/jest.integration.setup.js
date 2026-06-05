// 통합테스트 setup — .env에서 DATABASE_URL 로드 (PrismaClient가 읽는다).
// 단위테스트에는 영향 없음(jest.config.js는 이 setup을 쓰지 않음).
require('dotenv').config();

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL이 설정되지 않았습니다. 통합테스트는 실 dev Postgres가 필요합니다 (backend/.env).',
  );
}
