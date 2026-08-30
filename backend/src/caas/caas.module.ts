import { Module } from '@nestjs/common';
import { CaasService } from './caas.service';

@Module({
  providers: [CaasService],
  exports: [CaasService],
})
export class CaasModule {}
