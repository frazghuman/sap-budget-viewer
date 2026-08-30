import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaasService } from '../caas/caas.service';
import { isPlatformAdmin } from '../auth/auth.service';
import { PERMISSION_KEY } from './permission.decorator';
import type { RequiredPermission } from './permission.decorator';
import type { AuthedRequest } from '../auth/authed-request';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly caas: CaasService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = req.caasToken;
    const user = req.sessionUser;
    if (!token || !user) throw new UnauthorizedException('Not authenticated');

    if (isPlatformAdmin(user)) return true;

    const allowed = await this.caas.checkAccess(
      token,
      required.featureKey,
      required.action,
    );
    if (!allowed) {
      throw new ForbiddenException(
        `Missing permission ${required.featureKey}:${required.action}`,
      );
    }
    return true;
  }
}
