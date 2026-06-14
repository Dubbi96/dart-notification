import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Stop,
  Path,
  Rect,
  Circle,
} from 'react-native-svg';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

interface LogoMarkProps {
  size?: number;
}

export function LogoMark({ size = 160 }: LogoMarkProps) {
  const { typography: typo } = useTheme();
  const cardWidth = size;
  const cardHeight = size * 0.55;

  return (
    <View style={styles.container}>
      <View style={styles.titleRow}>
        <Text style={[typo.h1, styles.title]}>공시</Text>
        <Text style={[typo.h1, styles.titleAccent]}>온</Text>
      </View>
      {/* 장식용 알림카드 일러스트 — 앱 식별 정보는 위 '공시온' 텍스트가 전달하므로
          스크린리더에는 노출하지 않는다(의미없는 SVG 도형 낭독 방지). */}
      <Svg
        width={cardWidth}
        height={cardHeight}
        viewBox="0 42 512 280"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        {/* Notification card 1 */}
        <Path
          d="M446 250H66C52.7452 250 42 260.745 42 274V341C42 354.255 52.7452 365 66 365H446C459.255 365 470 354.255 470 341V274C470 260.745 459.255 250 446 250Z"
          fill="white"
          fillOpacity={0.26}
          stroke="white"
          strokeOpacity={0.38}
          strokeWidth={1.5}
        />
        <Rect x={66} y={274} width={50} height={50} rx={14} fill="white" fillOpacity={0.18} stroke="white" strokeOpacity={0.3} />
        <Rect x={132} y={281} width={184} height={12} rx={6} fill="white" fillOpacity={0.65} />
        <Rect x={390} y={281} width={49} height={10} rx={5} fill="white" fillOpacity={0.22} />
        <Rect x={132} y={304} width={286} height={9} rx={4.5} fill="white" fillOpacity={0.32} />
        <Rect x={132} y={322} width={206} height={9} rx={4.5} fill="white" fillOpacity={0.22} />

        {/* Red dot */}
        <Circle cx={462} cy={250} r={13} fill="#F43F5E" />

        {/* Notification card 2 */}
        <Path
          d="M436 100H76C64.9543 100 56 108.954 56 120V170C56 181.046 64.9543 190 76 190H436C447.046 190 456 181.046 456 170V120C456 108.954 447.046 100 436 100Z"
          fill="white"
          fillOpacity={0.14}
          stroke="white"
          strokeOpacity={0.18}
        />
        <Circle cx={104} cy={145} r={18} fill="white" fillOpacity={0.16} />
        <Rect x={136} y={133} width={195} height={10} rx={5} fill="white" fillOpacity={0.2} />
        <Rect x={136} y={153} width={276} height={8} rx={4} fill="white" fillOpacity={0.12} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: spacing.sm,
  },
  title: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 42,
    fontWeight: '300',
  },
  titleAccent: {
    color: '#2DD4BF',
    fontSize: 42,
    fontWeight: '700',
  },
});
