import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { resolveCorsOrigin } from './common/config/cors-origin';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // DAR-252: graceful shutdown.
  // SIGTERM/SIGINT(재배포·스케일다운) 시 Nest 의 OnModuleDestroy/OnApplicationShutdown 훅을 발화시킨다.
  // → PrismaService.onModuleDestroy 가 $disconnect 로 DB 좀비 커넥션을 정리하고,
  //   @nestjs/bullmq 가 worker.close() 로 in-flight job 절단 없이 워커를 정리한다.
  //   (이 호출이 없으면 위 훅들이 영원히 미발화 → 재배포마다 누수.)
  app.enableShutdownHooks();

  // DAR-114: ETag/조건부요청(304) 비활성화.
  // Express는 기본으로 응답에 ETag를 붙인다. 모바일(React Native/OkHttp)이 재요청 시
  // If-None-Match 를 보내면 서버가 304(본문 없음)를 반환하는데, RN 네트워크 계층이 304에서
  // 캐시 본문을 제대로 복원하지 못해 빈 응답이 되고 화면이 비는 버그가 있었다(에러 없이 무데이터).
  // 동적 API 응답엔 ETag 캐시 이득이 없으므로 끈다 → 항상 200 + 전체 본문 반환.
  const expressInstance = app.getHttpAdapter().getInstance();
  expressInstance.set('etag', false);

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

  // CORS (DAR-252)
  // 개발은 모든 origin 반영(편의). 운영은 CORS_ALLOWED_ORIGINS(콤마구분) 화이트리스트만 허용한다.
  // origin: true(전체 반영) + credentials 조합은 운영에서 임의 사이트의 credentialed
  // cross-origin 요청을 허용하는 표면이므로 prod 에서는 명시 origin 만 반영한다.
  app.enableCors({
    origin: resolveCorsOrigin(isProd, process.env.CORS_ALLOWED_ORIGINS),
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

  // DAR-252: 전역 예외 필터 + 요청 로깅 인터셉터 등록.
  // 구현은 돼 있었으나 등록이 0건이라 dead code 였다.
  //  - AllExceptionsFilter: 모든 에러 응답을 {success:false,error:{code,message}} 표준포맷으로 정규화.
  //  - LoggingInterceptor: 모든 요청을 `METHOD url status - Nms` 액세스 로그로 관측.
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Swagger — W17 prod 게이트: production 에서는 미설정.
  // /api/docs 가 NODE_ENV 무관 무조건 노출되어 공개 IP에서 전체 API 스펙이
  // 무인증 열람 가능하던 표면을 차단한다. 개발/로컬에서만 노출.
  if (!isProd) {
    const config = new DocumentBuilder()
      .setTitle('DART Notification API')
      .setDescription('DART 공시 알림 서비스 API')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`Application is running on: http://localhost:${port}`);
  if (!isProd) {
    logger.log(`Swagger docs: http://localhost:${port}/api/docs`);
  }
}
bootstrap();
