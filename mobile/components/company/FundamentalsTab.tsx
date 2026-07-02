import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { useFinancials } from '@hooks/useFinancials';

import type { FinancialSnapshot } from '@app-types/financial.types';

// 종목 상세 '재무' 펀더멘털 카드 — DAR-96.
// 월간 크론(DAR-55)이 적재한 CompanyFinancial 스냅샷을 GET /financials/latest 로 노출한다.
// 매출·영업이익·순이익·부채비율·ROE 등 + 사업연도/연결구분, DAR-93 성장률(YoY) 추이.
// 거장 적합도 점수의 펀더멘털 근거를 사용자가 직접 검증하도록 한다. 참고용(면책).

interface FundamentalsTabProps {
  corpCode: string;
  corpName: string;
}

const REPRT_LABEL: Record<string, string> = {
  '11011': '연간',
  '11012': '반기',
  '11013': '1분기',
  '11014': '3분기',
};

const FS_DIV_LABEL: Record<string, string> = {
  CFS: '연결',
  OFS: '별도',
};

/** 원 단위 금액 → 조·억 한글 단위. 음수/0 처리. */
function formatAmount(value: number | null): string {
  if (value == null) return '-';
  const neg = value < 0;
  const abs = Math.abs(value);
  const JO = 1_0000_0000_0000; // 1조
  const EOK = 1_0000_0000; // 1억
  let out: string;
  if (abs >= JO) {
    const jo = Math.floor(abs / JO);
    const eok = Math.round((abs % JO) / EOK);
    out = eok > 0 ? `${jo.toLocaleString()}조 ${eok.toLocaleString()}억` : `${jo.toLocaleString()}조`;
  } else if (abs >= EOK) {
    out = `${Math.round(abs / EOK).toLocaleString()}억`;
  } else if (abs >= 1_0000) {
    out = `${Math.round(abs / 1_0000).toLocaleString()}만`;
  } else {
    out = abs.toLocaleString();
  }
  return neg ? `-${out}` : out;
}

function formatPct(value: number | null, digits = 1): string {
  if (value == null) return '-';
  return `${value.toFixed(digits)}%`;
}

