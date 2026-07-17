import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { LoadingState, ErrorState, EmptyState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { formatYmdDots } from '@utils/datetime';
import {
  useAiCostMetrics,
  useAiCostHealth,
  useAiCostDaily,
  useAiCostMonthly,
  useAiCostLimitStatus,
  useAiCostCrossEngine,
} from '@hooks/useAiCost';

import type {
  AiCostHealth,
  AiCostPeriodSummary,
  AiCostLimitStatus,
  AiCrossEngineMetrics,
} from '@app-types/api.types';

const USD_TO_KRW = 1300;

/**
 * AI Task 식별자(byTask 키, 백엔드 AiTaskName) → 한국어 라벨 (D7).
 * 영문 enum 키가 그대로 노출되던 한국어 위반을 차단. 미정의 키는 원문 폴백.
 */
const TASK_LABELS: Record<string, string> = {
  summary: '공시 요약',
  'event-classification': '이벤트 분류',
  'persona-interpretation': '페르소나 해석',
  'position-thesis': '보유 논거 점검',
};

function taskLabel(key: string): string {
  return TASK_LABELS[key] ?? key;
}

/**
 * 집계 기간 문자열 포맷 (D15). 'YYYYMMDD'는 앱 공통 formatYmdDots,
 * ISO('YYYY-MM-DD…')는 앞 10자리를 점 표기로, 그 외엔 원문 폴백.
 */
function formatPeriodDate(raw: string | null | undefined): string {
  if (!raw) return '-';
  if (/^\d{8}$/.test(raw)) return formatYmdDots(raw);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}.${m[2]}.${m[3]}`;
  return raw;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function formatKrw(usd: number): string {
  const krw = Math.round(usd * USD_TO_KRW);
  return `₩${krw.toLocaleString('ko-KR')}`;
}

/** 이미 KRW 단위인 값 포맷 (cross-engine 단위비용). */
function formatKrwValue(krw: number): string {
  return `₩${Math.round(krw).toLocaleString('ko-KR')}`;
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}

/** 수용기준 충족/위반 배지 — 테마 토큰만 사용 (하드코딩 색상 0). */
function AcceptanceBadge({ ok, label }: { ok: boolean; label: string }) {
  const { colors, typography: typo } = useTheme();
  const fg = ok ? colors.success : colors.error;
  const bg = ok ? colors.successSurface : colors.errorSurface;
  return (
    <View
      style={[styles.badge, { backgroundColor: bg }]}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${ok ? '충족' : '위반'}`}
    >
      <Feather name={ok ? 'check-circle' : 'alert-triangle'} size={13} color={fg} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[typo.caption, { color: fg, marginLeft: spacing.xs, flexShrink: 1, minWidth: 0 }]}
        ellipsizeMode="tail"
      >
        {label} {ok ? 'OK' : '위반'}
      </Text>
    </View>
  );
}

