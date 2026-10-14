/**
 * DESENVOLVIMENTO: emite um JWT RS256 como o módulo de Autenticação faria.
 * Uso: npm run token -- [tenant_uuid] [usuario|servico] [permissões separadas por vírgula]
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import * as jwt from 'jsonwebtoken';

export function emitirToken(p: { tenant_id: string; sub?: string; tipo?: 'usuario' | 'servico'; permissoes?: string[]; expiresIn?: string | number }, chave?: string) {
  return jwt.sign(
    {
      tenant_id: p.tenant_id,
      tipo: p.tipo ?? 'usuario',
      permissoes: p.permissoes ?? ['financeiro:admin'],
    },
    chave ?? readFileSync('keys/auth-private.pem', 'utf8'),
    { algorithm: 'RS256', subject: p.sub ?? randomUUID(), issuer: 'auth', expiresIn: (p.expiresIn ?? '8h') as any },
  );
}

if (require.main === module) {
  const [tenant = randomUUID(), tipo = 'usuario', perms = 'financeiro:admin'] = process.argv.slice(2);
  console.log(emitirToken({ tenant_id: tenant, tipo: tipo as any, permissoes: perms.split(',') }));
}
