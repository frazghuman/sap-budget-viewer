import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest } from './authed-request';
import type { SessionUser } from './session.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    return req.sessionUser;
  },
);
