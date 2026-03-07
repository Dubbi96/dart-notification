import React from 'react';
import { View, StyleSheet, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { radius } from '@theme/spacing';
import { useTheme } from '@theme';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  variant?: 'default' | 'iridescent';
}

export function GlassCard({
  children,
  style,
  intensity = 25,
  variant = 'iridescent',
}: GlassCardProps) {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, style]}>
      {/* Base blur layer */}
      <BlurView
        intensity={intensity}
        tint={isDark ? 'dark' : 'light'}
        style={StyleSheet.absoluteFill}
      />

      {/* Iridescent rainbow light refraction overlay */}
      {variant === 'iridescent' && (
        <>
          {/* Main holographic sweep - top-left to bottom-right */}
          <LinearGradient
            colors={[
              'rgba(255, 100, 180, 0.12)',
              'rgba(160, 120, 255, 0.10)',
              'rgba(80, 200, 255, 0.12)',
              'rgba(100, 255, 200, 0.10)',
              'rgba(255, 220, 100, 0.08)',
              'rgba(255, 140, 120, 0.10)',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Secondary light streak - creates depth */}
          <LinearGradient
            colors={[
              'transparent',
              'rgba(255, 255, 255, 0.15)',
              'rgba(200, 230, 255, 0.08)',
              'transparent',
            ]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* Subtle specular highlight - top edge shine */}
          <LinearGradient
            colors={[
              'rgba(255, 255, 255, 0.20)',
              'rgba(255, 255, 255, 0.05)',
              'transparent',
            ]}
            start={{ x: 0.3, y: 0 }}
            end={{ x: 0.7, y: 0.4 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      )}

      {/* Glass frost border effect */}
      <View
        style={[
          StyleSheet.absoluteFill,
          styles.borderOverlay,
          {
            borderColor: isDark
              ? 'rgba(255, 255, 255, 0.12)'
              : 'rgba(255, 255, 255, 0.45)',
          },
        ]}
      />

      {/* Content */}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    position: 'relative',
  },
  borderOverlay: {
    borderWidth: 1,
    borderRadius: radius.xl,
  },
  content: {
    position: 'relative',
    zIndex: 1,
  },
});
