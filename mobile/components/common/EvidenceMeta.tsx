import React from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { confidenceLevel, type ConfidenceTone } from '@utils/confidenceLevel';
import { DataLimitBadge } from '@components/common/DataLimitBadge';

// 점수·적합도 '근거·표본·신뢰도' 강제 동반 표시 규약(DAR-56, 과신 방지).
// 백엔드가 이미 제공하는 sampleN·evaluatedCount/omittedMetricKeys·confidence·isAiAssisted를
// 화면마다 제각각 그리지 않도록 통일한다. 규약:
//  - 단정 표현 금지: '표본 N' 같은 중립 사실만, '상승 M건' 식 raw 단정 금지.
//  - 색 단독 의미 금지: 모든 행은 Feather 아이콘(형태) + 평문 텍스트 병기.
//  - 맨퍼센트 금지: AI confidence는 높음/보통/낮음 3단계 평문 + 'AI 자기보고 한계' 주석.
//  - isAiAssisted=false면 'AI'가 아닌 '규칙 분류'로 표기(과신 차단).

/** 통계 근거 표본 — '표본 N거래일'·'표본 N건' 중립 표기. */
export interface EvidenceSample {
  n: number;
  /** 표본 단위(기본 '건'). eventStudy 등 거래일 표본은 '거래일'. */
  unit?: '거래일' | '건';
  /**
   * 표본 스코프 평문 라벨(예: '대규모 공급계약(전체시장)') — 존재 시 '표본 N건 · 라벨'로 병기.
   * 백엔드 sampleScope(후속 옵셔널 필드) 방어적 지원: 미존재 시 현행 '표본 N건' 표기 유지.
   */
  scopeLabel?: string;
}

/** 지표 평가 커버리지 — 'N개 지표 중 M개 평가' + 결측 지표 명시. */
export interface EvidenceCoverage {
  evaluated: number;
  total: number;
  /** 결측(분모 제외) 지표 평문 라벨 목록. 있으면 별도 줄로 명시. */
  omittedLabels?: string[];
}

/** AI 자기보고 신뢰도 — 3단계 평문 + 한계 주석. isAiAssisted=false면 규칙 분류. */
export interface EvidenceAi {
  /** 0~1 */
  confidence: number;
  isAiAssisted: boolean;
}

interface EvidenceMetaProps {
  sample?: EvidenceSample;
  coverage?: EvidenceCoverage;
  ai?: EvidenceAi;
  /**
   * 데이터 한계 배지 노출(DAR-121 §6, opt-in). true 일 때만 '데이터 한계' 배지를 동반한다.
   * 판정(표본<30·미유의)은 호출부가 isDataLimited 로 계산해 넘긴다(기존 호출부 기본 동작 불변).
   */
  dataLimit?: boolean;
  /**
   * 표본 결측 시 동일 지오메트리로 렌더할 정직 결측 행 텍스트(예: '표본 통계 없음', textTertiary).
   * 슬롯 상시 렌더가 필요한 카드(카루셀 균일 높이)에서 opt-in — 미지정 시 기존처럼 행 생략.
   */
  sampleFallback?: string;
  /** 한 줄 압축 표기(true) vs 줄바꿈 허용(false, 기본). */
  compact?: boolean;
  style?: ViewStyle;
}

function toneColor(tone: ConfidenceTone, colors: ReturnType<typeof useTheme>['colors']): string {
  if (tone === 'high') return colors.success;
  if (tone === 'low') return colors.warning;
  return colors.textSecondary;
}

interface MetaRowProps {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  textColor: string;
  text: string;
  /** 보조 주석(작고 흐린 텍스트, 같은 줄 뒤). */
  note?: string;
  /** 보조 주석 최대 줄수(기본 2). 행 높이 균일이 필요한 표본 스코프 병기는 1로 고정. */
  noteLines?: number;
  accessibilityLabel: string;
}

