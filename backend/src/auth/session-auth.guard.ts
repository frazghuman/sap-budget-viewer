import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CaasService, caasDisplayName } from '../caas/caas.service';
import type { AuthedRequest } from './authed-request';
import type { SessionUser } from './session.types';
import type { CaasMe } from '../caas/caas.service';

export function extractToken(
  req: AuthedRequest,
  cookieName: string,
): string | null {
  const fromCookie = req.cookies?.[cookieName];
  if (fromCookie) return fromCookie;
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (header && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim() || null;
  }
  return null;
}

export function toSessionUser(me: CaasMe): SessionUser {
  return {
    sub: me._id,
    email: me.email,
    userType: me.userType,
    firstName: me.firstName,
    lastName: me.lastName,
    displayName: caasDisplayName(me),
    photoUrl: me.photoUrl,
  };
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly cookieName: string;

  constructor(
    private readonly caas: CaasService,
    config: ConfigService,
  ) {
    this.cookieName =
      config.get<string>('SESSION_COOKIE_NAME') || 'sbc_session';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = extractToken(req, this.cookieName);
    if (!token) throw new UnauthorizedException('Not authenticated');
    try {
      const me = await this.caas.getMe(token);
      req.caasToken = token;
      req.sessionUser = toSessionUser(me);
      return true;
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }
  }
}
