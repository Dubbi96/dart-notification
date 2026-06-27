import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing, TouchableOpacity } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, gauge } from '@theme/spacing';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { useHaptics } from '@hooks/useHaptics';
import {
  buyScoreColor,
  exitScoreColor,
  nextCutGap,
  BUY_SCORE_CUTS,
  EXIT_SCORE_CUTS,
} from '@utils/signalDisplay';
import { SIGNAL_TERMS } from '@utils/signalTerms';
import { InfoSheet, type InfoSheetSection } from '@components/common/InfoSheet';

// 점수 게이지(기획 §3·§5·§11). RN Paper ProgressBar 위에 등급 밴드 컷 틱 + 현재값 노브를
// 얹어 "78점이 어느 등급 구간인지" 시각화한다. 색상 단독 금지 — 숫자·캡션 병행.
//
// DAR-448(B1): 라벨 옆 Feather info 버튼 → InfoSheet 바텀시트(점수 정의·등급 구간·"무엇을 보고
//   무엇을 하라")로 점수의 의미·행동 가이드를 연결한다. RiskStatusBadges/PriceChangeChip(DAR-175)
//   의 정보공개 패턴 재사용. 영문 점수 라벨(Buy/Exit Score)은 SSOT(signalTerms) 고정값이며,
//   설명 본문·헤딩은 전부 한국어다.
// DAR-448(B5): 카운트업은 단독/상세 표면(accessibilityHidden=false)에서만 1회 재생하고,
//   리스트·카루셀 카드(accessibilityHidden=true, 상위 카드가 표현·접근성을 소유)에서는 정적이다.
//   리스트가 removeClippedSubviews로 카드를 재활용할 때 매-마운트 0→값 애니메이션이 반복돼
//   스크롤이 산만해지던 결함(B5)을 컴포넌트 기본값에서 차단한다. reduce-motion 시 항상 정적.

// 등급 구간 카피·각주(B1) — 점수의 정의·구간·행동 가이드(전부 한국어). 컷 숫자는 게이지가
// 실제로 그리는 등급 컷(BUY/EXIT_SCORE_CUTS)에서 가져와 게이지 지오메트리와 드리프트 0.
const SCORE_INFO_FOOTNOTE =
  '점수는 공시·시세·이벤트 통계를 합산한 참고 정보이며 투자 권유가 아닙니다. ' +
  '최종 매수·매도 판단과 주문은 사용자 본인의 책임입니다.';

function buildScoreInfoSections(kind: 'buy' | 'exit'): InfoSheetSection[] {
  if (kind === 'exit') {
    const [low, high] = EXIT_SCORE_CUTS; // 30, 70
    return [
      {
        icon: 'help-circle',
        heading: 'Exit Score란?',
        body:
          '보유 종목의 청산(매도) 신호 강도를 0~100으로 나타낸 참고 점수입니다. ' +
          '점수가 높을수록 청산 신호가 강함을 뜻하며, 미래 손익을 보장하지 않습니다.',
      },
      {
        icon: 'bar-chart-2',
        heading: '점수 구간 읽는 법',
        body:
          `${high}점 이상은 청산 신호가 강한 구간, ` +
          `${low}~${high - 1}점은 축소·관찰을 검토하는 구간, ` +
          `${low}점 미만은 보유가 양호한 구간입니다. ` +
          '막대 색과 숫자가 같은 구간을 함께 가리킵니다(색만으로 의미를 전달하지 않습니다).',
      },
      {
        icon: 'compass',
        heading: '무엇을 보고 무엇을 하라',
        body:
          '점수만 보지 말고 청산 사유와 위험 배지를 함께 확인하세요. ' +
          '하드룰 손절은 시스템이 자동으로 처리하며, 그 밖의 매도 판단은 참고용 점수를 바탕으로 한 ' +
          '사용자 본인의 결정입니다.',
      },
    ];
  }
  const [low, mid, high] = BUY_SCORE_CUTS; // 30, 60, 80
  return [
    {
      icon: 'help-circle',
      heading: 'Buy Score란?',
      body:
        '공시·시세·이벤트 통계를 합산해 매수 매력도를 0~100으로 나타낸 참고 점수입니다. ' +
        '점수가 높을수록 과거 유사 신호의 성과가 좋았음을 뜻하며, 미래 수익을 보장하지 않습니다.',
    },
    {
      icon: 'bar-chart-2',
      heading: '점수 구간 읽는 법',
      body:
        `${high}점 이상은 강세 구간, ` +
        `${mid}~${high - 1}점은 양호 구간, ` +
        `${low}~${mid - 1}점은 주의 구간, ` +
        `${low}점 미만은 약세 구간입니다. ` +
        '막대 색과 숫자·등급 라벨이 같은 구간을 함께 가리킵니다(색만으로 의미를 전달하지 않습니다).',
    },
    {
      icon: 'compass',
      heading: '무엇을 보고 무엇을 하라',
      body:
        '점수만 보지 말고 위험 배지와 투자 논거를 함께 확인하세요. ' +
        '점수는 참고 정보이며, 최종 매수 판단과 주문은 사용자 본인의 결정입니다. 자동으로 주문되지 않습니다.',
    },
  ];
}

