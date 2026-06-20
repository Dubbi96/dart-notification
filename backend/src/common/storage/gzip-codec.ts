// backend/src/common/storage/gzip-codec.ts
// DAR-395: 객체 스토리지 공용 gzip 코덱 — 업로드 압축/다운로드 해제의 단일 출처.
//
// 콜드 원문(공시 rawText)은 거의 재조회되지 않으므로 저장 시 gzip 압축해 객체 스토리지
// 용량·전송 비용을 줄인다. 키가 '.gz' 로 끝나면 다운로드 시 자동 해제한다(드라이버 무관 일관).

import { gzipSync, gunzipSync } from 'zlib';

/** 키가 gzip 객체(.gz) 인지 — 다운로드 해제 판정의 단일 기준. */
export function isGzipKey(key: string): boolean {
  return key.endsWith('.gz');
}

/**
 * 저장 바이트 인코딩.
 * - compress=true: UTF-8 → gzip 바이트.
 * - compress=false: UTF-8 평문 바이트.
 * 순수 함수(네트워크/FS 무관) — 단위 테스트로 라운드트립 검증.
 */
export function encodeForStorage(content: string, compress: boolean): Buffer {
  const raw = Buffer.from(content, 'utf-8');
  return compress ? gzipSync(raw) : raw;
}

/**
 * 다운로드 바이트 디코딩.
 * - key 가 '.gz' 면 gunzip 후 UTF-8.
 * - 아니면 UTF-8 평문.
 * 순수 함수 — 키 기반 판정이라 메타데이터 의존 없음(이식성).
 */
export function decodeFromStorage(bytes: Buffer, key: string): string {
  const raw = isGzipKey(key) ? gunzipSync(bytes) : bytes;
  return raw.toString('utf-8');
}
