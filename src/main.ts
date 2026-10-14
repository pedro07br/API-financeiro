import 'reflect-metadata';
import './config';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configurarApp, PREFIXO } from './bootstrap';
import { config } from './config';
import { garantirEstrutura } from './database/data-source';

async function main() {
  if (!config.jwt.publicKey) {
    throw new Error('Chave pública JWT não encontrada. Rode "npm run keys" (dev) ou defina JWT_PUBLIC_KEY_PATH.');
  }
  await garantirEstrutura();
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configurarApp(app);
  await app.listen(config.port);
  Logger.log(`Banco: ${config.banco}. Módulo Financeiro em http://localhost:${config.port}/${PREFIXO} — docs em /${PREFIXO}/docs`, 'Bootstrap');
}

main();
