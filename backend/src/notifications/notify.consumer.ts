import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExpoPushService } from '../expo-push/expo-push.service';
import { NotificationsService } from './notifications.service';
import {
  QUEUE,
  NOTIFY_JOB,
  NotifySignalJobData,
  NotifyExitJobData,
  NotifyThesisViolatedJobData,
  NotifyTradeJobData,
} from '../common/queues/queue.constants';

/** DAR-424: KRW 천단위 구분 표기(반올림·정수). 음수는 '-' 유지. */
export function formatKrw(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** DAR-424: 부호 포함 퍼센트(소수 2자리). undefined/null 이면 빈 문자열. 예: +2.10% / -1.20% */
export function signedPct(pct?: number | null): string {
  if (pct === undefined || pct === null || Number.isNaN(pct)) return '';
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)}%`;
}

/**
 * DAR-85 — 알림 consumer (QUEUE.NOTIFY 단독 소비자).
 *
 * 책임:
 *  1) 수신자 해석 — SIGNAL=관심종목 watcher, EXIT/THESIS=포지션(포트폴리오) 소유자.
 *  2) 인박스 기록 — 일반화 NotificationHistory(DAR-84) 생성. (userId,type,refId) 멱등.
 *  3) 멱등 가드 — SIGNAL은 TradingSignal.isNotified/notifiedAt(기존 필드)로 1회 발송 보장.
 *  4) ★실발송 게이트 — notification-settings 토글이 ON(+master isEnabled)일 때만 푸시.
 *     기본 OFF: 토글 미설정 시 인박스만 기록하고 푸시 미발송(스팸 차단·안전).
 *
 * ★안전: 청산(EXIT)은 '권고'일 뿐 자동 실주문/Kill 과 무관하다 — 여기서는 통지만 한다.
 * AI 미개입. 발송 실패는 graceful(BullMQ 재시도) — 멱등 가드로 중복 통지 0.
 */
@Processor(QUEUE.NOTIFY)
export class NotifyConsumer extends WorkerHost {
  private readonly logger = new Logger(NotifyConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly expoPush: ExpoPushService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case NOTIFY_JOB.SIGNAL:
        return this.handleSignal(job.data as NotifySignalJobData);
      case NOTIFY_JOB.EXIT:
        return this.handleExit(job.data as NotifyExitJobData);
      case NOTIFY_JOB.THESIS_VIOLATED:
        return this.handleThesisViolated(job.data as NotifyThesisViolatedJobData);
      case NOTIFY_JOB.TRADE_ENTRY:
      case NOTIFY_JOB.TRADE_EXIT:
        return this.handleTrade(job.data as NotifyTradeJobData);
      default:
        this.logger.warn(`알 수 없는 NOTIFY 잡: ${job.name}`);
        return;
    }
  }

  // ── SIGNAL ────────────────────────────────────────────────────────────────
  private async handleSignal(data: NotifySignalJobData): Promise<void> {
    const { signalId, corpCode } = data;

    // 멱등 가드: 기존 TradingSignal.isNotified 사용(중복 발송 방지).
    const signal = await this.prisma.tradingSignal.findUnique({
      where: { id: signalId },
      select: { id: true, isNotified: true },
    });
    if (!signal) {
      this.logger.warn(`[NOTIFY:SIGNAL] TradingSignal 결측: ${signalId} — 스킵`);
      return;
    }
    if (signal.isNotified) {
      this.logger.debug(`[NOTIFY:SIGNAL] 이미 통지됨(멱등): ${signalId} — 스킵`);
      return;
    }

    const watchers = await this.prisma.watchList.findMany({
      where: { corpCode },
      select: { userId: true },
    });

    const label = data.corpName ?? data.stockCode ?? corpCode;
    const title = `매수 신호 · ${label}`;
    const parts = [
      data.grade,
      data.buyScore != null ? `score ${data.buyScore}` : null,
      data.eventType,
    ].filter(Boolean);
    const body = parts.join(' · ') || '신규 매수 신호가 도착했습니다.';
    const deepLink = `/signals/${signalId}`;

    for (const w of watchers) {
      await this.dispatch(w.userId, NotificationType.SIGNAL, signalId, title, body, deepLink);
    }

    // 모든 수신자 처리 후 1회만 멱등 마킹(재enqueue 시 위 isNotified 가드로 스킵).
    await this.prisma.tradingSignal.update({
      where: { id: signalId },
      data: { isNotified: true, notifiedAt: new Date() },
    });
    this.logger.log(
      `[NOTIFY:SIGNAL] ${signalId} watchers=${watchers.length} 통지 완료(멱등 마킹)`,
    );
  }

  // ── EXIT ──────────────────────────────────────────────────────────────────
  private async handleExit(data: NotifyExitJobData): Promise<void> {
    const { positionId } = data;
    const position = await this.prisma.position.findUnique({
      where: { id: positionId },
      select: {
        corpCode: true,
        stockCode: true,
        portfolio: { select: { id: true, userId: true } },
      },
    });
    const userId = position?.portfolio?.userId;
    if (!userId) {
      this.logger.warn(`[NOTIFY:EXIT] 포지션/소유자 결측: ${positionId} — 스킵`);
      return;
    }

    const label = data.corpName ?? data.stockCode ?? position.stockCode ?? data.corpCode;
    const title = `청산 권고 · ${label}`;
    const triggers = (data.triggerTypes ?? []).join(', ');
    const body = [data.exitAction, triggers].filter(Boolean).join(' · ')
      || '청산 조건이 충족되었습니다. (권고 — 자동 주문 아님)';
    const deepLink = `/portfolio/${position.portfolio!.id}/position/${positionId}`;

    // 멱등: refId=positionId 단위 NotificationHistory unique(userId,EXIT,refId).
    await this.dispatch(userId, NotificationType.EXIT, positionId, title, body, deepLink);
    this.logger.log(`[NOTIFY:EXIT] ${positionId} → user=${userId} 통지`);
  }

  // ── THESIS_VIOLATED ─────────────────────────────────────────────────────────
  private async handleThesisViolated(data: NotifyThesisViolatedJobData): Promise<void> {
    const { positionThesisId } = data;
    const thesis = await this.prisma.positionThesis.findUnique({
      where: { id: positionThesisId },
      select: {
        corpCode: true,
        position: {
          select: {
            id: true,
            stockCode: true,
            portfolio: { select: { id: true, userId: true } },
          },
        },
      },
    });
    const pos = thesis?.position;
    const userId = pos?.portfolio?.userId;
    if (!userId) {
      this.logger.warn(
        `[NOTIFY:THESIS] thesis/포지션/소유자 결측: ${positionThesisId} — 스킵`,
      );
      return;
    }

    const label = data.corpName ?? data.stockCode ?? pos?.stockCode ?? data.corpCode;
    const title = `투자논리 훼손 · ${label}`;
    const body = data.reason || '매수 논리의 무효 조건이 충족되었습니다.';
    // 청산 권고와 동일하게 포지션 상세로 딥링크(논리훼손→포지션 점검 동선).
    const deepLink = `/portfolio/${pos!.portfolio!.id}/position/${pos!.id}`;

    await this.dispatch(
      userId,
      NotificationType.THESIS_VIOLATED,
      positionThesisId,
      title,
      body,
      deepLink,
    );
    this.logger.log(`[NOTIFY:THESIS] ${positionThesisId} → user=${userId} 통지`);
  }

  // ── TRADE_ENTRY / TRADE_EXIT (DAR-424) ──────────────────────────────────────
  //
  // 라이브 페이퍼 체결(분봉 단타·시스템 모의)을 ★실제 앱 사용자 전원에게 브로드캐스트한다.
  //   - 시스템 모의/단타는 전역 단일 시뮬이라 포지션 소유자(합성 시스템 유저)가 아닌
  //     실 사용자 전원이 수신 대상이다(provider='system' 합성 유저는 제외).
  //   - tradePushEnabled(기본 ON) 토글로 인박스·푸시를 함께 게이트한다(SIGNAL/EXIT 와 달리
  //     OFF면 인박스도 남기지 않는다 — 브로드캐스트 과알림 방지). 설정행 미존재=기본 ON.
  //   - 푸시는 추가로 master isEnabled + 유효 디바이스 토큰 필요.
  //   - 멱등: (userId, type, refId) NotificationHistory unique. type 이 ENTRY/EXIT 로 갈려
  //     같은 체결 단위(refId)라도 매수/매도가 별개로 적재된다.
  // ★알림은 통지일 뿐 — 주문 결정/실주문과 무관(AI 금지영역 불침범).
  private async handleTrade(data: NotifyTradeJobData): Promise<void> {
    const type =
      data.kind === 'ENTRY'
        ? NotificationType.TRADE_ENTRY
        : NotificationType.TRADE_EXIT;
    const label = data.corpName || data.stockCode || data.corpCode;
    const priceStr = formatKrw(data.price);
    const cashStr = formatKrw(data.cash);
    const totalStr = formatKrw(data.totalValue);

    let title: string;
    let body: string;
    if (data.kind === 'ENTRY') {
      title = `[${data.strategyLabel}] ${label} 매수`;
      body = `체결 ₩${priceStr} × ${data.shares}주 · 현금 ₩${cashStr} · 평가금 ₩${totalStr}`;
    } else {
      const pct = signedPct(data.pnlPct);
      const reason = data.exitReason ? `(${data.exitReason})` : '';
      title = `[${data.strategyLabel}] ${label} 매도${pct ? ` ${pct}` : ''}`;
      body = `체결 ₩${priceStr} × ${data.shares}주 · 손익 ${pct || '—'}${reason} · 현금 ₩${cashStr} · 전체평가금 ₩${totalStr}`;
    }
    const deepLink = data.deepLink;

    // 수신자 = 실제 앱 사용자 전원(브로드캐스트). 합성 시스템 유저(provider='system') 제외.
    const users = await this.prisma.user.findMany({
      where: { provider: { not: 'system' } },
      select: { id: true },
    });
    if (users.length === 0) {
      this.logger.debug(`[NOTIFY:TRADE:${data.kind}] 수신 대상 사용자 없음 — 스킵`);
      return;
    }

    // 토글 일괄 조회(설정행 미존재=기본값으로 간주).
    const settingsRows = await this.prisma.notificationSettings.findMany({
      where: { userId: { in: users.map((u) => u.id) } },
      select: { userId: true, isEnabled: true, tradePushEnabled: true },
    });
    const settingsByUser = new Map(settingsRows.map((s) => [s.userId, s]));

    let inboxed = 0;
    for (const u of users) {
      const s = settingsByUser.get(u.id);
      // ★기본 ON: 설정행 미존재 시 tradePushEnabled=true 로 간주.
      const tradeOn = s ? s.tradePushEnabled : true;
      if (!tradeOn) continue; // 인박스·푸시 모두 생략(과알림 방지).

      const { created } = await this.notifications.createNotificationIfAbsent({
        userId: u.id,
        type,
        refId: data.refId,
        title,
        body,
        deepLink,
      });
      if (!created) continue; // 멱등 — 이미 통지(잡 재시도 등) → 푸시 재발송 스킵.
      inboxed += 1;

      // 푸시는 master isEnabled(기본 true) + 유효 토큰일 때만(체결 토글은 위에서 통과).
      const masterOn = s ? s.isEnabled : true;
      if (!masterOn) continue;
      // DAR-431: 트랙 식별자 동봉 — 클라이언트 전략별 라우팅/필터용.
      await this.sendPush(u.id, title, body, deepLink, type, data.refId, {
        strategyKey: data.strategyKey,
        strategyName: data.strategyLabel,
      });
    }
    this.logger.log(
      `[NOTIFY:TRADE:${data.kind}] ref=${data.refId} 수신자=${users.length} 신규인박스=${inboxed}`,
    );
  }

  // ── 공통: 인박스 기록(항상) + 토글 ON 시에만 실발송 ──────────────────────────
  private async dispatch(
    userId: string,
    type: NotificationType,
    refId: string,
    title: string,
    body: string,
    deepLink: string,
  ): Promise<void> {
    // 1) 인박스는 토글과 무관하게 항상 기록(멱등). 사용자가 앱에서 확인 가능.
    //    created=false 면 이전 시도(잡 재시도 등)가 이미 처리한 통지 → 푸시 재발송 금지.
    const { created } = await this.notifications.createNotificationIfAbsent({
      userId,
      type,
      refId,
      title,
      body,
      deepLink,
    });
    if (!created) {
      // ★DAR-136: NotificationHistory 가 푸시 멱등 권위. 중복 인박스 0 + 중복 푸시 0.
      this.logger.debug(
        `[NOTIFY] 이미 통지된 항목(멱등) — 푸시 재발송 스킵: user=${userId} type=${type} ref=${refId}`,
      );
      return;
    }

    // 2) ★실발송은 토글 뒤 기본 OFF. 미설정/OFF면 인박스만 남기고 푸시 미발송.
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
      select: {
        isEnabled: true,
        signalPushEnabled: true,
        exitPushEnabled: true,
        thesisPushEnabled: true,
      },
    });
    if (!settings || !settings.isEnabled || !this.isTypePushEnabled(settings, type)) {
      this.logger.debug(`[NOTIFY] 푸시 OFF(인박스만): user=${userId} type=${type}`);
      return;
    }

    await this.sendPush(userId, title, body, deepLink, type, refId);
  }

  private isTypePushEnabled(
    settings: {
      signalPushEnabled: boolean;
      exitPushEnabled: boolean;
      thesisPushEnabled: boolean;
    },
    type: NotificationType,
  ): boolean {
    switch (type) {
      case NotificationType.SIGNAL:
        return settings.signalPushEnabled;
      case NotificationType.EXIT:
        return settings.exitPushEnabled;
      case NotificationType.THESIS_VIOLATED:
        return settings.thesisPushEnabled;
      default:
        return false; // 신규 토글 미정의 타입은 안전하게 OFF
    }
  }

  private async sendPush(
    userId: string,
    title: string,
    body: string,
    deepLink: string,
    type: NotificationType,
    refId: string,
    // DAR-431: 체결 알림은 트랙 식별자(strategyKey/strategyName)를 push data 에 동봉해
    //   클라이언트가 전략별로 라우팅·필터링할 수 있게 한다(undefined 키는 제외).
    extraData?: Record<string, string | undefined>,
  ): Promise<void> {
    const devices = await this.prisma.userDevice.findMany({
      where: { userId },
      select: { deviceToken: true },
    });
    const tokens = devices
      .map((d) => d.deviceToken)
      .filter((t) => this.expoPush.isValidExpoPushToken(t));
    if (tokens.length === 0) {
      this.logger.debug(`[NOTIFY] 유효 디바이스 토큰 없음: user=${userId}`);
      return;
    }

    const extra = extraData
      ? Object.fromEntries(
          Object.entries(extraData).filter(([, v]) => v != null && v !== ''),
        )
      : {};

    await this.expoPush.sendPushNotifications(
      tokens.map((to) => ({
        to,
        sound: 'default' as const,
        title,
        body,
        data: { deepLink, type, refId, ...extra },
      })),
    );
  }
}
