import { lightColors, darkColors } from '@theme/colors';

function luminance(hex: string): number {
  const rgb = hex
    .slice(1)
    .match(/../g)!
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const [higher, lower] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (higher + 0.05) / (lower + 0.05);
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('%s 읽기 대비', (_, c) => {
  it('기본 표면의 본문·보조·강조 텍스트는 4.5:1 이상이다', () => {
    for (const bg of [c.background, c.surface, c.surfaceSecondary]) {
      for (const fg of [c.text, c.textSecondary, c.textTertiary, c.primary]) {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('탭·버튼·입력 안내·의미 있는 상태 설명은 4.5:1 이상이다', () => {
    for (const [fg, bg] of [
      [c.tabActive, c.tabBar],
      [c.tabInactive, c.tabBar],
      [c.primaryForeground, c.primary],
      [c.inputPlaceholder, c.inputBackground],
      [c.success, c.successSurface],
      [c.error, c.errorSurface],
      [c.warning, c.warningSurface],
      [c.primaryDark, c.primaryLight],
    ])
      expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});
