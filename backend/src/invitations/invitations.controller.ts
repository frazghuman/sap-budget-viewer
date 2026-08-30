import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SessionAuthGuard } from '../auth/session-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { InvitationsService } from './invitations.service';
import { AssignRoleDto, InviteDto, canManageUsers } from './invitations.types';
import type { AuthedRequest } from '../auth/authed-request';
import type { SessionUser } from '../auth/session.types';

/**
 * The user invitation centre, scoped to this application. Every call is
 * proxied to CaaS One with the caller's own token, so CaaS One re-checks the
 * caller's rights — this app widens nobody's access.
 */
@Controller('invitations')
@UseGuards(SessionAuthGuard)
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  private tokenOf(req: AuthedRequest, user: SessionUser): string {
    if (!canManageUsers(user)) {
      throw new ForbiddenException(
        'You need company, tenant or platform admin rights to manage users.',
      );
    }
    const token = req.caasToken;
    if (!token) throw new ForbiddenException('Not authenticated');
    return token;
  }

  /** CaaS One's own status codes are worth more to the UI than a blanket 500. */
  private async proxy<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e: unknown) {
      if (e instanceof HttpException) throw e;
      const status = (e as { status?: number })?.status;
      const message = e instanceof Error ? e.message : 'CaaS One request failed';
      if (status === 403) throw new ForbiddenException(message);
      throw new BadRequestException(message);
    }
  }

  @Get()
  list(@Req() req: AuthedRequest, @CurrentUser() user: SessionUser) {
    const token = this.tokenOf(req, user);
    return this.proxy(() => this.invitations.centre(token));
  }

  @Post()
  invite(
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
    @Body() dto: InviteDto,
  ) {
    const token = this.tokenOf(req, user);
    return this.proxy(() => this.invitations.invite(token, dto));
  }

  @Post(':userId/resend')
  async resend(
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
    @Param('userId') userId: string,
  ) {
    const token = this.tokenOf(req, user);
    await this.proxy(() => this.invitations.resendInvite(token, userId));
    return { ok: true };
  }

  @Post(':userId/invite-link')
  inviteLink(
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
    @Param('userId') userId: string,
  ) {
    const token = this.tokenOf(req, user);
    return this.proxy(() => this.invitations.inviteLink(token, userId));
  }

  @Post('role')
  assignRole(
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
    @Body() dto: AssignRoleDto,
  ) {
    const token = this.tokenOf(req, user);
    return this.proxy(() => this.invitations.assignRole(token, dto));
  }

  @Delete(':assignmentId')
  revoke(
    @Req() req: AuthedRequest,
    @CurrentUser() user: SessionUser,
    @Param('assignmentId') assignmentId: string,
  ) {
    const token = this.tokenOf(req, user);
    return this.proxy(() => this.invitations.revoke(token, assignmentId));
  }
}
