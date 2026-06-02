import React, { createContext, useContext, useState, useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Snackbar } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

interface SnackbarContextType {
  showSnackbar: (message: string, duration?: number) => void;
}

const SnackbarContext = createContext<SnackbarContextType>({
  showSnackbar: () => {},
});

export function useSnackbar() {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const { typography: typo, isDark } = useTheme();
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState(2000);

  const showSnackbar = useCallback((msg: string, dur = 2000) => {
    setMessage(msg);
    setDuration(dur);
    setVisible(true);
  }, []);

  const snackbarBg = isDark ? '#282E58' : '#1F2937';

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={duration}
        style={[styles.snackbar, { backgroundColor: snackbarBg }]}
      >
        <View style={styles.content}>
          <Feather name="info" size={16} color="#FFFFFF" />
          <Text style={[typo.body, { color: '#FFFFFF' }]}>{message}</Text>
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
});
