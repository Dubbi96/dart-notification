// backend/src/engine1-disclosure/disclosure-documents/disclosure-documents.constants.ts
// 파싱 파이프라인 공유 상수 (SSOT)

/**
 * 파싱 재시도 최대 횟수(상한).
 *
 * 같은 비즈니스 룰('FETCH_FAILED/PARSE_FAILED 이고 retryCount < 캡' 인 retryable 문서 집합)이
 * disclosure-documents.service(getRetryQueue·parseDisclosure)와
 * pipeline-integrity.service(재처리 스캐너) 양쪽에서 쓰이므로 단일 정의(SSOT)로 통합한다.
 * 한쪽만 변경되어 두 경로의 retryable 판정이 어긋나는 발산을 방지한다.
 */
export const PARSE_MAX_RETRY = 3;
