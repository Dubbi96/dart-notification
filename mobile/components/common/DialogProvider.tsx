import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, Modal, Pressable } from 'react-native';
import { Button } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

interface DialogButton {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive';
}

interface DialogOptions {
  title: string;
  message: string;
  buttons?: DialogButton[];
  icon?: {
    name: React.ComponentProps<typeof Feather>['name'];
    color?: string;
  };
}

interface DialogContextType {
  showDialog: (options: DialogOptions) => void;
}

const DialogContext = createContext<DialogContextType>({
  showDialog: () => {},
});

export function useDialog() {
  return useContext(DialogContext);
}

// ref 기반 접근 (훅 외부에서 사용)
const dialogRef: { current: DialogContextType | null } = { current: null };

export function getDialogRef() {
  return dialogRef;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  const [visible, setVisible] = useState(false);
  const [options, setOptions] = useState<DialogOptions>({
    title: '',
    message: '',
  });

  const showDialog = useCallback((opts: DialogOptions) => {
    setOptions(opts);
    setVisible(true);
  }, []);

  // ref 동기화 (모듈 변수 변경은 렌더 중 금지 — 이펙트에서 동기화)
  useEffect(() => {
    dialogRef.current = { showDialog };
  }, [showDialog]);

  const handleDismiss = () => setVisible(false);

  const handleButtonPress = (button: DialogButton) => {
    setVisible(false);
    button.onPress?.();
  };

  const buttons = options.buttons ?? [{ text: '확인', style: 'default' as const }];

  return (
    <DialogContext.Provider value={{ showDialog }}>
      {children}
      {/* R-22: 풀스크린 백드롭은 RN 코어 Modal만 — Paper Portal+Dialog(JS 절대배치)는 Fabric에서
          네이티브 elevation(탭바·헤더)이 백드롭 z-order를 역전시켜 부분 커버된다(DAR-558 트리아지). */}
      <Modal
        visible={visible}
        transparent
        statusBarTranslucent
        navigationBarTranslucent
        animationType="fade"
        onRequestClose={handleDismiss}
      >
        <Pressable
          style={[StyleSheet.absoluteFill, styles.backdrop, { backgroundColor: colors.overlay }]}
          onPress={handleDismiss}
        >
          {/* 카드 탭이 백드롭으로 전파돼 즉시 닫히지 않도록 내부 Pressable로 흡수 */}
          <Pressable
            style={[styles.dialog, { backgroundColor: colors.surface }]}
            onPress={() => {}}
          >
            {options.icon && (
              <View style={styles.iconContainer}>
                <Feather
                  name={options.icon.name}
                  size={32}
                  color={options.icon.color ?? colors.primary}
                />
              </View>
            )}
            <Text style={[typo.h3, styles.title, { color: colors.text }]}>{options.title}</Text>
            <View style={styles.content}>
              <Text style={[typo.body, styles.message, { color: colors.textSecondary }]}>
                {options.message}
              </Text>
            </View>
            <View style={styles.actions}>
              {buttons.map((button, index) => (
                <Button
                  key={index}
                  onPress={() => handleButtonPress(button)}
                  textColor={
                    button.style === 'destructive'
                      ? colors.error
                      : button.style === 'cancel'
                        ? colors.textSecondary
                        : colors.primary
                  }
                  style={styles.button}
                >
                  {button.text}
                </Button>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  iconContainer: {
    alignItems: 'center',
    paddingTop: spacing.lg,
  },
  title: {
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    alignItems: 'center',
  },
  message: {
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  button: {
    minWidth: 64,
  },
});
