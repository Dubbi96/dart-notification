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
} from '../common/queues/queue.constants';

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
    const deepLink = `signals/${signalId}`;

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
        portfolio: { select: { userId: true } },
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
    const deepLink = `portfolio/positions/${positionId}`;

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
          select: { stockCode: true, portfolio: { select: { userId: true } } },
        },
      },
    });
    const userId = thesis?.position?.portfolio?.userId;
    if (!userId) {
      this.logger.warn(
        `[NOTIFY:THESIS] thesis/포지션/소유자 결측: ${positionThesisId} — 스킵`,
      );
      return;
    }

    const label =
      data.corpName ?? data.stockCode ?? thesis.position?.stockCode ?? data.corpCode;
    const title = `투자논리 훼손 · ${label}`;
    const body = data.reason || '매수 논리의 무효 조건이 충족되었습니다.';
    const deepLink = `theses/${positionThesisId}`;

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
    await this.notifications.createNotification({ userId, type, refId, title, body, deepLink });

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

    await this.expoPush.sendPushNotifications(
      tokens.map((to) => ({
        to,
        sound: 'default' as const,
        title,
        body,
        data: { deepLink, type, refId },
      })),
    );
  }
}