function formatNumber(value: number | null, digits = 0): string {
  if (value == null) return '-';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 증감률(%) 부호 칩. 0/결측은 렌더링하지 않음. */
function GrowthChip({ value }: { value: number | null }) {
  const { colors, typography: typo } = useTheme();
  if (value == null || value === 0) return null;
  const up = value > 0;
  const color = up ? colors.success : colors.error;
  const sign = up ? '+' : '';
  return (
    <View
      style={styles.growthChip}
      accessibilityLabel={`전년 대비 ${up ? '증가' : '감소'} ${Math.abs(value).toFixed(1)}%`}
    >
      <Feather name={up ? 'trending-up' : 'trending-down'} size={12} color={color} />
      <Text
        style={[typo.small, { color, marginLeft: 2, fontWeight: '600' }]}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        {sign}
        {value.toFixed(1)}% YoY
      </Text>
    </View>
  );
}

function MetricRow({
  label,
  value,
  growth,
  emphasize,
  valueColor,
  last,
}: {
  label: string;
  value: string;
  growth?: number | null;
  emphasize?: boolean;
  valueColor?: string;
  last?: boolean;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[
        styles.metricRow,
        { borderBottomColor: colors.borderLight },
        last && styles.metricRowLast,
      ]}
    >
      <Text style={[typo.body, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.metricValueWrap}>
        {growth !== undefined ? <GrowthChip value={growth} /> : null}
        <Text
          style={[
            emphasize ? typo.bodyMedium : typo.body,
            {
              color: valueColor ?? colors.text,
              fontWeight: emphasize ? '700' : '600',
              marginLeft: spacing.sm,
            },
          ]}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Card variant="elevated" style={styles.sectionCard}>
      <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

interface FundamentalContentProps {
  snap: FinancialSnapshot;
  /** [UXR-21] 같은 화면 공시·통계·적합도 탭과 동일한 pull-to-refresh 제스처. */
  refreshing: boolean;
  onRefresh: () => void;
}

function FundamentalContent({ snap, refreshing, onRefresh }: FundamentalContentProps) {
  const { colors, typography: typo } = useTheme();
  const reprtLabel = REPRT_LABEL[snap.reprtCode] ?? snap.reprtCode;
  const fsLabel = FS_DIV_LABEL[snap.fsDiv] ?? snap.fsDiv;

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[colors.primary]}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.base }]}>
        {snap.bsnsYear}년 {reprtLabel} · {fsLabel} 재무 기준
      </Text>

      <SectionCard title="손익계산서">
        <MetricRow label="매출액" value={formatAmount(snap.revenue)} growth={snap.revenueGrowthYoY} emphasize />
        <MetricRow
          label="영업이익"
          value={formatAmount(snap.operatingProfit)}
          growth={snap.operatingProfitGrowthYoY}
          valueColor={
            snap.operatingProfit == null
              ? undefined
              : snap.operatingProfit < 0
                ? colors.error
                : colors.text
          }
        />
        <MetricRow
          label="순이익"
          value={formatAmount(snap.netIncome)}
          valueColor={
            snap.netIncome == null ? undefined : snap.netIncome < 0 ? colors.error : colors.text
          }
          last
        />
      </SectionCard>

      <SectionCard title="재무비율">
        <MetricRow
          label="부채비율"
          value={formatPct(snap.debtRatio)}
          valueColor={
            snap.debtRatio == null
              ? undefined
              : snap.debtRatio >= 200
                ? colors.error
                : snap.debtRatio >= 100
                  ? colors.warning
                  : colors.success
          }
        />
        <MetricRow
          label="ROE"
          value={formatPct(snap.roe)}
          valueColor={snap.roe == null ? undefined : snap.roe < 0 ? colors.error : colors.text}
        />
        <MetricRow label="ROA" value={formatPct(snap.roa)} />
        <MetricRow label="PER" value={snap.per == null ? '-' : `${formatNumber(snap.per, 1)}배`} />
        <MetricRow label="PBR" value={snap.pbr == null ? '-' : `${formatNumber(snap.pbr, 2)}배`} last />
      </SectionCard>

      <SectionCard title="주당지표 · 재무상태">
        <MetricRow label="EPS (주당순이익)" value={snap.eps == null ? '-' : `${formatNumber(snap.eps)}원`} growth={snap.epsGrowthYoY} />
        <MetricRow label="BPS (주당순자산)" value={snap.bps == null ? '-' : `${formatNumber(snap.bps)}원`} />
        <MetricRow label="자산총계" value={formatAmount(snap.totalAssets)} />
        <MetricRow label="자본총계" value={formatAmount(snap.totalEquity)} />
        <MetricRow label="부채총계" value={formatAmount(snap.totalLiabilities)} last />
      </SectionCard>

      <DisclaimerSection style={styles.disclaimer} />
      <View style={{ height: spacing['2xl'] }} />
    </ScrollView>
  );
}

export function FundamentalsTab({ corpCode, corpName }: FundamentalsTabProps) {
  const { data, isLoading, isError, refetch, isRefetching } = useFinancials(corpCode);

  // 로딩도 화면 진입 스켈레톤(DetailSkeleton)으로 통일 — 탭 전환 시 중앙 스피너 →
  // 콘텐츠 점프를 제거(E17·DAR-467). 카드 골격은 FundamentalContent의 3개 SectionCard
  // (손익계산서 3행·재무비율 5행·주당지표 5행)을 흉내 내 로딩→콘텐츠 레이아웃을 정렬한다.
  if (isLoading)
    return <DetailSkeleton cards={[{ lines: 3 }, { lines: 5 }, { lines: 5 }]} />;
  if (isError)
    return (
      <ErrorState
        title="재무지표를 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
        onRetry={refetch}
      />
    );
  if (!data)
    return (
      <EmptyState
        icon="bar-chart-2"
        title="재무 데이터가 아직 없습니다."
        description={`${corpName}의 재무제표가 수집되면 매출·영업이익·부채비율 등 펀더멘털을 표시합니다.`}
      />
    );

  return <FundamentalContent snap={data} refreshing={isRefetching} onRefresh={refetch} />;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
  },
  sectionCard: {
    marginBottom: spacing.base,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metricRowLast: {
    borderBottomWidth: 0,
  },
  metricValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    justifyContent: 'flex-end',
  },
  growthChip: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  disclaimer: {
    marginTop: spacing.base,
  },
});
