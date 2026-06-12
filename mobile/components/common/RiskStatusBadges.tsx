import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import { useHaptics } from '@hooks/useHaptics';
import { InfoSheet, type InfoSheetSection } from '@components/common/InfoSheet';

import type { StockRiskStatus } from '@app-types/stock-status.types';

/**
 * 종목 위험 배지 (DAR-99) — 관리종목·거래정지·상폐위험.
 *
 * ★안전 1차 방어선(손실 회피). KRX 데이터마켓 승인 전까지 DART 공시 폴백으로 도출한
 * 근사값이므로 '근사값 (DART 공시 기반)' 라벨을 필수로 병기한다(KRX 정밀 실시간 아님 명시).
 *
 * 표시 규칙:
 *  - 거래정지   ← isHalted        (error)
 *  - 상폐위험   ← isDelistingRisk (error)
 *  - 관리종목   ← isManagement 이며 상폐위험 아님(감사의견 등) (warning)
 *  - 위험 없음 시 아무것도 렌더하지 않는다(빈상태 미표시).
 *
 * 색상 단독 의미전달 금지(접근성): 색상 + 아이콘 + 텍스트 레이블 병행.
 *
 * 비대화형 개선 (DAR-175): 배지·근사값 라벨을 탭 가능한 버튼으로 만들고, 탭 시 등급 정의와
 * "왜 근사값인지(DART 폴백 사유)"를 설명하는 정보 시트(InfoSheet)로 연결한다. 탭 시 light 햅틱.
 */

interface RiskBadge {
  key: string;
  label: string;
  icon: keyof typeof Feather.glyphMap;
  /** true = 심각(error 톤) / false = 경고(warning 톤) */
  severe: boolean;
}

function deriveBadges(status: StockRiskStatus | undefined | null): RiskBadge[] {
  if (!status) return [];
  const badges: RiskBadge[] = [];
  if (status.isHalted) {
    badges.push({ key: 'halted', label: '거래정지', icon: 'slash', severe: true });
  }
  if (status.isDelistingRisk) {
    badges.push({ key: 'delisting', label: '상폐위험', icon: 'alert-octagon', severe: true });
  }
  // 상폐위험으로 이미 표기된 관리종목은 중복 표기하지 않는다(감사의견 등 그 외 관리종목 사유만).
  if (status.isManagement && !status.isDelistingRisk) {
    badges.push({ key: 'management', label: '관리종목', icon: 'alert-triangle', severe: false });
  }
  return badges;
}

/**
 * 위험상태 접근성 요약 문자열 (DAR-99). 카드가 no-hide-descendants 로 자식 a11y 를
 * 가릴 때, 카드 자체 accessibilityLabel 에 위험을 합성하기 위한 짧은 요약. 위험 없으면 null.
 */
export function summarizeRiskStatus(status: StockRiskStatus | undefined | null): string | null {
  const badges = deriveBadges(status);
  if (badges.length === 0) return null;
  return `위험: ${badges.map((b) => b.label).join(', ')} (근사값, DART 공시 기반)`;
}

/** 정보 시트에 표시할 등급 정의(고정). 표시된 배지에 해당하는 항목만 노출한다. */
const RISK_DEFINITIONS: Record<string, InfoSheetSection> = {
  halted: {
    icon: 'slash',
    heading: '거래정지',
    body:
      '거래소가 해당 종목의 매매를 일시적으로 정지한 상태입니다. 불성실공시·관리종목 사유 발생 등으로 ' +
      '지정되며, 정지 기간에는 매수·매도가 불가합니다.',
  },
  delisting: {
    icon: 'alert-octagon',
    heading: '상폐위험(상장폐지 위험)',
    body:
      '상장폐지 기준에 해당할 가능성이 있는 종목입니다. 감사의견 거절·자본잠식·상장적격성 실질심사 대상 ' +
      '등으로 지정되며, 원금 전액 손실로 이어질 수 있어 가장 높은 주의가 필요합니다.',
  },
  management: {
    icon: 'alert-triangle',
    heading: '관리종목',
    body:
      '상장폐지 가능성이 있어 거래소가 별도로 관리하는 종목입니다. 감사의견 한정 등 사유로 지정되며, ' +
      '투자 위험이 높습니다.',
  },
};

