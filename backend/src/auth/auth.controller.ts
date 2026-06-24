import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { KakaoAuthDto } from './dto/kakao-auth.dto';
import { LogoutDto } from './dto/logout.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '회원가입' })
  async signup(@Body() dto: SignupDto) {
    const result = await this.authService.signup(dto);
    return { success: true, data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: '로그인' })
  async login(@Body() dto: LoginDto) {
    const result = await this.authService.login(dto);
    return { success: true, data: result };
  }

  @Post('kakao')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: '카카오 로그인' })
  async kakaoLogin(@Body() dto: KakaoAuthDto) {
    const result = await this.authService.kakaoLogin(dto.code, dto.redirectUri);
    return { success: true, data: result };
  }

  @Get('kakao/callback')
  @ApiOperation({ summary: '카카오 OAuth 콜백 (브라우저용)' })
  async kakaoCallback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    try {
      const redirectUri = `${this.authService.getApiBaseUrl()}/auth/kakao/callback`;
      const result = await this.authService.kakaoLogin(code, redirectUri);

      // Store result temporarily with the state key
      this.authService.storeAuthResult(state, result);

      // state 안에 인코딩된 앱 리턴 URL(Expo Go=exp://.../--/kakao, 빌드=gongsion://kakao)로 복귀.
      // DAR-443: HTTP 302 redirect 가 정본 패턴. openAuthSessionAsync 는 returnUrl 로의 네비게이션
      //   (302 Location 포함)을 OS 레벨에서 가로채 인앱 브라우저를 자동 종료하고 앱으로 복귀시킨다.
      //   기존 HTML+setTimeout(window.location=custom-scheme)은 모바일 인앱 브라우저가 사용자 제스처
      //   없는 custom-scheme 자동 이동을 차단해 자동 복귀가 실패했다(성공 페이지에 멈춤).
      const returnUrl = this.extractReturnUrl(state);
      const sep = returnUrl.includes('?') ? '&' : '?';
      const deepLink = `${returnUrl}${sep}state=${encodeURIComponent(state)}`;
      return res.redirect(deepLink);
    } catch (e) {
      this.logger.error('Kakao callback failed', { error: e?.message || String(e) });
      const errorMsg = e?.message || '알 수 없는 오류';
      const returnUrl = this.extractReturnUrl(state);
      const sep = returnUrl.includes('?') ? '&' : '?';
      // DAR-443: 에러도 302 redirect 로 returnUrl?error= 전달 → sign-in.tsx 가 사유 표면화(DAR-43 §3).
      const deepLink = `${returnUrl}${sep}error=${encodeURIComponent(errorMsg)}`;
      return res.redirect(deepLink);
    }
  }

  /**
   * state 형식: `${nonce}~${encodeURIComponent(returnUrl)}`
   * returnUrl 은 모바일이 Linking.createURL('kakao')로 만든 앱 복귀 주소.
   * 없거나 파싱 실패 시 커스텀 스킴 폴백.
   */
  private extractReturnUrl(state: string): string {
    const tilde = (state ?? '').indexOf('~');
    if (tilde > -1) {
      try {
        const decoded = decodeURIComponent(state.slice(tilde + 1));
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(decoded)) return decoded;
      } catch {
        // fall through
      }
    }
    return 'gongsion://kakao';
  }

  @Get('kakao/result')
  @ApiOperation({ summary: '카카오 로그인 결과 조회' })
  async kakaoResult(@Query('state') state: string) {
    const result = this.authService.getAuthResult(state);
    if (!result) {
      return { success: false, data: null };
    }
    return { success: true, data: result };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  @ApiOperation({ summary: '토큰 갱신' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    const result = await this.authService.refresh(
      req.user.id,
      req.user.email,
      dto.refreshToken,
    );
    return { success: true, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃' })
  async logout(@CurrentUser('id') userId: string, @Body() dto: LogoutDto) {
    await this.authService.logout(userId, dto.deviceToken);
  }
}