// info 버튼(아이콘 14px)의 유효 터치 영역을 sizing.minTouchTarget(44pt)로 확장(접근성 가드).
// 14 + 15*2 = 44.
const INFO_HIT_SLOP = { top: 15, bottom: 15, left: 15, right: 15 };

interface ScoreGaugeProps {
  /** 0~100 */
  score: number;
  kind?: 'buy' | 'exit';
  /** 좌측 레이블 (예: "Buy Score") */
  label?: string;
  /** 접근성 라벨 보조 텍스트 (예: "강한매수") */
  statusText?: string;
  /** 점수 아래 1줄 평문 (항상 '(참고)' 포함, utils/copy.ts 기준) */
  oneLiner?: string;
  /** 상위 카드가 합성 읽기를 담당할 때 true → 게이지 자체는 접근성에서 숨김(§8-3) */
  accessibilityHidden?: boolean;
  /**
   * 카운트업 모션(§11/B5). 미지정 시 단독/상세 표면(accessibilityHidden=false)에서만 ON,
   * 리스트·카루셀 카드(accessibilityHidden=true)에서는 OFF. 명시하면 그 값으로 강제한다.
   * reduce-motion 시 prop과 무관하게 즉시 정적.
   */
  animated?: boolean;
  /**
   * 라벨 옆 정보(info) 버튼 노출(B1). 미지정 시 단독/상세 표면(accessibilityHidden=false)에서만
   * 노출한다 — 리스트·카루셀 카드는 카드 전체가 상세로 이동하는 터치 대상이라 중첩 터치를 피한다.
   */
  showInfo?: boolean;
}

