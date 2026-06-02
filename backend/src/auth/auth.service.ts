import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  // Temporary in-memory store for OAuth results (state → result)
  private authResults = new Map<string, { data: any; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly devicesService: DevicesService,
  ) {}

  storeAuthResult(state: string, result: any) {
    // Expire after 5 minutes
    this.authResults.set(state, { data: result, expiresAt: Date.now() + 5 * 60 * 1000 });
  }

  getAuthResult(state: string): any | null {
    const entry = this.authResults.get(state);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.authResults.delete(state);
      return null;
    }
    // One-time use: delete after retrieval
    this.authResults.delete(state);
    return entry.data;
  }

  async signup(dto: SignupDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        name: dto.name,
        notificationSettings: {
          create: {
            disclosureTypes: [],
            keywords: [],
            isEnabled: true,
          },
        },
      },
    });

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      tokens,
    };
  }

  async kakaoLogin(code: string, redirectUri: string) {
    // 1. Exchange code for access token
    const tokenResponse = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.configService.get<string>('KAKAO_REST_API_KEY') || '',
        client_secret: this.configService.get<string>('KAKAO_CLIENT_SECRET') || '',
        redirect_uri: redirectUri,
        code,
      }),
    });

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      console.error('[Kakao Token Error]', JSON.stringify(tokenData));
      console.error('[Kakao Token Request]', { client_id: this.configService.get<string>('KAKAO_REST_API_KEY'), redirect_uri: redirectUri, code: code.substring(0, 10) + '...' });
      throw new UnauthorizedException('카카오 인증에 실패했습니다.');
    }

    // 2. Get user info from Kakao
    const userResponse = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const kakaoUser = await userResponse.json();
    if (!userResponse.ok) {
      throw new UnauthorizedException('카카오 사용자 정보를 가져올 수 없습니다.');
    }

    const kakaoId = String(kakaoUser.id);
    const email = kakaoUser.kakao_account?.email;
    const name =
      kakaoUser.kakao_account?.profile?.nickname ||
      kakaoUser.properties?.nickname ||
      '카카오 사용자';

    // 3. Find or create user
    let user = await this.prisma.user.findFirst({
      where: { provider: 'kakao', providerId: kakaoId },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: email || `kakao_${kakaoId}@kakao.user`,
          name,
          provider: 'kakao',
          providerId: kakaoId,
          notificationSettings: {
            create: {
              disclosureTypes: [],
              keywords: [],
              isEnabled: true,
            },
          },
        },
      });
      isNewUser = true;
    } else {
      // 기존 사용자: 프로필 정보 업데이트
      if (name && name !== user.name) {
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: { name },
        });
      }
      // 관심 기업이 없으면 온보딩 필요
      const watchlistCount = await this.prisma.watchList.count({
        where: { userId: user.id },
      });
      isNewUser = watchlistCount === 0;
    }

    // 4. Generate JWT tokens
    const tokens = await this.generateTokens(user.id, user.email);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
      tokens,
      isNewUser,
    };
  }

  getApiBaseUrl(): string {
    return this.configService.get<string>('API_BASE_URL') || 'http://localhost:3000/api';
  }

  async refresh(userId: string, email: string) {
    const tokens = await this.generateTokens(userId, email);
    return tokens;
  }

  async logout(userId: string, deviceToken?: string) {
    if (deviceToken) {
      await this.devicesService.removeByToken(userId, deviceToken);
    }
  }

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: '90d',
      }),
    ]);

    return {
      accessToken,
      refreshToken,
      expiresIn: 900,
    };
  }
}