const RISK_SHEET_FOOTNOTE =
  '이 위험 표시는 KRX 실시간 데이터가 아니라 DART 전자공시를 기반으로 도출한 근사값입니다. ' +
  '공시 접수 시점과 실제 지정·해제 시점 사이에 차이가 있을 수 있으니, 매매 전 거래소·증권사 ' +
  '공식 정보로 반드시 확인하세요.';

// 배지 시각 높이(터치 영역 보정용). paddingVertical*2 + 텍스트 라인높이 근사치.
const BADGE_HEIGHT = 28;
const BADGE_COMPACT_HEIGHT = 20;
const APPROX_ROW_HEIGHT = 18;

interface RiskStatusBadgesProps {
  status: StockRiskStatus | undefined | null;
  /** 카드 인라인용 압축 모드(작은 배지·짧은 라벨). 기본 false(상세 화면). */
  compact?: boolean;
  style?: object;
}

export function RiskStatusBadges({ status, compact = false, style }: RiskStatusBadgesProps) {
  const { colors, typography: typo } = useTheme();
  const { light } = useHaptics();
  const badges = useMemo(() => deriveBadges(status), [status]);
  const [sheetVisible, setSheetVisible] = useState(false);

  const openSheet = useCallback(() => {
    light();
    setSheetVisible(true);
  }, [light]);
  const closeSheet = useCallback(() => setSheetVisible(false), []);

  const sections = useMemo<InfoSheetSection[]>(() => {
    const tone = (severe: boolean) => (severe ? colors.error : colors.warning);
    return badges.map((b) => ({
      ...RISK_DEFINITIONS[b.key],
      iconColor: tone(b.severe),
    }));
  }, [badges, colors.error, colors.warning]);

  if (badges.length === 0) return null;

  const approxLabel = compact ? '근사값(DART)' : '근사값 (DART 공시 기반)';
  const badgeHitSlop = verticalHitSlopForHeight(compact ? BADGE_COMPACT_HEIGHT : BADGE_HEIGHT);

  return (
    <View style={[styles.container, style]}>
      <View style={styles.badgeRow}>
        {badges.map((b) => {
          const tone = b.severe ? colors.error : colors.warning;
          return (
            <TouchableOpacity
              key={b.key}
              onPress={openSheet}
              activeOpacity={0.7}
              hitSlop={badgeHitSlop}
              accessibilityRole="button"
              accessibilityLabel={`${b.label} 위험`}
              accessibilityHint="탭하면 위험 등급과 근사값 기준 설명을 봅니다"
              style={[
                styles.badge,
                compact && styles.badgeCompact,
                { backgroundColor: tone + '22', borderColor: tone },
              ]}
            >
              <Feather name={b.icon} size={compact ? 11 : 13} color={tone} />
              <Text
                style={[
                  compact ? typo.small : typo.captionMedium,
                  { color: tone, fontWeight: '700', marginLeft: spacing.xs },
                ]}
              >
                {b.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ★근사값 라벨 필수 — KRX 정밀 실시간 아님(DART 공시 기반 도출). 탭 시 '왜 근사값인지' 설명. */}
      <TouchableOpacity
        onPress={openSheet}
        activeOpacity={0.7}
        hitSlop={verticalHitSlopForHeight(APPROX_ROW_HEIGHT)}
        accessibilityRole="button"
        accessibilityLabel="근사값(DART 공시 기반) 안내"
        accessibilityHint="탭하면 위험 등급 정의와 근사값인 이유를 봅니다"
        style={styles.approxRow}
      >
        <Feather name="info" size={compact ? 10 : 12} color={colors.textTertiary} />
        <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs, flex: 1 }]}>
          {approxLabel}
        </Text>
        <Feather name="chevron-right" size={compact ? 12 : 14} color={colors.textTertiary} />
      </TouchableOpacity>

      <InfoSheet
        visible={sheetVisible}
        onClose={closeSheet}
        title="위험 등급 안내"
        sections={sections}
        footnote={RISK_SHEET_FOOTNOTE}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  badgeCompact: {
    paddingHorizontal: spacing.xs + 2,
    paddingVertical: 2,
  },
  approxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
