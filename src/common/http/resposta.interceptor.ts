import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, Observable } from 'rxjs';
import { MENSAGEM, RespostaPadrao } from './resposta';

@Injectable()
export class RespostaInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<RespostaPadrao | undefined> {
    const mensagem = this.reflector.get<string>(MENSAGEM, ctx.getHandler()) ?? null;
    return next.handle().pipe(
      map((data) => {
        const res = ctx.switchToHttp().getResponse();
        if (res.statusCode === 204) return undefined;
        return { success: true, data: data ?? null, message: mensagem, errors: null };
      }),
    );
  }
}
