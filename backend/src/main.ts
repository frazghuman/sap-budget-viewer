import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));

  const frontendUrl = (
    config.get<string>('FRONTEND_URL') || 'http://localhost:4200'
  ).replace(/\/$/, '');
  app.enableCors({
    origin: [frontendUrl],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  const port = Number(config.get<string>('PORT')) || 3000;
  await app.listen(port);
  Logger.log(
    `SUI Budget Control API listening on http://localhost:${port}/api`,
    'Bootstrap',
  );
}

void bootstrap();
