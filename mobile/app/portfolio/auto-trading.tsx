import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { ApiErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { useAutoTradingStatus } from '@hooks/useAutoTradingStatus';
import { useManualRefresh } from '@hooks/useManualRefresh';

import type {
  AutoStatusKillSwitch,
  AutoStatusOrderItem,
  AutoStatusRiskGate,
} from '@app-types/auto-status.types';

// 자동매매 상태 화면(읽기전용 투명성) — DAR-361.
// 신뢰=실행상태 가시성. M11 주문 실행 루프는 미인가 → 이 화면은 상태 가시화만 한다
// (발주/승인/취소 같은 실행 액션 없음). 킬스위치는 안전상 항상 노출.
// 구성: ① 킬스위치 상태 배지(최상단) ② 리스크게이트 상태 ③ 최근 실행/감사 트레일 3건
//       ④ M11 미가동 정직 고지. 테마 토큰만(하드코딩 색상 0).

// 주문 상태 → 한국어 라벨(백엔드 OrderRequestStatus).
const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING: '대기',
  APPROVED: '승인',
  REJECTED: '거부',
  KILLED: '차단',
  EXECUTED: '체결',
  CANCELLED: '취소',
};

function orderStatusLabel(status: string): string {
  return ORDER_STATUS_LABEL[status] ?? status;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

/** ① 킬스위치 상태 배지 — 최상단. 발동(주문 차단)이면 경고색, 정상 대기면 중립/녹색. */
function KillSwitchCard({ killSwitch }: { killSwitch: AutoStatusKillSwitch }) {
  const { colors, typography: typo } = useTheme();
  const fired = killSwitch.isActive;

  // 정상 대기 = 안전망 정상(녹/중립), 발동 = 모든 주문 차단(경고).
  const tone = fired ? colors.error : colors.success;
  const toneSurface = fired ? colors.errorSurface : colors.successSurface;
  const stateLabel = fired ? '발동됨 · 주문 차단' : '정상 대기';
  const icon = fired ? 'alert-octagon' : 'shield';

  return (
    <Surface
      elevation={1}
      style={[styles.card, styles.killCard, { backgroundColor: colors.surface, borderColor: tone }]}
      accessibilityLabel={`킬스위치 ${stateLabel}${fired && killSwitch.reason ? `. 사유 ${killSwitch.reason}` : ''}`}
    >
      <View style={styles.cardHeaderRow}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>킬스위치 (Kill Switch)</Text>
        <View style={[styles.disabledPill, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[typo.small, { color: colors.textTertiary }]}>토글 준비중</Text>
        </View>
      </View>

      <View style={[styles.stateRow, { backgroundColor: toneSurface }]}>
        <Feather name={icon} size={22} color={tone} />
        <View style={styles.stateBody}>
          <Text style={[typo.bodyMedium, { color: tone, fontWeight: '700' }]}>{stateLabel}</Text>
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: 2 }]}>
            {fired
              ? `${killSwitch.reason ?? '안전 규칙 위반'} · ${killSwitch.triggeredBy === 'USER' ? '수동' : '자동'} 발동`
              : '안전망 정상 — 이상 감지 시 모든 주문이 자동 차단됩니다.'}
          </Text>
          {fired && killSwitch.activatedAt ? (
            <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
              발동 시각 {formatDateTime(killSwitch.activatedAt)}
            </Text>
          ) : null}
        </View>
      </View>
    </Surface>
  );
}

