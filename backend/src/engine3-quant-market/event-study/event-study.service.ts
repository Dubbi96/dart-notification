import { Injectable } from '@nestjs/common';

export interface EventStudyResult {
  stockCode: string;
  rcpNo: string;
  eventDate: string;
  d1Return: number | null;
  d3Return: number | null;
  d5Return: number | null;
  d10Return: number | null;
  d5AvgReturn: number | null;
}

/**
 * 이벤트 스터디 서비스 — M4 스켈레톤.
 * 공시 이벤트 발생 후 D+1~D+10 가격 반응 집계.
 * TODO(M9): 실제 구현 (Phase 9 이벤트 스터디).
 */
@Injectable()
export class EventStudyService {
  async getStudyResult(
    stockCode: string,
    rcpNo: string,
  ): Promise<EventStudyResult | null> {
    // TODO(M9): 이벤트 스터디 결과 조회
    void stockCode;
    void rcpNo;
    return null;
  }
}
