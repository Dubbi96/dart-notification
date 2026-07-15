import { Injectable } from '@nestjs/common';
import { AiTaskName } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  extractSummaryText,
  renderLandingHtml,
  renderNotFoundHtml,
  renderSharePageHtml,
} from './share-page.renderer';

/** DART 접수번호 형식 — 14자리 숫자. 형식 미달은 DB 조회 없이 404로 수렴 */
const RCP_NO_PATTERN = /^\d{14}$/;

export interface SharePageResult {
  found: boolean;
  html: string;
}

/**
 * 웹 표면(W3b) — 공개 랜딩·공유 페이지 조립.
 *
 * 절대 조건: 외부 API 호출 0(DART 쿼터 무접촉), DB read-only,
 * AI 재계산·신규 호출 금지(DisclosureAnalysis 캐시가 있을 때만 요약 표시).
 */
@Injectable()
export class WebSurfaceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 초미니 랜딩 HTML */
  getLandingHtml(): string {
    return renderLandingHtml();
  }

  /**
   * 공유 페이지 HTML 조립 — Disclosure + (있으면) summary 캐시만 읽는다.
   * 존재하지 않거나 형식이 어긋난 rcpNo 는 { found: false } + 404 HTML.
   */
  async getSharePage(rcpNo: string): Promise<SharePageResult> {
    if (!RCP_NO_PATTERN.test(rcpNo)) {
      return { found: false, html: renderNotFoundHtml() };
    }

    const disclosure = await this.prisma.disclosure.findUnique({
      where: { rcpNo },
      select: { rcpNo: true, corpName: true, reportName: true, rcpDt: true },
    });
    if (!disclosure) {
      return { found: false, html: renderNotFoundHtml() };
    }

    // 캐시된 AI 요약(summary task)만 조회 — 없으면 섹션 생략(재계산 절대 금지)
    const analysis = await this.prisma.disclosureAnalysis.findUnique({
      where: { rcpNo_task: { rcpNo, task: AiTaskName.summary } },
      select: { resultJson: true },
    });
    const summary = extractSummaryText(analysis?.resultJson ?? null);

    return {
      found: true,
      html: renderSharePageHtml({
        rcpNo: disclosure.rcpNo,
        corpName: disclosure.corpName,
        reportName: disclosure.reportName,
        rcpDt: disclosure.rcpDt,
        summary,
      }),
    };
  }
}
