import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { pnlColor, formatPnlPercent } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatYmdDots } from '@utils/datetime';

import type {
  TodayBriefing,
  BriefingEventItem,
  BriefingCheckItem,
} from '@app-types/portfolio.types';

import type { ThemeColors } from '@theme';

/**
 * 오늘의 브리핑 (W14) — LLM $0 룰 기반 결합 표면.
 *
 * `GET /portfolio/briefing/today` 소비. 수치·문구 전부 서버 룰 렌더링(신규 AI 호출 0).
 * 렌더 섹션: 당일 이벤트(공시 상세 딥링크) · 일간 손익 · 점검 필요 포지션(포지션 상세 딥링크).
 *  - risk 섹션은 요약 카드의 PortfolioRiskBadge 가 이미 전담하므로 여기서 그리지 않는다(중복 금지).
 *  - 점검 섹션이 그려질 때 부모는 TodayCheckSlot 토글을 숨긴다(통합 — 같은 소스 이중 노출 방지).
 * 0건 억제: 섹션별 null 은 생략, 표시할 섹션이 하나도 없으면 아무것도 렌더하지 않는다
 * (TodayCheckSlot.tsx:116 의 0건 억제 패턴 준수).
 *
 * ★읽기 전용 표시 컴포넌트 — 매매·체결 경로 무접촉.
 */

interface TodayBriefingSectionProps {
  briefing: TodayBriefing | null | undefined;
}

/** 극성 → 시각 톤(색상 단독 의미전달 금지 — 이벤트 라벨 텍스트를 항상 동반). */
function polarityColor(polarity: string, colors: ThemeColors): string {
  if (polarity === 'POSITIVE') return colors.success;
  if (polarity === 'NEGATIVE') return colors.error;
  return colors.textTertiary;
}

/** 부호 포함 원화 표기 — 포트폴리오 손익 헤드라인과 동일 부호 규약(양수만 '+', -0 정규화). */
function formatSignedKrw(amount: number): string {
  const rounded = Math.round(amount);
  const display = rounded === 0 ? 0 : rounded;
  return `${display > 0 ? '+' : ''}${display.toLocaleString()}원`;
}

