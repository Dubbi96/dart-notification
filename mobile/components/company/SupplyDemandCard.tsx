import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { useInvestorFlow, useShortSelling } from '@hooks/useInvestorFlow';
import { returnColor } from '@utils/numberFormat';

import type { InvestorFlowSummary } from '@app-types/investor-flow.types';

// 갭분석 W16 ④: 종목 차트 화면 '수급 요약' 카드.
// 외국인·기관 5/20일 누적 순매수(금액) + 공매도 지표 + '데이터 기준일' 배지(stale 숨김 금지).
// 정직 계약:
//  - 데이터 없으면(asOfDate=null 양쪽) 카드 자체를 그리지 않는다(억지 표기 금지 — 스펙 '카드 억제').
//  - 축적이 5/20일 미만이면 '(축적 N일)' 로 실제 창 길이를 고지한다(window*dDays).
//  - 공매도 잔고비율은 무료 소스 미가용(null) — 대신 '공매도 거래비중(최근일)'을 기준 명시와 함께
//    표기하고, 잔고비율이 생기면 그 값을 우선 노출한다(합성·과장 금지).
//  - 색 단독 의미 금지: 부호(+/-)를 항상 병기(returnColor 는 보조).
// SHADOW 불가침: 표면 전용 데이터 — 점수·매매와 무관(참고 정보).

interface SupplyDemandCardProps {
  /** 종목코드 6자리. 형식 위반이면 훅이 자동 비활성 — 카드 미표시. */
  stockCode: string;
}

const EOK = 1_0000_0000; // 억 (1e8)
const JO = 1_0000_0000_0000; // 조 (1e12)

/** 원 → 부호 포함 조/억 압축 표기(수급 누적 금액용). |값|<0.05억은 '0억원'(보합 취급). */
function formatSignedKrwCompact(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= JO) {
    const jo = abs / JO;
    return `${sign}${jo.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}조원`;
  }
  const eok = abs / EOK;
  const digits = abs >= 10 * EOK ? 0 : 1;
  return `${sign}${eok.toLocaleString('ko-KR', { maximumFractionDigits: digits })}억원`;
}

/** YYYYMMDD → YYYY.MM.DD (배지 표기). 형식 위반은 원문 유지(정직). */
function formatYmdDot(ymd: string): string {
  if (!/^\d{8}$/.test(ymd)) return ymd;
  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}

interface FlowLineProps {
  label: string;
  amount5d: number;
  amount20d: number;
  summary: InvestorFlowSummary;
}

function FlowLine({ label, amount5d, amount20d, summary }: FlowLineProps) {
  const { colors, typography: typo } = useTheme();
  // returnColor 는 표시 반올림 후 부호로 색을 정한다 — 억 단위로 환산해 전달(보합=중립색).
  const color5d = returnColor(amount5d / EOK, colors, { digits: 1 });
  const color20d = returnColor(amount20d / EOK, colors, { digits: 1 });
  const partial5 = summary.window5dDays < 5 ? ` (축적 ${summary.window5dDays}일)` : '';
  const partial20 = summary.window20dDays < 20 ? ` (축적 ${summary.window20dDays}일)` : '';
  return (
    <View style={styles.flowLine}>
      <Text style={[typo.bodyMedium, { color: colors.text }]}>{label}</Text>
      <View style={styles.flowValues}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          5일{' '}
          <Text style={[typo.bodyMedium, { color: color5d }]}>
            {formatSignedKrwCompact(amount5d)}
          </Text>
          {partial5}
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          20일{' '}
          <Text style={[typo.bodyMedium, { color: color20d }]}>
            {formatSignedKrwCompact(amount20d)}
          </Text>
          {partial20}
        </Text>
      </View>
    </View>
  );
}

export function SupplyDemandCard({ stockCode }: SupplyDemandCardProps) {
  const { colors, typography: typo } = useTheme();
  const { data: flow } = useInvestorFlow(stockCode);
  const { data: shortSelling } = useShortSelling(stockCode);

  const hasFlow = Boolean(flow?.asOfDate && flow.summary);
  const latestShort = shortSelling?.asOfDate
    ? (shortSelling.rows[shortSelling.rows.length - 1] ?? null)
    : null;

  // 데이터 없으면 카드 억제(로딩 포함 — 도착 후 자연 등장, 스켈레톤 억지 표기 금지).
  if (!hasFlow && !latestShort) return null;

  // 데이터 기준일 — 두 축 중 더 최신 거래일(stale 숨김 금지, 항상 표기).
  const asOfCandidates = [flow?.asOfDate, shortSelling?.asOfDate].filter(
    (d): d is string => Boolean(d),
  );
  const sortedAsOf = [...asOfCandidates].sort();
  const asOfDate = sortedAsOf.length > 0 ? sortedAsOf[sortedAsOf.length - 1] : '';

  // 공매도 표기: 잔고비율(소스 확보 시) 우선, 미가용이면 최근일 거래비중을 기준 명시와 함께.
  const shortLabel =
    latestShort?.shortBalanceRatio != null
      ? { label: '공매도 잔고비율', value: `${latestShort.shortBalanceRatio.toFixed(2)}%` }
      : latestShort?.shortVolumeRatio != null
        ? { label: '공매도 거래비중(최근일)', value: `${latestShort.shortVolumeRatio.toFixed(2)}%` }
        : null;

  return (
    <Card style={styles.card} variant="elevated">
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Feather name="bar-chart-2" size={sizing.icon.sm} color={colors.primary} />
          <Text style={[typo.h3, styles.title, { color: colors.text }]}>수급 요약</Text>
        </View>
        {asOfDate ? (
          <View
            style={[
              styles.asOfBadge,
              { backgroundColor: colors.surface, borderColor: colors.borderLight },
            ]}
            accessibilityLabel={`데이터 기준일 ${formatYmdDot(asOfDate)}`}
          >
            <Text style={[typo.caption, { color: colors.textSecondary }]}>
              데이터 기준일 {formatYmdDot(asOfDate)}
            </Text>
          </View>
        ) : null}
      </View>

      {hasFlow && flow?.summary ? (
        <View style={styles.flows}>
          <FlowLine
            label="외국인 순매수"
            amount5d={flow.summary.foreignNet5dAmount}
            amount20d={flow.summary.foreignNet20dAmount}
            summary={flow.summary}
          />
          <FlowLine
            label="기관 순매수"
            amount5d={flow.summary.institutionNet5dAmount}
            amount20d={flow.summary.institutionNet20dAmount}
            summary={flow.summary}
          />
        </View>
      ) : null}

      {shortLabel ? (
        <View style={[styles.shortRow, { borderTopColor: colors.borderLight }]}>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>{shortLabel.label}</Text>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>{shortLabel.value}</Text>
        </View>
      ) : null}

      <Text style={[typo.caption, styles.footnote, { color: colors.textTertiary }]}>
        투자자별 순매수·공매도는 장 마감 후 집계 데이터입니다 (참고용 · 매매 판단 아님)
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  title: {
    marginLeft: spacing.xs,
  },
  asOfBadge: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  flows: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  flowLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  flowValues: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  shortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  footnote: {
    marginTop: spacing.md,
  },
});
