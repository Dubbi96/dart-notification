import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

export interface SnackbarAction {
  label: string;
  onPress: () => void;
}

export interface SnackbarOptions {
  /** 표시 시간(ms). 성공 2500, 실패 4000 권장 (§3-1) */
  duration?: number;
  /** 최대 1개 액션 버튼 (예: "실행 취소", "재시도") */
  action?: SnackbarAction;
}

interface SnackbarContextType {
  showSnackbar: (message: string, options?: SnackbarOptions) => void;
}

const SnackbarContext = createContext<SnackbarContextType>({
  showSnackbar: () => {},
});

export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState(2500);
  const [action, setAction] = useState<SnackbarAction | undefined>(undefined);

  const showSnackbar = useCallback((msg: string, options?: SnackbarOptions) => {
    setMessage(msg);
    setDuration(options?.duration ?? 2500);
    setAction(options?.action);
    // 큐잉 단순화: 새 Snackbar 요청 시 즉시 교체 (§3-1)
    setVisible(false);
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const snackbarBg = colors.snackbarBackground;

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={duration}
        style={[styles.snackbar, { backgroundColor: snackbarBg }]}
        action={
          action
            ? {
                label: action.label,
                textColor: colors.primary,
                onPress: () => {
                  action.onPress();
                  setVisible(false);
                },
              }
            : undefined
        }
      >
        <View style={styles.content}>
          <Feather name="info" size={16} color={colors.snackbarText} />
          <Text style={[typo.body, styles.message, { color: colors.snackbarText }]}>{message}</Text>
        </View>
      </Snackbar>
    </SnackbarContext.Provider>
  );
}

const styles = StyleSheet.create({
  snackbar: {
    borderRadius: radius.md,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  message: {
    flexShrink: 1,
  },
});
