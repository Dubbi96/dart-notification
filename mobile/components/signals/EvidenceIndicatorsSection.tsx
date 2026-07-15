import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { CollapsibleCard } from '@components/common/CollapsibleCard';

import type { SignalEvidenceIndicators } from '@app-types/signal.types';

/**
 * W13 '근거 지표 펼치기' — Buy Score 가 실제 소비한 원시 지표 수치(rsi14·volumeRatio20·
 * preDsclReturn 등)를 접기/펼치기로 노출한다. 점수의 입력 근거를 사용자가 직접 검증할 수 있게
 * 하는 투명성 표면(점수 계산 로직 무변경 — 노출만).
 * - 기본 접힘(CollapsibleCard) — 상세 화면 텍스트량 억제(DAR-123 패턴 재사용).
 * - nullable 필드는 '—' 처리(빈 값 노출 방지). 값 포맷은 지표 의미 단위(원·배·% 등) 병기.
 * - ★정직: 지표 기준 거래일(tradeDate)을 함께 고지 — 생성 시점 이전 최신 지표라는 한계를 숨기지 않는다.
 */

interface EvidenceIndicatorsSectionProps {
  indicators: SignalEvidenceIndicators;
}

/** 'YYYYMMDD' → 'YYYY.MM.DD'. 형식 불량이면 원문. */
function tradeDateLabel(tradeDate: string): string {
  if (!/^\d{8}$/.test(tradeDate)) return tradeDate;
  return `${tradeDate.slice(0, 4)}.${tradeDate.slice(4, 6)}.${tradeDate.slice(6, 8)}`;
}

/** null 은 '—'(빈 값 노출 방지), 값은 포매터 적용. */
function fmt(value: number | null, format: (v: number) => string): string {
  return value == null ? '—' : format(value);
}

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`;
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

/** 표시 행 정의 — 스코어링(StockContext)이 소비하는 지표 필드와 1:1. */
const ROWS: {
  key: keyof Omit<SignalEvidenceIndicators, 'tradeDate'>;
  label: string;
  format: (v: number) => string;
}[] = [
  { key: 'rsi14', label: 'RSI (14일)', format: (v) => v.toFixed(1) },
  { key: 'volumeRatio20', label: '거래량비율 (20일 평균 대비)', format: (v) => `${v.toFixed(2)}배` },
  { key: 'preDsclReturn', label: '공시 전 선행상승률 (D-5~D-1)', format: signedPct },
  { key: 'ma5', label: '이동평균 MA5', format: won },
  { key: 'ma20', label: '이동평균 MA20', format: won },
  { key: 'ma60', label: '이동평균 MA60', format: won },
  { key: 'macdLine', label: 'MACD 선 (12, 26)', format: (v) => v.toFixed(2) },
  { key: 'macdSignal', label: 'MACD 신호선 (9)', format: (v) => v.toFixed(2) },
  { key: 'bollingerMid', label: '볼린저 중단 (20일)', format: won },
];

function EvidenceIndicatorsSectionBase({ indicators }: EvidenceIndicatorsSectionProps) {
  const { colors, typography: typo } = useTheme();

  return (
    <CollapsibleCard
      icon="activity"
      title="근거 지표"
      summary="점수 계산에 쓰인 원시 지표 수치 펼쳐 보기"
      defaultExpanded={false}
    >
      {/* ★정직: 지표 기준 거래일 고지 — 신호 생성 시점 이전 최신 지표(스코어링 입력과 동일 규칙) */}
      <View style={styles.baseDateRow}>
        <Feather name="clock" size={12} color={colors.textTertiary} />
        <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]}>
          지표 기준일 {tradeDateLabel(indicators.tradeDate)} · 신호 생성 시점 이전 최신 지표
        </Text>
      </View>

      {ROWS.map((row) => (
        <View
          key={row.key}
          style={[styles.row, { borderBottomColor: colors.borderLight }]}
          accessibilityRole="text"
          accessibilityLabel={`${row.label}: ${fmt(indicators[row.key], row.format)}`}
        >
          <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>{row.label}</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {fmt(indicators[row.key], row.format)}
          </Text>
        </View>
      ))}

      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        값이 —인 지표는 해당 시점 데이터가 없어 점수에 반영되지 않았어요.
      </Text>
    </CollapsibleCard>
  );
}

export const EvidenceIndicatorsSection = React.memo(EvidenceIndicatorsSectionBase);

const styles = StyleSheet.create({
  baseDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
