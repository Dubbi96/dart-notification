// backend/src/storage-ops/storage-ops.types.ts
// DAR-397: 저장소 계층화 운영(용량 모니터링·디스크 회수·로컬 정리·콜드 라이프사이클) 타입 SSOT.

/** 단일 테이블 용량(테이블+인덱스+TOAST 총합). */
export interface TableSize {
  /** 물리 테이블명(snake_case @@map). */
  table: string;
  /** pg_total_relation_size 바이트. */
  totalBytes: number;
  /** 사람이 읽는 크기(예: '1.7 GB'). */
  totalPretty: string;
}

/** rawText 오프로드 진행(DB 경량화 진척). */
export interface RawTextOffloadSnapshot {
  /** rawText 컬럼이 남은(미오프로드) DONE 문서 수. */
  remaining: number;
  /** rawTextS3Key 보유(오프로드 완료) 문서 수. */
  offloaded: number;
  /** 전체 DONE 문서 수(분모). */
  totalDone: number;
  /** offloaded / (offloaded + remaining), 0~1. 분모 0이면 1. */
  completionRatio: number;
}

/** 객체 스토리지(콜드 원문) 용량. */
export interface ObjectStorageSnapshot {
  driver: string;
  configured: boolean;
  /** rawText 객체 prefix. */
  rawTextPrefix: string;
  objectCount: number;
  totalBytes: number;
  totalPretty: string;
  /** S3 list 가용 여부(false면 권한/네트워크 제약 — 수치 부분 가용). */
  statsAvailable: boolean;
}

/** 로컬 산출물(원시 파일·객체 디렉터리) 추정. */
export interface LocalArtifactSnapshot {
  /** rawFilePath 가 남은 문서 수(로컬 원시 HTML/XML 잔존 추정). */
  rawFilesWithPath: number;
  /** 로컬 드라이버일 때 객체 저장 디렉터리 바이트(S3면 동일 measure 의미 없음 → statsAvailable 참조). */
  objectStoreBytes: number;
}

/** 임계 경고. */
export interface ThresholdSnapshot {
  /** 로컬 DB 크기 경고 임계(바이트). */
  dbWarnBytes: number;
  /** DB 크기가 임계를 초과했는가. */
  dbOverThreshold: boolean;
  /** 사람이 읽는 경고 메시지(빈 배열이면 정상). */
  warnings: string[];
}

/** GET /storage/health 응답 — 용량 모니터링 단일 스냅샷(read-only). */
export interface StorageHealth {
  generatedAt: string;
  database: {
    sizeBytes: number;
    sizePretty: string;
    /** 용량 상위 테이블(desc). */
    tables: TableSize[];
  };
  rawTextOffload: RawTextOffloadSnapshot;
  objectStorage: ObjectStorageSnapshot;
  localArtifacts: LocalArtifactSnapshot;
  thresholds: ThresholdSnapshot;
}

/** POST /storage/vacuum 결과 — 디스크 회수 전후 리포트. */
export interface VacuumResult {
  table: string;
  /** VACUUM 전 테이블 총 크기. */
  beforeBytes: number;
  beforePretty: string;
  /** VACUUM 후 테이블 총 크기. */
  afterBytes: number;
  afterPretty: string;
  /** 회수된 바이트(before - after, 음수면 0). */
  reclaimedBytes: number;
  reclaimedPretty: string;
  /** VACUUM FULL(테이블 재작성·ACCESS EXCLUSIVE 락) 여부. */
  full: boolean;
  durationMs: number;
}

/** POST /storage/cleanup-local-artifacts 결과 — 로컬 원시 파일 회수 리포트. */
export interface LocalCleanupResult {
  /** rawFilePath 보유 후보 문서 수(이번 배치). */
  scanned: number;
  /** 실제 삭제한 로컬 파일 수. */
  deletedFiles: number;
  /** 회수된 바이트. */
  freedBytes: number;
  freedPretty: string;
  /** rawFilePath 컬럼을 null 로 비운 문서 수. */
  clearedColumns: number;
  /** 잔여(아직 rawFilePath 가 남은) 문서 수. */
  remaining: number;
  durationMs: number;
}

/** POST /storage/lifecycle 결과 — 콜드 라이프사이클 적용. */
export interface LifecycleApplyResult {
  driver: string;
  /** 실제 적용(S3) 여부. 로컬/미구성은 false(no-op). */
  applied: boolean;
  /** 적용 시도한 규칙 수. */
  ruleCount: number;
  /** 규칙 요약(id·prefix·전환). */
  rules: Array<{ id: string; prefix: string; transitions: string[] }>;
}
