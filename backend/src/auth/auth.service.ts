import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DevicesService } from '../devices/devices.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

// refresh JWT 만료(90d)와 동일. DB 행의 expiresAt 계산에 사용.
const REFRESH_TOKEN_TTL_DAYS = 90;
const REFRESH_TOKEN_TTL_MS = REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

// 카카오 OAuth 외부 호출 상한(ms). Node native fetch 는 기본 타임아웃이 없어
// 카카오 API hang 시 로그인 요청이 무기한 매달리므로 AbortSignal.timeout 으로 상한을 둔다.
// 정본 외부 호출 타임아웃(dart-api 30s·llm 60s)보다 짧게 — 로그인은 사용자 대면 동기 경로.
const KAKAO_FETCH_TIMEOUT_MS = 10_000;

// refresh 토큰 원문은 저장하지 않고 SHA-256 해시만 보관한다.
// 토큰 자체가 고엔트로피(서명된 JWT)이므로 단방향 해시로 충분하며,
// 유니크 인덱스 조회가 가능해 bcrypt 대비 검증 비용이 낮다.
function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

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
            // DAR-550(오너결정·공개 코호트 가드): 신규 가입자는 체결(트레이딩) 푸시 기본 OFF.
            //   스키마 default(false)와 동일값을 명시 — 공개(Play) 사용자 기본 미발송 보장.
            tradePushEnabled: false,
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

  /**
   * 카카오 OAuth fetch 래퍼. 타임아웃(AbortSignal.timeout)·네트워크 장애 등
   * fetch 자체가 throw 하는 경우를 잡아 기존 실패 경로(UnauthorizedException)로 매핑한다.
   * 카카오 API hang 시 무기한 대기 대신 KAKAO_FETCH_TIMEOUT_MS 후 상한 처리.
   * 정상 응답(ok/!ok 분기)은 호출부가 그대로 처리하므로 동작 불변.
   */
  private async kakaoFetch(
    url: string,
    init: RequestInit,
    failureMessage: string,
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(KAKAO_FETCH_TIMEOUT_MS),
      });
    } catch (error) {
      // 민감정보 미노출: 요청 호스트와 에러 이름(TimeoutError/AbortError 등)만 기록.
      this.logger.error('Kakao request failed', {
        host: new URL(url).host,
        error: (error as Error)?.name,
      });
      throw new UnauthorizedException(failureMessage);
    }
  }

  async kakaoLogin(code: string, redirectUri: string) {
    // 1. Exchange code for access token
    const tokenResponse = await this.kakaoFetch(
      'https://kauth.kakao.com/oauth/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.configService.get<string>('KAKAO_REST_API_KEY') || '',
          client_secret:
            this.configService.get<string>('KAKAO_CLIENT_SECRET') || '',
          redirect_uri: redirectUri,
          code,
        }),
      },
      '카카오 인증에 실패했습니다.',
    );

    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) {
      // 민감정보(앱 키·access_token·refresh_token·인가코드·전체 페이로드) 로그 금지.
      // 카카오 error/error_description 코드와 HTTP status 만 기록한다.
      this.logger.error('Kakao token exchange failed', {
        status: tokenResponse.status,
        error: tokenData?.error,
        error_description: tokenData?.error_description,
      });
      throw new UnauthorizedException('카카오 인증에 실패했습니다.');
    }

    // 2. Get user info from Kakao
    const userResponse = await this.kakaoFetch(
      'https://kapi.kakao.com/v2/user/me',
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
      '카카오 사용자 정보를 가져올 수 없습니다.',
    );

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
              // DAR-550(오너결정·공개 코호트 가드): 신규 가입자는 체결(트레이딩) 푸시 기본 OFF.
              //   스키마 default(false)와 동일값을 명시 — 공개(Play) 사용자 기본 미발송 보장.
              tradePushEnabled: false,
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

  /**
   * 제시된 refresh 토큰을 DB 저장 해시와 대조해 검증하고 회전(rotation)한다.
   * - 미등록/타 사용자 토큰 → 401
   * - 이미 폐기(회전·로그아웃)된 토큰 재사용 → 탈취 정황으로 보고 해당 사용자의
   *   모든 유효 세션을 폐기한 뒤 401 (reuse detection)
   * - 만료된 토큰 → 401
   * 통과 시 기존 토큰을 폐기(revoke)하고 새 토큰 쌍을 발급한다.
   */
  async refresh(userId: string, email: string, refreshToken: string) {
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.userId !== userId) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.revokedAt) {
      // 이미 폐기된 토큰의 재사용 = 회전 이후의 구토큰/탈취 정황.
      // 방어적으로 해당 사용자의 모든 유효 세션을 폐기한다.
      await this.revokeAllForUser(userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // 회전: 사용된 토큰 폐기와 새 토큰 영속화를 하나의 트랜잭션으로 원자화한다.
    // JWT 서명(비DB)은 트랜잭션 밖에서 먼저 끝내 트랜잭션 구간을 최소화하고,
    // create(신규) 실패 시 update(폐기)까지 롤백되어 구토큰이 유효하게 남는다.
    // (비원자적이면 폐기만 성공·발급 실패 시 강제 로그아웃, 이후 구토큰 재사용이
    //  reuse-detection 으로 오인되어 전 세션이 폐기되는 증폭까지 발생한다.)
    const tokens = await this.signTokens(userId, email);
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() },
      });
      await tx.refreshToken.create({
        data: this.buildRefreshTokenData(userId, tokens.refreshToken),
      });
    });

    return tokens;
  }

  async logout(userId: string, deviceToken?: string) {
    if (deviceToken) {
      await this.devicesService.removeByToken(userId, deviceToken);
    }
    // 로그아웃 시 해당 사용자의 모든 유효 refresh 토큰을 폐기한다.
    // 이후 동일 refresh 로 /auth/refresh 호출 시 401.
    await this.revokeAllForUser(userId);
  }

  private async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * JWT(access/refresh) 서명만 수행한다(DB 미접촉).
   * refresh 토큰의 영속화는 호출부가 책임진다 — 단일 발급(signup/login/kakao)은
   * generateTokens 가, 회전(refresh)은 폐기와 묶은 $transaction 이 담당한다.
   */
  private async signTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    // refresh 토큰마다 고유 jti 를 부여해 동일 초 발급에도 토큰(=해시)이 충돌하지 않게 한다.
    const refreshPayload = { ...payload, jti: randomUUID() };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(refreshPayload, {
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

  // 발급된 refresh 토큰을 영속화하기 위한 create 입력. 원문은 저장하지 않고 해시만 보관.
  private buildRefreshTokenData(userId: string, refreshToken: string) {
    return {
      userId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    };
  }

  // 단일 발급 경로(선행 폐기 없음): 서명 후 곧바로 영속화한다.
  private async generateTokens(userId: string, email: string) {
    const tokens = await this.signTokens(userId, email);
    await this.prisma.refreshToken.create({
      data: this.buildRefreshTokenData(userId, tokens.refreshToken),
    });
    return tokens;
  }
}
