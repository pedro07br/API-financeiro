import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

// Carrega .env (Node 22 tem loader nativo). Variáveis já definidas no ambiente têm prioridade.
const envFile = resolve(process.cwd(), process.env.ENV_FILE ?? '.env');
if (existsSync(envFile)) {
  try {
    (process as any).loadEnvFile(envFile);
  } catch {
    /* ignora .env inválido */
  }
}

function lerChavePublica(): string {
  if (process.env.JWT_PUBLIC_KEY) return process.env.JWT_PUBLIC_KEY.replace(/\\n/g, '\n');
  const caminho = resolve(process.cwd(), process.env.JWT_PUBLIC_KEY_PATH ?? './keys/auth-public.pem');
  return existsSync(caminho) ? readFileSync(caminho, 'utf8') : '';
}

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://financeiro:financeiro@localhost:5432/erp';

/** O banco é escolhido pelo esquema da URL: postgres://… ou mysql://… */
export type TipoBanco = 'postgres' | 'mysql';
const tipoBanco: TipoBanco = /^mysql:/i.test(databaseUrl) ? 'mysql' : 'postgres';

export const config = {
  port: Number(process.env.PORT ?? 3008),
  databaseUrl,
  banco: tipoBanco,
  jwt: {
    get publicKey() {
      return lerChavePublica();
    },
    issuer: process.env.JWT_ISSUER || undefined,
  },
  pix: {
    webhookSecret: process.env.PIX_WEBHOOK_SECRET ?? 'troque-este-segredo',
    chaveRecebedor: process.env.PIX_CHAVE_RECEBEDOR ?? 'financeiro@empresa.com.br',
    // Aparecem no app do pagador ao ler o QR Code (até 25 e 15 caracteres, sem acento)
    nomeRecebedor: process.env.PIX_NOME_RECEBEDOR ?? 'EMPRESA',
    cidadeRecebedor: process.env.PIX_CIDADE_RECEBEDOR ?? 'GOIANIA',
  },
  jobsEnabled: (process.env.JOBS_ENABLED ?? 'true') === 'true',
  encargos: {
    multaPercentual: Number(process.env.MULTA_PERCENTUAL ?? 2),
    jurosMensalPercentual: Number(process.env.JUROS_MENSAL_PERCENTUAL ?? 1),
  },
};
