import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { AuthUser } from './auth-user';

export const PUBLICO = 'publico';
export const Publico = () => SetMetadata(PUBLICO, true);

export const PERMISSOES = 'permissoes';
export const Permissoes = (...p: string[]) => SetMetadata(PERMISSOES, p);

export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