/** 한도 사용률 게이지 — 100% 초과 시 error 색. */
function LimitUsageBar({
  label,
  usedUsd,
  limitUsd,
  ratio,
}: {
  label: string;
  usedUsd: number;
  limitUsd: number;
  ratio: number;
}) {
  const { colors, typography: typo } = useTheme();
  const exceeded = ratio >= 1;
  const fillColor = exceeded ? colors.error : ratio >= 0.8 ? colors.warning : colors.primary;
  const fillWidth = `${Math.min(100, Math.max(0, ratio * 100))}%` as const;
  return (
    <View
      style={styles.usageBlock}
      accessibilityRole="text"
      accessibilityLabel={`${label} 사용률 ${formatPct(ratio)}, ${formatUsd(usedUsd)} / ${formatUsd(limitUsd)}`}
    >
      <View style={styles.usageHeader}>
        <Text style={[typo.caption, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[typo.caption, { color: exceeded ? colors.error : colors.text }]}>
          {formatUsd(usedUsd)} / {formatUsd(limitUsd)} ({formatPct(ratio)})
        </Text>
      </View>
      <View style={[styles.usageTrack, { backgroundColor: colors.borderLight }]}>
        <View style={[styles.usageFill, { width: fillWidth, backgroundColor: fillColor }]} />
      </View>
    </View>
  );
}

/** 라이브 AI 비용게이트 상시 모니터링 카드 (수용기준 배지 + 한도 사용률). */
function MonitoringCard({ health }: { health: AiCostHealth }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.monitorCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.monitorHeader}>
        <Feather name="activity" size={16} color={colors.primary} />
        <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.xs }]}>
          비용게이트 상시 모니터링
        </Text>
      </View>

      <View style={styles.badgeRow}>
        <AcceptanceBadge ok={health.acceptance.costOk} label="건당비용" />
        <AcceptanceBadge ok={health.acceptance.l0Ok} label="L0비율" />
      </View>
      <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
        건당 {formatUsd(health.acceptance.costPerDisclosureUsd)} (기준 &lt;
        {formatUsd(health.acceptance.costThresholdUsd)}){' · '}L0{' '}
        {formatPct(health.acceptance.l0Ratio)} (기준 ≥
        {formatPct(health.acceptance.l0ThresholdRatio)})
      </Text>

      <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />

      <LimitUsageBar
        label="일 한도"
        usedUsd={health.limit.dailyCostUsd}
        limitUsd={health.limit.dailyLimitUsd}
        ratio={health.limitUsage.dailyUsedRatio}
      />
      <LimitUsageBar
        label="월 한도"
        usedUsd={health.limit.monthlyCostUsd}
        limitUsd={health.limit.monthlyLimitUsd}
        ratio={health.limitUsage.monthlyUsedRatio}
      />

      {!health.llmKeyConfigured && (
        <Text style={[typo.small, { color: colors.warning, marginTop: spacing.sm }]}>
          ⚠ LLM 키 미설정 — 과거 기록 기준 집계 (라이브 호출 없음)
        </Text>
      )}
      {health.alert.violated && (
        <Text
          style={[typo.small, { color: colors.error, marginTop: spacing.sm }]}
          accessibilityLabel={`운영 알림 ${health.alert.reasons.join(', ')}`}
        >
          ⚠ {health.alert.reasons.join(' · ')}
        </Text>
      )}
    </View>
  );
}

/** 섹션 내 인라인 상태 (로딩/에러/빈상태) — 읽기전용 보조 섹션용. */
function SectionStatus({ status }: { status: 'loading' | 'error' | 'empty' }) {
  const { colors, typography: typo } = useTheme();
  const text =
    status === 'loading'
      ? '불러오는 중...'
      : status === 'error'
        ? '데이터를 불러오지 못했습니다'
        : '데이터 없음';
  return (
    <Text
      style={[typo.caption, { color: colors.textTertiary, paddingVertical: spacing.sm }]}
      accessibilityLabel={text}
    >
      {text}
    </Text>
  );
}

/** L0~L3 레벨 분포 칩 — 한도 강등(L0) 비율 가시화. 테마 토큰만 사용. */
function LevelDistribution({ summary }: { summary: AiCostPeriodSummary }) {
  const { colors, typography: typo } = useTheme();
  const levels: { label: string; count: number }[] = [
    { label: 'L0', count: summary.l0Count },
    { label: 'L1', count: summary.l1Count },
    { label: 'L2', count: summary.l2Count },
    { label: 'L3', count: summary.l3Count },
  ];
  return (
    <View style={styles.levelRow}>
      {levels.map((lv) => (
        <View
          key={lv.label}
          style={[styles.levelChip, { backgroundColor: colors.borderLight }]}
          accessibilityLabel={`${lv.label} ${lv.count}건`}
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            style={[typo.small, { color: colors.textSecondary, flexShrink: 1, minWidth: 0 }]}
            ellipsizeMode="tail"
          >
            {lv.label}
          </Text>
          <Text style={[typo.caption, { color: colors.text }]}>{lv.count}</Text>
        </View>
      ))}
    </View>
  );
}