export function ScoreGauge({
  score,
  kind = 'buy',
  label,
  statusText,
  oneLiner,
  accessibilityHidden = false,
  animated,
  showInfo,
}: ScoreGaugeProps) {
  const { colors, typography: typo } = useTheme();
  const { light } = useHaptics();
  const clamped = Math.max(0, Math.min(100, score));
  const color = kind === 'exit' ? exitScoreColor(clamped, colors) : buyScoreColor(clamped, colors);
  const title = kind === 'exit' ? SIGNAL_TERMS.exitScore : SIGNAL_TERMS.buyScore;
  const cuts = kind === 'exit' ? EXIT_SCORE_CUTS : BUY_SCORE_CUTS;
  const nextGap = nextCutGap(clamped, kind);

  // 다음 등급까지 N (캡션·접근성 공용). nextGap은 '+2' 형태.
  const nextGapValue = nextGap ? nextGap.replace('+', '') : null;

  // 단독/상세 표면(카드에 합성되지 않음)에서만 카운트업과 info 버튼을 기본 노출(B1·B5).
  // accessibilityHidden=true(리스트·카루셀 카드)면 둘 다 기본 OFF. prop 명시 시 그 값이 우선.
  const isStandalone = !accessibilityHidden;
  const animateCountUp = animated ?? isStandalone;
  const showInfoButton = showInfo ?? isStandalone;

  // info 시트 열림 상태(PriceChangeChip/RiskStatusBadges 정보공개 패턴, DAR-175).
  const [sheetVisible, setSheetVisible] = useState(false);
  const openInfo = useCallback(() => {
    light();
    setSheetVisible(true);
  }, [light]);
  const closeInfo = useCallback(() => setSheetVisible(false), []);
  const infoSections = useMemo(() => buildScoreInfoSections(kind), [kind]);

  // 카운트업(§11): 숫자·바·노브만 0→clamped 1회 이동. 색/접근성/캡션은 최종값 고정(밴드 색 깜빡임 방지).
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animateCountUp && !reducedMotion;
  // 카운트업 중 표시값(리스너가 비동기 갱신). 정적일 때는 사용하지 않고 clamped 를 렌더-페이즈에서
  // 직접 쓴다 → effect 내 동기 setState 회피(react-hooks/set-state-in-effect, DAR-431 패턴).
  const [animatedScore, setAnimatedScore] = useState(0);
  // Animated.Value를 state 지연 초기화로 보관 — 렌더 중 ref 접근 없이 안정 인스턴스 확보.
  const [animValue] = useState(() => new Animated.Value(0));
  // 정적(리스트·카루셀 / reduce-motion)이면 렌더-페이즈에서 즉시 최종값. 매 프레임 setState 0 → B5 해소.
  const displayScore = shouldAnimate ? animatedScore : clamped;

  useEffect(() => {
    if (!shouldAnimate) {
      // 정적 경로: Animated 리스너·타이밍을 부착하지 않는다. 표시값은 렌더-페이즈 clamped 가 담당.
      // 다음 애니메이션 진입 시 0→clamped 점프를 피하려고 Animated.Value 만 동기화(setState 아님).
      animValue.setValue(clamped);
      return;
    }
    // 카운트업 경로(단독/상세): 표시값을 리스너(비동기 콜백)로만 갱신. deps가 안정적이라 일반 리렌더로는
    // 재실행되지 않음 → 카운트업 1회. reduce-motion이 진입 직후 true로 바뀌면 effect가 재실행되며
    // 위 정적 경로로 빠져 렌더-페이즈가 즉시 최종값을 표시한다(폴백 의무, §11).
    const id = animValue.addListener(({ value }) => setAnimatedScore(Math.round(value)));
    const animation = Animated.timing(animValue, {
      toValue: clamped,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animValue.removeListener(id);
      animation.stop();
    };
  }, [shouldAnimate, clamped, animValue]);

  return (
    <View
      accessibilityRole={accessibilityHidden ? undefined : 'progressbar'}
      accessibilityElementsHidden={accessibilityHidden}
      importantForAccessibility={accessibilityHidden ? 'no-hide-descendants' : 'auto'}
      accessibilityLabel={
        accessibilityHidden
          ? undefined
          : `${label ?? title} ${clamped}점${statusText ? `, ${statusText} 구간` : ''}${
              nextGapValue ? `, 다음 등급까지 ${nextGapValue}` : ''
            }${oneLiner ? `, ${oneLiner}` : ''}`
      }
    >
      <View style={styles.row}>
        <View style={styles.labelGroup}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>{label ?? title}</Text>
          {/* DAR-448(B1): 점수 정의·등급 구간·행동 가이드 설명 진입점. 단독/상세 표면에서만 노출. */}
          {showInfoButton ? (
            <TouchableOpacity
              onPress={openInfo}
              style={styles.infoBtn}
              hitSlop={INFO_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={`${title} 점수 설명 보기`}
            >
              <Feather name="info" size={14} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        {/* DAR-143: 카드 주인공인 점수값을 h2(22px/700)로 승격 — 좌측 라벨(small 12px) 대비
            명확한 타이포 위계 확보. 색상은 buy/exit 등급 로직(color) 유지(하드코딩 금지). */}
        <Text style={[typo.h2, { color }]}>{displayScore}</Text>
      </View>

      {/* 바 + 등급 컷 틱 + 노브 (position:relative 컨테이너).
          DAR-174: 게이지 영역은 고정 픽셀 높이(gauge.barHeight) + 퍼센트 left 기반이라 OS 글꼴
          확대와 독립적이다. 위 점수 숫자(h2)가 커져도 게이지 내부 틱/노브 정렬은 틀어지지 않는다. */}
      <View style={styles.gaugeArea}>
        <ProgressBar
          progress={displayScore / 100}
          color={color}
          style={[styles.bar, { backgroundColor: colors.surfaceSecondary }]}
        />
        {/* 등급 컷 틱 — background 색 세로 구분선으로 등급 경계 표시 */}
        {cuts.map((cut) => (
          <View
            key={cut}
            pointerEvents="none"
            style={[styles.tick, { left: `${cut}%`, backgroundColor: colors.background }]}
          />
        ))}
        {/* 현재 점수 노브 — 카운트업과 함께 이동 */}
        <View
          pointerEvents="none"
          style={[styles.knob, { left: `${displayScore}%`, backgroundColor: color }]}
        />
      </View>

      {/* '다음 등급까지 +N' 캡션 — 우측 정렬, 색상 외 텍스트 신호 */}
      {nextGap ? (
        <View style={styles.captionRow}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>다음 등급까지 {nextGap}</Text>
        </View>
      ) : null}

      {oneLiner ? (
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {oneLiner}
        </Text>
      ) : null}

      {/* 용어 설명 바텀시트(B1) — 버튼이 노출될 때만 마운트. */}
      {showInfoButton ? (
        <InfoSheet
          visible={sheetVisible}
          onClose={closeInfo}
          title={`${title} 안내`}
          sections={infoSections}
          footnote={SCORE_INFO_FOOTNOTE}
        />
      ) : null}
    </View>
  );
}

// DAR-174: 게이지 영역 높이 = knobSize. 막대(barHeight)는 영역 세로 중앙에 놓이므로
// 막대/틱의 상단 오프셋과 노브의 수평 중심 오프셋을 토큰에서 계산한다(매직넘버 -1/-5 제거).
const BAR_TOP_OFFSET = (gauge.knobSize - gauge.barHeight) / 2;
const KNOB_LEFT_OFFSET = -gauge.knobSize / 2;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  labelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  infoBtn: {
    // 시각 크기는 아이콘(14px)에 맞추고 유효 터치 영역은 hitSlop(INFO_HIT_SLOP)으로 44pt 확보.
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeArea: {
    position: 'relative',
    // 고정 픽셀 높이 — 글꼴 배율과 무관하게 틱/노브 절대 위치 기준이 결정적이다(DAR-174).
    height: gauge.knobSize,
    justifyContent: 'center',
  },
  bar: {
    height: gauge.barHeight,
    borderRadius: gauge.barRadius,
  },
  tick: {
    position: 'absolute',
    // 막대가 게이지 영역 세로 중앙에 놓이므로 틱도 동일 오프셋으로 막대에 정렬.
    top: BAR_TOP_OFFSET,
    width: gauge.tickWidth,
    height: gauge.barHeight,
  },
  knob: {
    position: 'absolute',
    width: gauge.knobSize,
    height: gauge.knobSize,
    borderRadius: gauge.knobSize / 2,
    top: 0, // gaugeArea 높이 = knobSize → 노브가 영역에 꽉 차며 막대 중앙에 정렬
    marginLeft: KNOB_LEFT_OFFSET, // 노브 중심을 현재값에 정렬
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
});