function MetaRow({ icon, iconColor, textColor, text, note, noteLines = 2, accessibilityLabel }: MetaRowProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.row} accessibilityLabel={accessibilityLabel}>
      <Feather name={icon} size={12} color={iconColor} />
      <Text style={[typo.small, { color: textColor }]}>{text}</Text>
      {note ? (
        <Text style={[typo.small, styles.note, { color: colors.textTertiary }]} numberOfLines={noteLines}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * 근거·표본·신뢰도 통일 표기. 제공된 prop만 해당 줄을 그린다(모두 없으면 null).
 */
export function EvidenceMeta({
  sample,
  coverage,
  ai,
  dataLimit,
  sampleFallback,
  compact = false,
  style,
}: EvidenceMetaProps) {
  const { colors } = useTheme();

  const rows: React.ReactNode[] = [];

  // 데이터 한계 배지(DAR-121 §6) — opt-in. 호출부가 dataLimit=true 로 명시할 때만 노출.
  const showDataLimit = dataLimit === true;

  if (sample && Number.isFinite(sample.n)) {
    const unit = sample.unit ?? '건';
    // 천단위 구분(ko-KR) — '표본 1,871건' 표기. scopeLabel 존재 시 '· 라벨' 병기(1줄 고정).
    const countText = `표본 ${sample.n.toLocaleString('ko-KR')}${unit}`;
    rows.push(
      <MetaRow
        key="sample"
        icon="bar-chart-2"
        iconColor={colors.textSecondary}
        textColor={colors.textSecondary}
        text={countText}
        note={sample.scopeLabel ? `· ${sample.scopeLabel}` : undefined}
        noteLines={1}
        accessibilityLabel={`통계 근거 ${countText}${sample.scopeLabel ? `, ${sample.scopeLabel} 기준` : ''}`}
      />,
    );
  } else if (sampleFallback) {
    // 정직 결측 표기(DAR-56 규약): 표본이 없으면 없다고 말한다 — 동일 행 지오메트리(슬롯 유지).
    rows.push(
      <MetaRow
        key="sample-missing"
        icon="bar-chart-2"
        iconColor={colors.textTertiary}
        textColor={colors.textTertiary}
        text={sampleFallback}
        accessibilityLabel={sampleFallback}
      />,
    );
  }

  if (coverage && Number.isFinite(coverage.total)) {
    rows.push(
      <MetaRow
        key="coverage"
        icon="check-square"
        iconColor={colors.textSecondary}
        textColor={colors.textSecondary}
        text={`${coverage.total}개 지표 중 ${coverage.evaluated}개 평가`}
        accessibilityLabel={`총 ${coverage.total}개 지표 중 ${coverage.evaluated}개 평가됨`}
      />,
    );
    if (coverage.omittedLabels && coverage.omittedLabels.length > 0) {
      rows.push(
        <MetaRow
          key="omitted"
          icon="minus-circle"
          iconColor={colors.textTertiary}
          textColor={colors.textTertiary}
          text={`결측 제외: ${coverage.omittedLabels.join(', ')}`}
          accessibilityLabel={`결측으로 분모에서 제외된 지표: ${coverage.omittedLabels.join(', ')}`}
        />,
      );
    }
  }

  if (ai) {
    if (ai.isAiAssisted) {
      const level = confidenceLevel(ai.confidence);
      rows.push(
        <MetaRow
          key="ai"
          icon={level.icon}
          iconColor={toneColor(level.tone, colors)}
          textColor={toneColor(level.tone, colors)}
          text={`AI 신뢰도 ${level.label}`}
          note="· AI 자기보고 한계"
          accessibilityLabel={`AI 자기보고 신뢰도 ${level.label}. AI 자기보고 값으로 한계가 있습니다.`}
        />,
      );
    } else {
      rows.push(
        <MetaRow
          key="rule"
          icon="filter"
          iconColor={colors.textSecondary}
          textColor={colors.textSecondary}
          text="규칙 분류"
          note="· AI 아님"
          accessibilityLabel="AI가 아닌 규칙 기반 분류입니다."
        />,
      );
    }
  }

  if (showDataLimit) {
    rows.unshift(
      <DataLimitBadge
        key="data-limit"
        sampleCount={sample && Number.isFinite(sample.n) ? sample.n : undefined}
      />,
    );
  }

  if (rows.length === 0) return null;

  return <View style={[compact ? styles.compact : styles.stack, style]}>{rows}</View>;
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.xs,
  },
  compact: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  note: {
    // 긴 스코프 병기('· 대규모 공급계약(전체시장)')가 행을 밀어내지 않고 말줄임되도록.
    flexShrink: 1,
  },
});
