import { chaves } from './env';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac, randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { garantirEstrutura } from '../src/database/data-source';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/bootstrap';
import { ClockService } from '../src/common/clock.service';
import { AgendadorService } from '../src/modules/automacao/agendador.service';
import { EventosService } from '../src/modules/eventos/eventos.service';
import { RecorrenciasService } from '../src/modules/recorrencias/recorrencias.service';

export const BASE = '/api/financeiro';

export function token(tenant_id: string, permissoes = ['financeiro:admin'], extra: object = {}, opts: jwt.SignOptions = {}) {
  return jwt.sign({ tenant_id, permissoes, tipo: 'usuario', ...extra }, chaves.privateKey, {
    algorithm: 'RS256',
    subject: randomUUID(),
    issuer: 'auth',
    expiresIn: '1h',
    ...opts,
  });
}

export function assinarPix(corpo: string) {
  return 'sha256=' + createHmac('sha256', process.env.PIX_WEBHOOK_SECRET!).update(corpo).digest('hex');
}

/** Apaga e recria a estrutura do módulo no banco de testes (schema no Postgres, database no MySQL). */
export async function recriarBanco() {
  if (config.banco === 'mysql') {
    const url = new URL(config.databaseUrl);
    const nome = url.pathname.slice(1);
    if (!/_test$|_bench$/.test(nome)) throw new Error(`Recuso apagar o database "${nome}": use um nome terminado em _test`);
    url.pathname = '/';
    const ds = new DataSource({ type: 'mysql', url: url.toString() });
    await ds.initialize();
    await ds.query(`DROP DATABASE IF EXISTS \`${nome}\``);
    await ds.destroy();
  } else {
    const ds = new DataSource({ type: 'postgres', url: config.databaseUrl });
    await ds.initialize();
    await ds.query('DROP SCHEMA IF EXISTS financeiro CASCADE');
    await ds.destroy();
  }
  await garantirEstrutura();
}

export async function criarApp() {
  try {
    await recriarBanco();
  } catch (e: any) {
    const u = new URL(config.databaseUrl);
    if (u.password) u.password = '***';
    const codigos = [e?.code, ...(e?.errors ?? []).map((x: any) => x?.code)];
    const motivo = codigos.includes('ECONNREFUSED')
      ? 'nada respondeu nesse endereço (o serviço do banco está rodando?)'
      : codigos.includes('ER_ACCESS_DENIED_ERROR') || codigos.includes('28P01')
        ? 'usuário ou senha recusados'
        : e?.message;
    throw new Error(`Testes não conseguiram usar o banco ${u.toString()}: ${motivo}. ` +
      'Os testes usam a DATABASE_URL do .env com o sufixo _test, ou TEST_DATABASE_URL se definida.');
  }

  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app: INestApplication = mod.createNestApplication({ rawBody: true, logger: ['error'] });
  configurarApp(app);
  await app.init();
  return {
    app,
    http: () => request(app.getHttpServer()),
    clock: app.get(ClockService),
    agendador: app.get(AgendadorService),
    eventos: app.get(EventosService),
    recorrencias: app.get(RecorrenciasService),
    ds: app.get(DataSource),
  };
}

export type Ctx = Awaited<ReturnType<typeof criarApp>>;

/** Cliente HTTP autenticado para um tenant. */
export function cliente(ctx: Ctx, tenant: string, permissoes?: string[]) {
  const t = token(tenant, permissoes);
  const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  return {
    get: (u: string) => h(ctx.http().get(BASE + u)),
    post: (u: string, b?: object) => h(ctx.http().post(BASE + u)).send(b ?? {}),
    patch: (u: string, b: object) => h(ctx.http().patch(BASE + u)).send(b),
    del: (u: string) => h(ctx.http().delete(BASE + u)),
  };
}

export const uuid = randomUUID;