/** ② 리스크게이트 상태 — 정상 또는 주문 차단중(사유). */
function RiskGateCard({ riskGate }: { riskGate: AutoStatusRiskGate }) {
  const { colors, typography: typo } = useTheme();
  const blocked = riskGate.blocked;
  const tone = blocked ? colors.warning : colors.success;
  const label = blocked ? '주문 차단중' : '정상';

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel={`리스크 게이트 ${label}${blocked && riskGate.blockedReason ? `. 사유 ${riskGate.blockedReason}` : ''}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]}>리스크 게이트</Text>
      <View style={styles.riskRow}>
        <View style={[styles.dot, { backgroundColor: tone }]} />
        <Text style={[typo.bodyMedium, { color: tone, fontWeight: '600' }]}>{label}</Text>
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        {blocked
          ? riskGate.blockedReason ?? '주문이 차단된 상태입니다.'
          : '하드룰(손실·비중 한도 등)은 주문 시점마다 건별 평가됩니다. 현재 상시 차단 없음.'}
      </Text>
    </Surface>
  );
}

/** ③ 최근 실행 / 감사 트레일 1건 행. */
function OrderRow({ item }: { item: AutoStatusOrderItem }) {
  const { colors, typography: typo } = useTheme();
  const isReject = item.status === 'REJECTED' || item.status === 'KILLED';
  const isDone = item.status === 'EXECUTED';
  const tone = isReject ? colors.error : isDone ? colors.success : colors.textSecondary;
  const sideLabel = item.side === 'BUY' ? '매수' : '매도';

  return (
    <View style={[styles.orderRow, { borderTopColor: colors.borderLight }]}>
      <View style={styles.orderLeft}>
        <View style={styles.orderTitleRow}>
          <Text style={[typo.captionMedium, { color: colors.text }]} numberOfLines={1}>
            {item.stockCode} · {sideLabel} {item.requestedShares.toLocaleString('ko-KR')}주
          </Text>
        </View>
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: 2 }]}>
          {formatDateTime(item.createdAt)}
          {item.reason ? ` · ${item.reason}` : ''}
        </Text>
      </View>
      <View style={[styles.orderStatusBadge, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[typo.small, { color: tone, fontWeight: '600' }]}>
          {orderStatusLabel(item.status)}
        </Text>
      </View>
    </View>
  );
}

/** ③ 최근 실행 / 감사 트레일 카드 — 없으면 '데이터 없음' graceful. */
function RecentOrdersCard({ orders }: { orders: AutoStatusOrderItem[] }) {
  const { colors, typography: typo } = useTheme();

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeaderRow}>
        <Text style={[typo.captionMedium, { color: colors.text }]}>최근 실행 · 감사 트레일</Text>
        <Feather name="list" size={16} color={colors.textTertiary} />
      </View>

      {orders.length === 0 ? (
        <View style={styles.emptyOrders}>
          <Feather name="inbox" size={20} color={colors.textTertiary} />
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            데이터 없음 — 아직 실행된 주문이 없습니다.
          </Text>
        </View>
      ) : (
        orders.map((o) => <OrderRow key={o.id} item={o} />)
      )}

      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        모든 주문 판정·킬스위치 조작은 감사 로그에 기록됩니다(전체 이력은 운영자 조회 전용).
      </Text>
    </Surface>
  );
}

/** 백테스트 트랙레코드 진입점 — 1년 리플레이 성과 화면(DAR-388)으로 이동. */
function TrackRecordEntryCard() {
  const { colors, typography: typo } = useTheme();
  return (
    <Pressable
      onPress={() => router.push('/portfolio/backtest-track-record')}
      accessibilityRole="button"
      accessibilityLabel="1년 백테스트 트랙레코드 보기"
      style={({ pressed }) => [
        styles.card,
        styles.entryCard,
        { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.entryIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name="bar-chart-2" size={20} color={colors.primary} />
      </View>
      <View style={styles.entryText}>
        <Text style={[typo.bodyMedium, { color: colors.text }]}>1년 백테스트 트랙레코드</Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          point-in-time 리플레이 성과 — 총수익률·승률·자산곡선
        </Text>
      </View>
      <Feather name="chevron-right" size={20} color={colors.textTertiary} />
    </Pressable>
  );
}

export default function AutoTradingStatusScreen() {
  const { colors, typography: typo } = useTheme();
  const query = useAutoTradingStatus();
  const data = query.data;

  // C8: 수동 새로고침 어포던스 — 30초 자동 폴링과 별개로 사용자가 즉시 최신화할 수 있게 한다(DAR-472 공통 훅).
  const { refreshing, onRefresh } = useManualRefresh(query.refetch);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader title="자동매매 상태" onBack={() => router.back()} />

      {query.isLoading ? (
        // C7: 드릴다운 로딩을 탭 섹션·포지션 상세와 동일한 스켈레톤(DAR-147 패턴)으로 통일 —
        // 콘텐츠 골격(킬스위치·트랙레코드 진입·리스크게이트·감사 트레일)을 미리 그려 점프 제거.
        <DetailSkeleton
          cards={[{ chip: true, lines: 2 }, { lines: 2 }, { lines: 2 }, { lines: 3 }]}
        />
      ) : query.isError ? (
        <ApiErrorState
          error={query.error}
          onRetry={query.refetch}
          title="실행 상태를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
        />
      ) : data ? (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* ④ M11 미가동 정직 고지 — 최상단 1줄 */}
          <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="info" size={14} color={colors.info} />
            <Text style={[typo.small, { color: colors.info, marginLeft: spacing.xs, flex: 1 }]}>
              {data.notice}
            </Text>
          </View>

          {/* SCR-GAP-10: 매수 로직 재검증 정직 고지 — 확정 전 수치는 참고용(기존 notice 패턴). */}
          <View style={[styles.notice, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="refresh-cw" size={14} color={colors.info} />
            <Text style={[typo.small, { color: colors.info, marginLeft: spacing.xs, flex: 1 }]}>
              매수 로직 재검증 진행 중 — 확정 전까지 성과·신호는 참고용입니다.
            </Text>
          </View>

          {/* ① 킬스위치 (최상단 안전 표면) */}
          <KillSwitchCard killSwitch={data.killSwitch} />

          {/* C5: 트랙레코드 진입점을 킬스위치 직후 상단으로 승격 — 신뢰 핵심 자료(1년 리플레이·DAR-388) 발견성. */}
          <TrackRecordEntryCard />

          {/* ② 리스크 게이트 */}
          <RiskGateCard riskGate={data.riskGate} />

          {/* ③ 최근 실행 · 감사 트레일 */}
          <RecentOrdersCard orders={data.recentOrders} />

          <Text style={[typo.small, { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.sm }]}>
            갱신 {formatDateTime(data.asOf)} · 30초마다 자동 갱신
          </Text>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  killCard: { borderWidth: 1.5 },
  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  entryIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryText: { flex: 1, gap: 2 },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  disabledPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.base,
    marginTop: spacing.sm,
  },
  stateBody: { flex: 1 },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  dot: { width: 10, height: 10, borderRadius: radius.full },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  orderLeft: { flex: 1 },
  orderTitleRow: { flexDirection: 'row', alignItems: 'center' },
  orderStatusBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
  },
  emptyOrders: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
});
