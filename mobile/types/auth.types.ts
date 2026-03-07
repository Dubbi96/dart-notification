export interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthResponse {
  user: User;
  tokens: AuthTokens;
  isNewUser?: boolean;
}

export interface KakaoAuthPayload {
  code: string;
  redirectUri: string;
}
