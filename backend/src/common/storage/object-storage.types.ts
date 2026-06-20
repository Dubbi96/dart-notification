// backend/src/common/storage/object-storage.types.ts
// DAR-395: 객체 스토리지 추상화 — 대용량 콜드 원문(공시 rawText)을 로컬 DB 밖(S3/로컬 파일)으로
//          오프로드하기 위한 드라이버 비의존 인터페이스. 멀티이어 백필 시 DB 폭증을 막는다.
//
// 드라이버:
//   STORAGE_DRIVER=local → LocalObjectStorageService (개발/폴백)
//   STORAGE_DRIVER=s3    → S3ObjectStorageService    (AWS_*·S3_BUCKET 구성 시)
// ★자격증명·버킷 미설정 시 로컬로 graceful 폴백 → 기능 비차단(자격증명만 후속 주입).

/** put 옵션 — 압축/콘텐츠 타입. */
export interface PutObjectOptions {
  /** gzip 압축 저장 여부(콜드 원문 기본 true). 키는 '.gz' 로 끝나야 일관 해제된다. */
  compress?: boolean;
  /** MIME 타입(S3 메타데이터). 미지정 시 드라이버 기본. */
  contentType?: string;
}

/** 활성 드라이버 식별자(관측·진단용). */
export type ObjectStorageDriver = 'local' | 's3';

/**
 * 객체 스토리지 추상화.
 *
 * 키 규약: 논리 경로(예: 'disclosure-rawtext/{rcpNo}.txt.gz'). 드라이버가 내부적으로
 *   로컬 루트/ S3 prefix 를 덧붙인다. 호출자는 드라이버를 모른다.
 * 멱등: 동일 key put 은 덮어쓰기(재오프로드 무해).
 */
export abstract class ObjectStorageService {
  /** 활성 드라이버. */
  abstract readonly driver: ObjectStorageDriver;

  /**
   * 외부 스토리지(S3) 가 실제 구성되었는지.
   * local 드라이버는 항상 true. s3 드라이버는 버킷/자격증명/리전이 모두 갖춰졌을 때만 true.
   * 운영 진단(폴백 여부 표면화)에 쓴다.
   */
  abstract isConfigured(): boolean;

  /** 객체 저장(멱등 덮어쓰기). */
  abstract put(
    key: string,
    content: string,
    options?: PutObjectOptions,
  ): Promise<void>;

  /** 객체 조회. 키가 '.gz' 면 자동 해제하여 UTF-8 문자열 반환. */
  abstract get(key: string): Promise<string>;

  /** 객체 존재 여부. */
  abstract exists(key: string): Promise<boolean>;

  /** 객체 삭제(없어도 예외 없이 무시). */
  abstract delete(key: string): Promise<void>;
}
