/**
 * kis-rate-limit.spec.ts — KIS 레이트리밋 하드닝 순수 판정 로직 (DAR-480)
 *
 * 검증: 유량초과(EGW00201) 본문 감지 · validateResponse(200 유량초과를 실패로 변환) ·
 *   retryCondition(네트워크·429/503·EGW00201 재시도 포함). axios-retry 를 **모킹하지 않는다** —
 *   실제 isNetworkError 경로까지 검증하기 위함(kis-api.service.spec.ts 와 분리).
 */

import type { AxiosError, AxiosResponse } from 'axios';
import {
  isKisRateLimitedBody,
  validateKisResponse,
  shouldRetryKisError,
} from './kis-api.service';

const resp = (status: number, data: unknown): AxiosResponse =>
  ({ status, data } as AxiosResponse);

const err = (partial: Partial<AxiosError>): AxiosError => partial as AxiosError;

describe('KIS 레이트리밋 판정 (DAR-480)', () => {
  describe('isKisRateLimitedBody', () => {
    it('msg_cd=EGW00201 이면 유량초과(true)', () => {
      expect(isKisRateLimitedBody({ msg_cd: 'EGW00201', msg1: '초당 거래건수 초과' })).toBe(true);
    });
    it('대소문자·공백 변형도 감지', () => {
      expect(isKisRateLimitedBody({ msg_cd: ' egw00201 ' })).toBe(true);
    });
    it('정상 성공 응답(msg_cd=0)은 false', () => {
      expect(isKisRateLimitedBody({ rt_cd: '0', msg_cd: '0' })).toBe(false);
    });
    it('msg_cd 결측/비객체/널은 false', () => {
      expect(isKisRateLimitedBody({ rt_cd: '0' })).toBe(false);
      expect(isKisRateLimitedBody(null)).toBe(false);
      expect(isKisRateLimitedBody(undefined)).toBe(false);
      expect(isKisRateLimitedBody('EGW00201')).toBe(false); // 문자열은 본문이 아님
      expect(isKisRateLimitedBody(42)).toBe(false);
    });
  });

  describe('validateKisResponse (HTTP 200 본문 검사)', () => {
    it('2xx + 정상 본문은 성공(true)', () => {
      expect(validateKisResponse(resp(200, { rt_cd: '0', output: {} }))).toBe(true);
    });
    it('★HTTP 200 이지만 EGW00201 본문은 실패(false) → 재시도 경로', () => {
      expect(validateKisResponse(resp(200, { msg_cd: 'EGW00201' }))).toBe(false);
    });
    it('2xx 밖(예: 500)은 실패(false)', () => {
      expect(validateKisResponse(resp(500, { msg_cd: 'EGW00201' }))).toBe(false);
      expect(validateKisResponse(resp(404, {}))).toBe(false);
    });
  });

  describe('shouldRetryKisError (재시도 대상)', () => {
    it('HTTP 200 본문 EGW00201 은 재시도(true)', () => {
      expect(shouldRetryKisError(err({ response: resp(200, { msg_cd: 'EGW00201' }) }))).toBe(true);
    });
    it('HTTP 429/503 은 재시도(true)', () => {
      expect(shouldRetryKisError(err({ response: resp(429, {}) }))).toBe(true);
      expect(shouldRetryKisError(err({ response: resp(503, {}) }))).toBe(true);
    });
    it('네트워크 오류(응답 없음·재시도 가능 code)는 재시도(true)', () => {
      expect(shouldRetryKisError(err({ code: 'ECONNRESET' }))).toBe(true);
    });
    it('정상 4xx(404)·정상 200 은 재시도 안 함(false)', () => {
      expect(shouldRetryKisError(err({ response: resp(404, { msg_cd: 'X' }) }))).toBe(false);
      expect(shouldRetryKisError(err({ response: resp(200, { rt_cd: '0' }) }))).toBe(false);
    });
  });
});
