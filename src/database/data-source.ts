import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from '../config';
import { SchemaFinanceiro1760400000000 } from './migrations/1760400000000-SchemaFinanceiro';
import { SchemaFinanceiroMysql1760400000001 } from './migrations/1760400000001-SchemaFinanceiroMysql';

const entities = [__dirname + '/../modules/**/*.entity.{ts,js}'];

/**
 * PostgreSQL: schema próprio "financeiro" dentro do banco do sistema.
 * MySQL: como lá "schema" e "database" são a mesma coisa, o módulo usa um database próprio
 * (o nome que vier na DATABASE_URL), mantendo o isolamento entre módulos.
 */
export const opcoesBanco = (): DataSourceOptions =>
  config.banco === 'mysql'
    ? {
        type: 'mysql',
        url: config.databaseUrl,
        entities,
        migrations: [SchemaFinanceiroMysql1760400000001],
        migrationsTableName: 'migrations',
        synchronize: false,
        timezone: 'Z', // grava DATETIME em UTC
        dateStrings: ['DATE'], // colunas DATE chegam como 'AAAA-MM-DD', igual ao Postgres
        charset: 'utf8mb4_0900_ai_ci',
        supportBigNumbers: true,
      }
    : {
        type: 'postgres',
        url: config.databaseUrl,
        schema: 'financeiro',
        entities,
        migrations: [SchemaFinanceiro1760400000000],
        migrationsTableName: 'migrations',
        synchronize: false,
      };

/** Cria o schema (Postgres) ou o database (MySQL) do módulo, se ainda não existir. */
export async function garantirEstrutura() {
  if (config.banco === 'mysql') {
    const url = new URL(config.databaseUrl);
    const nome = decodeURIComponent(url.pathname.replace(/^\//, ''));
    if (!/^[A-Za-z0-9_]+$/.test(nome)) throw new Error(`Nome de database inválido na DATABASE_URL: "${nome}"`);
    url.pathname = '/';
    const ds = new DataSource({ type: 'mysql', url: url.toString() });
    await ds.initialize();
    await ds.query(`CREATE DATABASE IF NOT EXISTS \`${nome}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await ds.destroy();
  } else {
    const ds = new DataSource({ type: 'postgres', url: config.databaseUrl });
    await ds.initialize();
    await ds.query('CREATE SCHEMA IF NOT EXISTS financeiro');
    await ds.destroy();
  }
}

export default new DataSource(opcoesBanco());
