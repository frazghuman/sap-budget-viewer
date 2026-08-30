import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { CaasModule } from './caas/caas.module';
import { AuthModule } from './auth/auth.module';
import { ParserModule } from './parser/parser.module';
import { DatasetsModule } from './datasets/datasets.module';
import { InvitationsModule } from './invitations/invitations.module';

const DEFAULT_DB = 'sui-budget-control';

/** The database a connection string names, or '' when it names none. */
export function databaseIn(uri: string): string {
  const afterHost = uri.replace(/^mongodb(\+srv)?:\/\/[^/]*/i, '');
  const path = afterHost.split('?')[0].replace(/^\//, '');
  return decodeURIComponent(path);
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri =
          config.get<string>('MONGODB_URI') ||
          'mongodb://localhost:27017/sui-budget-control';
        // A URI with no path (…mongodb.net/) silently resolves to `test`, so a
        // deployment would quietly write its data into the wrong database.
        // Only applied when the URI names none — otherwise the URI wins.
        const dbName = databaseIn(uri) ? undefined : DEFAULT_DB;
        if (dbName) {
          new Logger('MongooseModule').warn(
            `MONGODB_URI names no database; defaulting to "${dbName}" ` +
              'rather than MongoDB\'s "test".',
          );
        }
        return { uri, ...(dbName ? { dbName } : {}) };
      },
    }),
    CaasModule,
    AuthModule,
    ParserModule,
    DatasetsModule,
    InvitationsModule,
  ],
})
export class AppModule {}
