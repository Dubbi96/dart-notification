import { Platform } from 'react-native';

// Dynamic Type 지원(기획 §9). makeTypography(scale)로 글자 배율을 적용한다.
// 클램프 1.0~1.5 필수 — 1.5x 초과 시 카드/탭바/게이지 레이아웃 붕괴 방지.

const fontFamily = Platform.select({
  ios: 'System',
  android: 'Roboto',
  default: 'System',
});

const BASE_SIZES = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 16,
  bodyMedium: 16,
  caption: 14,
  captionMedium: 14,
  small: 12,
  amount: 32,
} as const;

const BASE_HEIGHTS = {
  h1: 34,
  h2: 28,
  h3: 24,
  body: 22,
  bodyMedium: 22,
  caption: 20,
  captionMedium: 20,
  small: 16,
  amount: 40,
} as const;

const FONT_WEIGHTS = {
  h1: '700',
  h2: '700',
  h3: '600',
  body: '400',
  bodyMedium: '500',
  caption: '400',
  captionMedium: '500',
  small: '400',
  amount: '700',
} as const;

const MIN_FONT_SIZE = 12; // small 바닥값

export type TypographyKey = keyof typeof BASE_SIZES;

export interface TextStyleToken {
  fontFamily: string | undefined;
  fontSize: number;
  fontWeight: '400' | '500' | '600' | '700';
  lineHeight: number;
}

export type Typography = Record<TypographyKey, TextStyleToken>;

/** 글자 배율을 1.0~1.5로 클램프한다(§9 — 레이아웃 붕괴 방지). */
export function clampTextScale(scale: number): number {
  return Math.min(Math.max(scale, 1.0), 1.5);
}

export function makeTypography(scale: number): Typography {
  const clamped = clampTextScale(scale);
  const keys = Object.keys(BASE_SIZES) as TypographyKey[];
  const entries = keys.map((key): [TypographyKey, TextStyleToken] => [
    key,
    {
      fontFamily,
      fontSize: Math.max(MIN_FONT_SIZE, Math.round(BASE_SIZES[key] * clamped)),
      fontWeight: FONT_WEIGHTS[key],
      lineHeight: Math.round(BASE_HEIGHTS[key] * clamped),
    },
  ]);
  return Object.fromEntries(entries) as Typography;
}

// 기존 API 호환 (scale=1.0 고정). 기존 import { typography } 경로 유지.
export const typography: Typography = makeTypography(1.0);
