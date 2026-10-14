/**
 * DESENVOLVIMENTO: gera um par RSA simulando o módulo de Autenticação.
 * Em produção, o Financeiro recebe SOMENTE a chave pública; a privada fica no módulo de Auth.
 */
import { generateKeyPairSync } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

mkdirSync('keys', { recursive: true });
if (existsSync('keys/auth-private.pem') && !process.argv.includes('--force')) {
  console.log('keys/ já existe (use --force para recriar)');
  process.exit(0);
}
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
writeFileSync('keys/auth-public.pem', publicKey);
writeFileSync('keys/auth-private.pem', privateKey, { mode: 0o600 });
console.log('Par RS256 gerado em keys/ (auth-public.pem / auth-private.pem)');
