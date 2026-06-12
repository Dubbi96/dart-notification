import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Dialog, Portal, Button } from 'react-native-paper';
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
      <Portal>
        <Dialog
          visible={visible}
          onDismiss={handleDismiss}
          style={[styles.dialog, { backgroundColor: colors.surface }]}
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
          <Dialog.Title style={[typo.h3, styles.title, { color: colors.text }]}>
            {options.title}
          </Dialog.Title>
          <Dialog.Content style={{ justifyContent: 'center', alignItems: 'center' }}>
            <Text style={[typo.body, { color: colors.textSecondary }]}>
              {options.message}
            </Text>
          </Dialog.Content>
          <Dialog.Actions style={styles.actions}>
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
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </DialogContext.Provider>
  );
}

const styles = StyleSheet.create({
  dialog: {
    borderRadius: radius.lg,
  },
  iconContainer: {
    alignItems: 'center',
    paddingTop: spacing.lg,
  },
  title: {
    textAlign: 'center',
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  button: {
    minWidth: 64,
  },
});
