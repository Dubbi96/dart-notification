import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';

/** 점검 대상 외부 API 키(키 존재/형식만 — ★실호출·쿼터 소모 금지). */
const EXTERNAL_KEYS = [
  { name: 'dart', env: 'DART_API_KEY' },
  { name: 'krx', env: 'KRX_API_KEY' },
  { name: 'llm', env: 'LLM_API_KEY' },
] as const;

/**
 * 외부 API 키 readiness 헬스 인디케이터 (DAR-111).
 *
 * ★외부키(DART/KRX/LLM) readiness 는 가벼운 키 존재/형식 확인으로 제한한다 —
 *   실제 외부 호출 없음(쿼터 소모 0). 키가 없어도 throw 하지 않고 configured=false 로
 *   정직 표기(graceful) — 키 부재는 liveness/readiness 실패가 아니라 운영 정보.
 */
@Injectable()
export class ExternalKeysHealthIndicator extends HealthIndicator {
  constructor(private readonly config: ConfigService) {
    super();
  }

  /** 키 형식 최소 검증 — 비어있지 않고 공백/플레이스홀더가 아닌지(실호출 없음). */
  private isWellFormed(value: string | undefined): boolean {
    if (!value) return false;
    const v = value.trim();
    if (v.length < 8) return false;
    return !/^(your|changeme|placeholder|xxx)/i.test(v);
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const detail: Record<string, boolean> = {};
    for (const k of EXTERNAL_KEYS) {
      detail[k.name] = this.isWellFormed(this.config.get<string>(k.env));
    }
    // 키 부재는 실패가 아님 — 항상 up(graceful), 상세에 키별 구성 여부만 노출.
    return this.getStatus(key, true, detail);
  }
}
