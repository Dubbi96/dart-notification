import { router } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { getDialogRef } from '@components/common/DialogProvider';

export function useRequireAuth() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const requireAuth = (): boolean => {
    if (isAuthenticated) return true;

    getDialogRef().current?.showDialog({
      title: '로그인이 필요합니다',
      message: '이 기능을 사용하려면 로그인해 주세요.',
      icon: { name: 'log-in' },
      buttons: [
        { text: '취소', style: 'cancel' },
        {
          text: '로그인',
          onPress: () => {
            useAuthStore.getState().clearAuth();
            router.push('/auth/sign-in');
          },
        },
      ],
    });
    return false;
  };

  return { isAuthenticated, requireAuth };
}
