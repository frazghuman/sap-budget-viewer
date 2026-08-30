import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CaasModule } from './caas/caas.module';
import { AuthModule } from './auth/auth.module';
import { ParserModule } from './parser/parser.module';
import { DatasetsModule } from './datasets/datasets.module';
import { InvitationsModule } from './invitations/invitations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri:
          config.get<string>('MONGODB_URI') ||
          'mongodb://localhost:27017/sui-budget-control',
      }),
    }),
    CaasModule,
    AuthModule,
    ParserModule,
    DatasetsModule,
    InvitationsModule,
  ],
})
export class AppModule {}
