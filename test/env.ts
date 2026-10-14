import { generateKeyPairSync } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Banco usado nos testes, em ordem de prioridade:
 *  1. TEST_DATABASE_URL, se definida;
 *  2. a DATABASE_URL do .env, trocando o nome do banco por <nome>_test (o banco de trabalho nunca é tocado);
 *  3. PostgreSQL local em erp_test.
 */
function urlDeTeste(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const arq = resolve(process.cwd(), '.env');
  if (existsSync(arq)) {
    const linha = readFileSync(arq, 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*DATABASE_URL\s*=/.test(l));
    if (linha) {
      const url = new URL(linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, ''));
      const nome = url.pathname.replace(/^\//, '') || 'financeiro';
      url.pathname = '/' + (nome.endsWith('_test') ? nome : `${nome}_test`);
      return url.toString();
    }
  }
  return 'postgres://financeiro:financeiro@localhost:5432/erp_test';
}

// Precisa rodar ANTES de qualquer import de src/ (config é lido no carregamento).
export const chaves = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
process.env.ENV_FILE = '.env.inexistente';
process.env.DATABASE_URL = urlDeTeste();
process.env.JWT_PUBLIC_KEY = chaves.publicKey;
process.env.JWT_ISSUER = 'auth';
process.env.JOBS_ENABLED = 'false';
process.env.PIX_WEBHOOK_SECRET = 'segredo-de-teste';
