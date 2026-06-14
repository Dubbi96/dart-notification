import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const method = request.method;
    const url = request.url;
    const now = Date.now();

    return next.handle().pipe(
      // DAR-252: 성공·실패 모두 액세스 로그를 남긴다.
      // 기존엔 tap(next)만이라 에러(예: 500) 요청이 액세스 로그에 누락됐다(관측 공백).
      // 에러 경로에선 응답 status 가 아직 확정 전이라, HttpException 은 자체 status,
      // 그 외(미처리 예외)는 500 으로 기록한다.
      tap({
        next: () => {
          const response = context.switchToHttp().getResponse();
          const statusCode = response.statusCode;
          this.logger.log(`${method} ${url} ${statusCode} - ${Date.now() - now}ms`);
        },
        error: (err: unknown) => {
          const statusCode =
            err instanceof HttpException
              ? err.getStatus()
              : HttpStatus.INTERNAL_SERVER_ERROR;
          this.logger.log(`${method} ${url} ${statusCode} - ${Date.now() - now}ms`);
        },
      }),
    );
  }
}
