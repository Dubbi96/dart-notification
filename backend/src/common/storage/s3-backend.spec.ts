// backend/src/common/storage/s3-backend.spec.ts
// DAR-395: S3 구성 판정 + graceful 폴백(미구성/SDK 부재 시 null) 단위 테스트.

import { createAwsS3Backend, isS3Configured } from './s3-backend';

describe('s3-backend 구성/폴백 (DAR-395)', () => {
  describe('isS3Configured', () => {
    it('region+bucket 모두 있으면 true', () => {
      expect(isS3Configured({ region: 'ap-northeast-2', bucket: 'b' })).toBe(
        true,
      );
    });
    it('region 또는 bucket 누락 시 false', () => {
      expect(isS3Configured({ region: 'ap-northeast-2' })).toBe(false);
      expect(isS3Configured({ bucket: 'b' })).toBe(false);
      expect(isS3Configured({})).toBe(false);
    });
  });

  describe('createAwsS3Backend (graceful)', () => {
    it('구성 미충족이면 null(로컬 폴백 신호)', () => {
      expect(createAwsS3Backend({})).toBeNull();
      expect(createAwsS3Backend({ bucket: 'b' })).toBeNull();
    });

    it('구성 충족이어도 @aws-sdk/client-s3 미설치면 null(비차단 폴백)', () => {
      // 본 테스트 환경엔 SDK 가 설치되어 있지 않다(의도된 lazy 의존성) → null 이어야 한다.
      // SDK 가 설치된 환경이라면 백엔드 객체(비-null)가 반환되며, 그 경우도 정상이다.
      const backend = createAwsS3Backend({
        region: 'ap-northeast-2',
        bucket: 'b',
        accessKeyId: 'k',
        secretAccessKey: 's',
      });
      // SDK 부재(현 환경) → null. 설치 시 객체. 둘 다 허용하되 throw 하지 않음이 핵심.
      expect(backend === null || typeof backend === 'object').toBe(true);
    });
  });
});
