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
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { KakaoAuthDto } from './dto/kakao-auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtRefreshGuard } from './guards/jwt-refresh.guard';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
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

      // Return HTML that closes the browser
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#F0FDFA;">
          <div style="text-align:center;">
            <p style="font-size:20px;color:#0D9488;">로그인 성공!</p>
            <p style="color:#6B7280;">앱으로 돌아가주세요.</p>
          </div>
        </body></html>
      `);
    } catch (e) {
      console.error('[KakaoCallback Error]', e?.message || e);
      const errorMsg = e?.message || '알 수 없는 오류';
      res.setHeader('Content-Type', 'text/html');
      return res.send(`
        <html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#FEF2F2;">
          <div style="text-align:center;">
            <p style="font-size:20px;color:#DC2626;">로그인 실패</p>
            <p style="color:#6B7280;">${errorMsg}</p>
            <p style="color:#9CA3AF;font-size:12px;">앱으로 돌아가서 다시 시도해주세요.</p>
          </div>
        </body></html>
      `);
    }
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
    const result = await this.authService.refresh(req.user.id, req.user.email);
    return { success: true, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃' })
  async logout() {
    await this.authService.logout();
  }
}
