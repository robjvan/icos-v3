import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { CoreModule } from './core.module';
import { loadConfig } from './config';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const config = loadConfig();
  const core = await NestFactory.create<INestApplication>(CoreModule);

  core.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Permissive CORS for local dev. The bundled test client is same-origin,
  // so this exists for future Web/Desktop interfaces on other origins.
  // TODO: restrict to known origins when real frontends land.
  core.enableCors();

  await core.listen(config.port);
}

void bootstrap();
