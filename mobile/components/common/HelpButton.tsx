import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { radius } from '@theme/spacing';

import { InfoSheet, type InfoSheetSection } from './InfoSheet';

interface HelpButtonProps {
  title: string;
  sections: InfoSheetSection[];
  footnote?: string;
}

/** 섹션의 사용법·용어 설명만 담는다. 현재 위험·오류 상태는 화면에 남긴다. */
export function HelpButton({ title, sections, footnote }: HelpButtonProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title} 설명 보기`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={({ pressed }) => [
          styles.trigger,
          { borderColor: focused ? colors.text : 'transparent' },
          pressed && { backgroundColor: colors.primaryLight },
        ]}
      >
        <Feather name="help-circle" size={20} color={colors.textSecondary} />
      </Pressable>
      {open ? (
        <InfoSheet
          visible
          onClose={() => setOpen(false)}
          title={title}
          sections={sections}
          footnote={footnote}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 48,
    height: 48,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
    borderWidth: 2,
  },
});