/** 일/월 비용 추이 카드 (GET /ai-cost/daily·monthly). */
function PeriodCostCard({
  title,
  summary,
  status,
}: {
  title: string;
  summary?: AiCostPeriodSummary;
  status: 'loading' | 'error' | 'empty' | 'ok';
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={[styles.subCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.xs }]}>
        {title}
      </Text>
      {status !== 'ok' || !summary ? (
        <SectionStatus status={status === 'ok' ? 'empty' : status} />
      ) : (
        <>
          <View style={styles.subCardHeader}>
            <Text style={[typo.h3, { color: colors.primary }]}>
              {formatUsd(summary.totalCostUsd)}
            </Text>
            <Text style={[typo.caption, { color: colors.textSecondary }]}>
              {summary.callCount}건 · {formatKrw(summary.totalCostUsd)} 추정
            </Text>
          </View>
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            L0(분석 안 함) 비율 {formatPct(summary.l0Ratio)}
          </Text>
          <LevelDistribution summary={summary} />
        </>
      )}
    </View>
  );
}

/** 한도 소진율 카드 (GET /ai-cost/limit-status). */
function LimitStatusCard({
  status,
  state,
}: {
  status?: AiCostLimitStatus;
  state: 'loading' | 'error' | 'empty' | 'ok';
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.monitorCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.monitorHeader}>
        <Feather name="shield" size={16} color={colors.primary} />
        <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.xs }]}>
          한도 소진율
        </Text>
      </View>
      {state !== 'ok' || !status ? (
        <SectionStatus status={state === 'ok' ? 'empty' : state} />
      ) : (
        <>
          <LimitUsageBar
            label="일 한도"
            usedUsd={status.dailyCostUsd}
            limitUsd={status.dailyLimitUsd}
            ratio={status.dailyLimitUsd > 0 ? status.dailyCostUsd / status.dailyLimitUsd : 0}
          />
          <LimitUsageBar
            label="월 한도"
            usedUsd={status.monthlyCostUsd}
            limitUsd={status.monthlyLimitUsd}
            ratio={status.monthlyLimitUsd > 0 ? status.monthlyCostUsd / status.monthlyLimitUsd : 0}
          />
          {status.forcedLevel ? (
            <Text
              style={[typo.small, { color: colors.error, marginTop: spacing.sm }]}
              accessibilityLabel={`한도 초과로 AI 레벨 ${status.forcedLevel} 강등됨`}
            >
              ⚠ 한도 초과 — AI {status.forcedLevel} 강등 (신규 분석 차단)
            </Text>
          ) : (
            <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
              한도 내 정상 운영 중
            </Text>
          )}
        </>
      )}
    </View>
  );
}

