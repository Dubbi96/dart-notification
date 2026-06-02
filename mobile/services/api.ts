import axios from 'axios';
import { Platform } from 'react-native';
import { useAuthStore } from '@stores/authStore';

const DEV_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || `http://${DEV_HOST}:3000/api`;

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - attach access token
api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

// Response interceptor - handle 401 and token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const { refreshToken, setAuth, clearAuth, isGuest } = useAuthStore.getState();
      if (!refreshToken) {
        if (!isGuest) clearAuth();
        return Promise.reject(error);
      }

      try {
        const { data } = await axios.post(`${API_BASE_URL}/auth/refresh`, {
          refreshToken,
        });
        const refreshData = data.data;
        setAuth(refreshData.user, refreshData.accessToken, refreshData.refreshToken);
        originalRequest.headers.Authorization = `Bearer ${refreshData.accessToken}`;
        return api(originalRequest);
      } catch {
        if (!useAuthStore.getState().isGuest) clearAuth();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);
