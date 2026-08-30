import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { CaasService } from '../caas/caas.service';
import { extractToken } from './session-auth.guard';
import type { AuthedRequest } from './authed-request';
import type { SessionResponse } from './session.types';

/** Only same-origin absolute paths survive, so `returnTo` cannot be an open redirect. */
function safeReturnTo(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '';
  return raw;
}

@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly returnToCookie: string;
  private readonly frontendUrl: string;
  private readonly caasWebUrl: string;
  private readonly callbackUrl: string;
  private readonly isProd: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly caas: CaasService,
    config: ConfigService,
  ) {
    this.cookieName =
      config.get<string>('SESSION_COOKIE_NAME') || 'sbc_session';
    this.returnToCookie = `${this.cookieName}_return_to`;
    this.frontendUrl = (
      config.get<string>('FRONTEND_URL') || 'http://localhost:4200'
    ).replace(/\/$/, '');
    this.caasWebUrl = (
      config.get<string>('CAAS_WEB_URL') || 'http://localhost:3500'
    ).replace(/\/$/, '');
    this.callbackUrl =
      config.get<string>('AUTH_CALLBACK_PUBLIC_URL') ||
      'http://localhost:4200/api/auth/callback';
    this.isProd = config.get<string>('NODE_ENV') === 'production';
  }

  private cookieOptions(maxAge = 1000 * 60 * 60 * 12) {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.isProd,
      path: '/',
      maxAge,
    };
  }

  @Get('login')
  login(
    @Query('returnTo') returnTo: string | undefined,
    @Res() res: import('express').Response,
  ): void {
    // The CaaS callback URL is registered per app, so the deep link the user
    // asked for is parked in a short-lived cookie instead of the redirect.
    const target = safeReturnTo(returnTo);
    if (target) {
      res.cookie(
        this.returnToCookie,
        target,
        this.cookieOptions(1000 * 60 * 10),
      );
    } else {
      res.clearCookie(this.returnToCookie, { path: '/' });
    }
    res.redirect(
      `${this.caasWebUrl}/auth/login?redirect=${encodeURIComponent(
        this.callbackUrl,
      )}`,
    );
  }

  @Get('callback')
  async callback(
    @Query('caas_token') caasToken: string,
    @Req() req: AuthedRequest,
    @Res() res: import('express').Response,
  ): Promise<void> {
    const returnTo = safeReturnTo(req.cookies?.[this.returnToCookie]);
    res.clearCookie(this.returnToCookie, { path: '/' });

    if (!caasToken) {
      res.redirect(`${this.frontendUrl}/?auth=missing_token`);
      return;
    }
    try {
      await this.caas.getMe(caasToken);
    } catch {
      res.redirect(`${this.frontendUrl}/?auth=invalid_token`);
      return;
    }
    res.cookie(this.cookieName, caasToken, this.cookieOptions());
    res.redirect(`${this.frontendUrl}${returnTo}`);
  }

  @Get('session')
  async session(@Req() req: AuthedRequest): Promise<SessionResponse> {
    const token = extractToken(req, this.cookieName);
    if (!token) return this.auth.anonymousSession();
    try {
      return await this.auth.buildSession(token);
    } catch {
      return this.auth.anonymousSession();
    }
  }

  @Post('logout')
  logout(@Res() res: import('express').Response): void {
    res.clearCookie(this.cookieName, { path: '/' });
    res.status(200).json({ success: true });
  }
}
