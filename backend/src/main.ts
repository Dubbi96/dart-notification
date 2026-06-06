import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global prefix — 운영 헬스 프로브(/health·/health/live)는 prefix 제외(probe 는 /api 미사용, DAR-111).
  app.setGlobalPrefix('api', { exclude: ['health', 'health/live'] });

  // Security
  // 개발 환경(http)에서는 Helmet의 https 강제 헤더를 끈다.
  // (upgrade-insecure-requests / HSTS / COOP 가 http 접속을 깨뜨림 — Swagger·카카오 콜백 등)
  const isProd = process.env.NODE_ENV === 'production';
  app.use(
    helmet({
      contentSecurityPolicy: isProd ? undefined : false,
      hsts: isProd ? undefined : false,
      crossOriginOpenerPolicy: isProd ? undefined : false,
      crossOriginResourcePolicy: isProd ? undefined : false,
    }),
  );

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('DART Notification API')
    .setDescription('DART 공시 알림 서비스 API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
}
bootstrap();