export function TodayBriefingSection({ briefing }: TodayBriefingSectionProps) {
  const { colors, typography: typo } = useTheme();

  const handleEventPress = useCallback((item: BriefingEventItem) => {
    router.push(`/disclosure/${item.rcpNo}`);
  }, []);

  const handleCheckPress = useCallback((item: BriefingCheckItem) => {
    router.push(`/portfolio/${item.portfolioId}/position/${item.positionId}`);
  }, []);

  // 0건 억제(TodayCheckSlot:116 패턴) — 브리핑 자체가 null 이거나,
  // 이 컴포넌트가 그리는 섹션(이벤트·손익·점검)이 전부 null 이면 렌더하지 않는다.
  if (!briefing) return null;
  const { events, dailyPnl, checks } = briefing;
  if (!events && !dailyPnl && !checks) return null;

  return (
    <Surface
      elevation={1}
      style={[styles.container, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Feather name="sunrise" size={sizing.icon.sm} color={colors.primary} />
          <Text style={[typo.bodyMedium, styles.headerTitle, { color: colors.text }]}>
            오늘의 브리핑
          </Text>
        </View>
        {/* freshness 정직 표기 — 서버가 조립한 KST 기준일. */}
        <Text style={[typo.small, { color: colors.textTertiary }]}>{briefing.dateKst} 기준</Text>
      </View>

      {/* (b) 일간 손익 — 기준 거래일 동반(스냅샷이 전일이면 전일임이 드러난다). */}
      {dailyPnl ? (
        <View
          style={styles.pnlRow}
          accessibilityRole="text"
          accessibilityLabel={`일간 손익 ${formatSignedKrw(dailyPnl.dailyPnl)}${
            dailyPnl.dailyPnlPct != null ? `, ${formatPnlPercent(dailyPnl.dailyPnlPct)}` : ''
          }, 기준일 ${formatYmdDots(dailyPnl.snapshotDate)}`}
        >
          <Feather
            name={dailyPnl.dailyPnl < 0 ? 'trending-down' : 'trending-up'}
            size={sizing.icon.sm}
            color={pnlColor(dailyPnl.dailyPnl, colors)}
          />
          <Text style={[typo.captionMedium, styles.pnlText, { color: pnlColor(dailyPnl.dailyPnl, colors) }]}>
            일간 손익 {formatSignedKrw(dailyPnl.dailyPnl)}
            {dailyPnl.dailyPnlPct != null ? ` (${formatPnlPercent(dailyPnl.dailyPnlPct)})` : ''}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {formatYmdDots(dailyPnl.snapshotDate)} 기준
          </Text>
        </View>
      ) : null}

      {/* (a) 내 종목 당일 공시 이벤트 — 항목별 공시 상세 딥링크. */}
      {events ? (
        <View style={styles.section}>
          <Text style={[typo.small, styles.sectionLabel, { color: colors.textSecondary }]}>
            내 종목 오늘 공시 {events.length}건
          </Text>
          {events.map((item) => (
            <TouchableOpacity
              key={item.rcpNo}
              onPress={() => handleEventPress(item)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${item.corpName} ${getEventTypeLabel(item.eventType)} 공시 상세 보기`}
              style={[styles.itemRow, { borderColor: colors.borderLight }]}
            >
              <View style={[styles.polarityDot, { backgroundColor: polarityColor(item.polarity, colors) }]} />
              <View style={styles.itemBody}>
                <View style={styles.itemTitleRow}>
                  <Text style={[typo.captionMedium, styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                    {item.corpName}
                  </Text>
                  <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
                    {getEventTypeLabel(item.eventType)}
                    {item.source === 'POSITION' ? ' · 보유' : ' · 관심'}
                  </Text>
                </View>
                {/* 캐시된 AI 요약 1줄(없으면 보고서명 폴백 — 결측을 요약처럼 위장하지 않게 원문 제목 그대로). */}
                <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.summaryLine ?? item.reportName}
                </Text>
              </View>
              <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {/* (c) 점검 필요 포지션 — 항목별 포지션 상세 딥링크(TodayCheckSlot 소스 통합 표면). */}
      {checks ? (
        <View style={styles.section}>
          <Text style={[typo.small, styles.sectionLabel, { color: colors.textSecondary }]}>
            점검 필요 포지션 {checks.length}건
          </Text>
          {checks.map((item) => (
            <TouchableOpacity
              key={item.positionId}
              onPress={() => handleCheckPress(item)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`${item.corpName} ${item.reason} 포지션 상세 보기`}
              style={[styles.itemRow, { borderColor: colors.borderLight }]}
            >
              <Feather
                name="alert-circle"
                size={sizing.icon.sm}
                color={item.thesisStatus === 'VIOLATED' ? colors.error : colors.warning}
              />
              <View style={styles.itemBody}>
                <Text style={[typo.captionMedium, styles.itemTitle, { color: colors.text }]} numberOfLines={1}>
                  {item.corpName}
                </Text>
                <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.reason}
                </Text>
              </View>
              <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  headerTitle: {
    fontWeight: '700',
  },
  pnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  pnlText: {
    fontWeight: '700',
    flexShrink: 1,
  },
  section: {
    gap: spacing.xs,
  },
  sectionLabel: {
    fontWeight: '600',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: sizing.minTouchTarget,
  },
  // 극성 점 지오메트리 — spacing.sm(8) 재사용(매직넘버 금지, 시각 크기 8pt).
  polarityDot: {
    width: spacing.sm,
    height: spacing.sm,
    borderRadius: radius.full,
  },
  itemBody: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  itemTitle: {
    flexShrink: 1,
  },
});
