import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DatasetsController } from './datasets.controller';
import { PublicDatasetsController } from './public-datasets.controller';
import { DatasetsService } from './datasets.service';
import { Dataset, DatasetSchema } from './dataset.schema';
import { ParserModule } from '../parser/parser.module';
import { CaasModule } from '../caas/caas.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Dataset.name, schema: DatasetSchema }]),
    ParserModule,
    CaasModule,
    AuthModule,
  ],
  controllers: [DatasetsController, PublicDatasetsController],
  providers: [DatasetsService],
  exports: [DatasetsService],
})
export class DatasetsModule {}
