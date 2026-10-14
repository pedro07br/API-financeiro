import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { config } from '../../config';
import { AuthUser, Permissao } from './auth-user';
import { PERMISSOES, PUBLICO } from './decorators';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida o JWT RS256 emitido pelo módulo de Autenticação usando apenas a chave pública.
 * Nenhuma consulta a banco central é feita: cada serviço valida a identidade de forma
 * descentralizada (RFC 7519), como um nó autônomo da rede.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const alvo = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLICO, alvo)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    // Também aceita cookie httpOnly, pois o frontend roda em iframe e NÃO guarda token em localStorage.
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.['financeiro_token'];
    if (!token) throw new UnauthorizedException('Token de acesso ausente');

    let payload: any;
    try {
      payload = jwt.verify(token, config.jwt.publicKey, {
        algorithms: ['RS256'],
        issuer: config.jwt.issuer,
      });
    } catch (e: any) {
      throw new UnauthorizedException(e?.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido');
    }

    if (!payload.tenant_id || !UUID.test(payload.tenant_id) || !payload.sub) {
      throw new UnauthorizedException('Token sem tenant_id/sub válidos');
    }

    const user: AuthUser = {
      sub: payload.sub,
      tenant_id: payload.tenant_id,
      permissoes: Array.isArray(payload.permissoes) ? payload.permissoes : [],
      tipo: payload.tipo === 'servico' ? 'servico' : 'usuario',
      nome: payload.nome,
    };
    req.user = user;

    const exigidas = this.reflector.getAllAndOverride<string[]>(PERMISSOES, alvo) ?? [];
    const temTodas = exigidas.every(
      (p) => user.permissoes.includes(p) || user.permissoes.includes(Permissao.ADMIN),
    );
    if (!temTodas) throw new ForbiddenException(`Permissão necessária: ${exigidas.join(', ')}`);
    return true;
  }
}
