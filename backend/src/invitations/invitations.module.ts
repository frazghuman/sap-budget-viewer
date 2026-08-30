import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { CaasModule } from '../caas/caas.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CaasModule, AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