/** 단위비용 카드 (GET /ai-cost/cross-engine) — 공시/신호/거래당 KRW 비용. */
function CrossEngineCard({
  metrics,
  state,
}: {
  metrics?: AiCrossEngineMetrics;
  state: 'loading' | 'error' | 'empty' | 'ok';
}) {
  const { colors, typography: typo } = useTheme();
  const rows: { label: string; value: number }[] = metrics
    ? [
        { label: '공시당 비용', value: metrics.costPerDisclosure },
        { label: '신호당 비용', value: metrics.costPerSignal },
        { label: '거래당 비용', value: metrics.costPerTrade },
      ]
    : [];
  return (
    <View style={[styles.subCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        단위비용 (AI 비용 / 산출물)
      </Text>
      {state !== 'ok' || !metrics ? (
        <SectionStatus status={state === 'ok' ? 'empty' : state} />
      ) : (
        rows.map((row, idx) => (
          <View
            key={row.label}
            style={[
              styles.unitRow,
              idx > 0 && styles.unitRowDivider,
              idx > 0 && { borderTopColor: colors.borderLight },
            ]}
            accessibilityLabel={`${row.label} ${row.value > 0 ? formatKrwValue(row.value) : '표본 없음'}`}
          >
            <Text style={[typo.bodyMedium, { color: colors.text }]}>{row.label}</Text>
            <Text
              style={[
                typo.bodyMedium,
                { color: row.value > 0 ? colors.primary : colors.textTertiary },
              ]}
            >
              {row.value > 0 ? formatKrwValue(row.value) : '표본 없음'}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}

function toState(
  isLoading: boolean,
  isError: boolean,
  hasData: boolean,
): 'loading' | 'error' | 'empty' | 'ok' {
  if (isLoading) return 'loading';
  if (isError) return 'error';
  return hasData ? 'ok' : 'empty';
}

/**
 * 사용자용 요약 카드 (D6) — 이번 달 AI 비용 1줄 + 한도 게이지 1개 + 평이어 설명.
 * 운영자급 상세는 '고급' 접기로 분리하고, 기본 화면은 이 카드만 노출한다.
 */
function SummaryCard({
  totalCostUsd,
  monthGauge,
}: {
  totalCostUsd: number;
  monthGauge: { usedUsd: number; limitUsd: number; ratio: number } | null;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.summaryCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.caption, { color: colors.textSecondary }]}>이번 달 AI 비용</Text>
      <Text
        style={[typo.amount, { color: colors.primary, marginTop: spacing.xs }]}
        accessibilityLabel={`이번 달 AI 비용 약 ${formatKrw(totalCostUsd)}`}
      >
        {formatKrw(totalCostUsd)}
      </Text>
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        ≈ {formatUsd(totalCostUsd)} · 1 USD = {USD_TO_KRW}원 기준 추정
      </Text>
      <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
        AI가 공시를 분석하는 데 든 비용입니다.
      </Text>
      {monthGauge && (
        <>
          <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
          <LimitUsageBar
            label="이번 달 한도"
            usedUsd={monthGauge.usedUsd}
            limitUsd={monthGauge.limitUsd}
            ratio={monthGauge.ratio}
          />
          <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
            한도에 가까워지면 분석이 자동으로 절약 모드로 전환돼 비용이 억제됩니다.
          </Text>
        </>
      )}
    </View>
  );
}

/** 고급/거버넌스 접기 토글 (D6) — 운영 상세 블록을 기본 숨김으로 분리. */
function AdvancedToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { colors, typography: typo } = useTheme();
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={[
        styles.advancedToggle,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`고급 · 운영/거버넌스 상세 ${open ? '접기' : '펼치기'}`}
    >
      <Feather name="sliders" size={16} color={colors.textSecondary} />
      <Text style={[typo.bodyMedium, styles.advancedToggleLabel, { color: colors.text }]}>
        고급 · 운영/거버넌스
      </Text>
      <Feather name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

/** 고급 섹션 용어 안내 (D6) — 내부용어를 평이어 1줄로 설명. */
function TermGuide() {
  const { colors, typography: typo } = useTheme();
  const items: string[] = [
    'L0~L3: AI 분석 깊이 단계 (L0=분석 안 함, L3=가장 상세)',
    '건당 비용: 공시 1건을 분석하는 데 드는 평균 비용',
    '강등: 한도를 넘으면 더 저렴한 단계로 자동 전환되는 것',
    '단위경제: 공시·신호·거래 하나를 만드는 데 든 AI 비용',
  ];
  return (
    <View
      style={[styles.termGuide, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.text, marginBottom: spacing.xs }]}>
        용어 안내
      </Text>
      {items.map((t) => (
        <Text key={t} style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          · {t}
        </Text>
      ))}
    </View>
  );
}

export default function AiCostScreen() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, refetch } = useAiCostMetrics();
  const { data: health, refetch: refetchHealth } = useAiCostHealth();

  // D6 고급/거버넌스 블록은 기본 접힘.
  // DAR-471: 지연 로딩 — 펼칠 때만(enabled: advancedOpen) 일·월·한도·교차엔진 4쿼리를 발화. 접힘 상태 네트워크 0건.
  //   (enabled 게이트보다 먼저 선언 — TDZ 회피.) 요약 게이지는 useAiCostHealth(상시)가 1차 소스라 회귀 없음.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const daily = useAiCostDaily(undefined, { enabled: advancedOpen });
  const monthly = useAiCostMonthly(undefined, undefined, { enabled: advancedOpen });
  const limitStatus = useAiCostLimitStatus({ enabled: advancedOpen });
  const crossEngine = useAiCostCrossEngine(undefined, undefined, { enabled: advancedOpen });

  const [refreshing, setRefreshing] = useState(false);

  // 당겨서 새로고침 (D15) — 6개 쿼리 동시 refetch. RN 코어 RefreshControl만 사용.
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        refetchHealth(),
        daily.refetch(),
        monthly.refetch(),
        limitStatus.refetch(),
        crossEngine.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchHealth, daily, monthly, limitStatus, crossEngine]);

  const taskEntries = data
    ? Object.entries(data.byTask).sort((a, b) => b[1].costUsd - a[1].costUsd)
    : [];

  // 사용자 요약용 '이번 달 한도' 게이지 — health 우선, 없으면 limit-status 폴백.
  const monthGauge: { usedUsd: number; limitUsd: number; ratio: number } | null = health
    ? {
        usedUsd: health.limit.monthlyCostUsd,
        limitUsd: health.limit.monthlyLimitUsd,
        ratio: health.limitUsage.monthlyUsedRatio,
      }
    : limitStatus.data
      ? {
          usedUsd: limitStatus.data.monthlyCostUsd,
          limitUsd: limitStatus.data.monthlyLimitUsd,
          ratio:
            limitStatus.data.monthlyLimitUsd > 0
              ? limitStatus.data.monthlyCostUsd / limitStatus.data.monthlyLimitUsd
              : 0,
        }
      : null;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="AI 비용" onBack={() => router.back()} />

      {isLoading ? (
        <LoadingState message="비용 데이터를 불러오는 중..." />
      ) : isError ? (
        <ErrorState
          title="데이터를 불러오지 못했습니다"
          description="AI 비용 데이터를 가져오는 중 오류가 발생했습니다."
          onRetry={refetch}
        />
      ) : !data ? (
        <EmptyState {...emptyStateCopy.aiCostEmpty} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          }
        >
          {/* 집계 기간 (D15 — 원시 문자열 포맷) */}
          <Text style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.md }]}>
            집계 기간 {formatPeriodDate(data.period.from)} ~ {formatPeriodDate(data.period.to)}
          </Text>

          {/* 사용자 요약 (D6) — 이번 달 비용 1줄 + 한도 게이지 1개 */}
          <SummaryCard totalCostUsd={data.totalCostUsd} monthGauge={monthGauge} />

          {/* 고급/거버넌스 접기 (D6) — 운영 상세 블록 분리, 기본 숨김 */}
          <AdvancedToggle open={advancedOpen} onToggle={() => setAdvancedOpen((o) => !o)} />

          {advancedOpen && (
            <View style={styles.advancedBody}>
              <TermGuide />

              {/* Live monitoring card (DAR-75) */}
              {health && <MonitoringCard health={health} />}

              {/* Total cost / tokens detail */}
              <View
                style={[
                  styles.totalCard,
                  { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
              >
                <Text
                  style={[typo.caption, { color: colors.textSecondary, marginBottom: spacing.xs }]}
                >
                  총 비용 (월간)
                </Text>
                <Text style={[typo.h3, { color: colors.primary }]}>
                  {formatUsd(data.totalCostUsd)}
                </Text>
                <Text
                  style={[typo.bodyMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}
                >
                  ≈ {formatKrw(data.totalCostUsd)} 추정
                </Text>
                <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
                <View style={styles.tokenRow}>
                  <Feather name="cpu" size={14} color={colors.textTertiary} />
                  <Text
                    style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.xs }]}
                  >
                    총 토큰: {formatTokens(data.totalTokens)}
                  </Text>
                </View>
              </View>

              {/* By-task breakdown (D7 — 영문 키 → 한국어 라벨) */}
              <Text
                style={[
                  typo.h3,
                  { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
                ]}
              >
                태스크별 비용
              </Text>

              {taskEntries.length === 0 ? (
                <Text style={[typo.caption, { color: colors.textTertiary }]}>
                  태스크 데이터 없음
                </Text>
              ) : (
                taskEntries.map(([task, stat]) => (
                  <View
                    key={task}
                    style={[
                      styles.taskRow,
                      { backgroundColor: colors.surface, borderColor: colors.border },
                    ]}
                  >
                    <View style={styles.taskInfo}>
                      <Text
                        style={[typo.bodyMedium, { color: colors.text, minWidth: 0 }]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {taskLabel(task)}
                      </Text>
                      <Text
                        style={[
                          typo.caption,
                          { color: colors.textSecondary, marginTop: spacing.xs },
                        ]}
                      >
                        {formatTokens(stat.tokens)} 토큰 · {stat.count}건
                      </Text>
                    </View>
                    <View style={styles.taskCost}>
                      <Text style={[typo.bodyMedium, { color: colors.primary }]}>
                        {formatUsd(stat.costUsd)}
                      </Text>
                      <Text
                        style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}
                      >
                        {formatKrw(stat.costUsd)}
                      </Text>
                    </View>
                  </View>
                ))
              )}

              {/* 한도 소진율 (DAR-98) */}
              <Text
                style={[
                  typo.h3,
                  { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
                ]}
              >
                한도 현황
              </Text>
              <LimitStatusCard
                status={limitStatus.data}
                state={toState(limitStatus.isLoading, limitStatus.isError, !!limitStatus.data)}
              />

              {/* 일/월 비용 추이 (DAR-98) */}
              <Text
                style={[
                  typo.h3,
                  { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
                ]}
              >
                비용 추이
              </Text>
              <PeriodCostCard
                title="오늘"
                summary={daily.data}
                status={toState(daily.isLoading, daily.isError, !!daily.data)}
              />
              <PeriodCostCard
                title="이번 달"
                summary={monthly.data}
                status={toState(monthly.isLoading, monthly.isError, !!monthly.data)}
              />

              {/* 단위비용 (DAR-98) */}
              <Text
                style={[
                  typo.h3,
                  { color: colors.text, marginTop: spacing.xl, marginBottom: spacing.md },
                ]}
              >
                단위경제
              </Text>
              <CrossEngineCard
                metrics={crossEngine.data}
                state={toState(crossEngine.isLoading, crossEngine.isError, !!crossEngine.data)}
              />
            </View>
          )}

          {/* Disclaimer */}
          <Text style={[typo.small, styles.disclaimer, { color: colors.textTertiary }]}>
            * KRW 환산은 1 USD = {USD_TO_KRW} KRW 기준 추정값입니다.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  summaryCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  advancedToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: spacing.base,
    minHeight: sizing.minTouchTarget,
  },
  advancedToggleLabel: {
    flex: 1,
    marginLeft: spacing.sm,
  },
  advancedBody: {
    marginTop: spacing.lg,
  },
  termGuide: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  totalCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  monitorCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  monitorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
  },
  usageBlock: {
    marginTop: spacing.md,
  },
  usageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  usageTrack: {
    height: 6,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  usageFill: {
    height: 6,
    borderRadius: radius.sm,
  },
  divider: {
    height: 1,
    marginVertical: spacing.md,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    borderWidth: 1,
    padding: spacing.base,
    marginBottom: spacing.sm,
  },
  taskInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  taskCost: {
    alignItems: 'flex-end',
  },
  subCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  subCardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  levelRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  levelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    marginRight: spacing.sm,
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  unitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
  },
  unitRowDivider: {
    borderTopWidth: 1,
  },
  disclaimer: {
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
