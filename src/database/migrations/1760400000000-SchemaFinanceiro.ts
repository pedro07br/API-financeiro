import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema próprio do módulo Financeiro. Regra (iii): nenhuma FK para schemas de outros módulos —
 * cliente_id, contrato_id, fornecedor_id, centro_custo_id etc. são apenas UUIDs resolvidos via API.
 * FKs existem somente entre tabelas do próprio schema.
 */
export class SchemaFinanceiro1760400000000 implements MigrationInterface {
  name = 'SchemaFinanceiro1760400000000';

  async up(q: QueryRunner): Promise<void> {
    const auditoria = `
      tenant_id uuid NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      deleted_at timestamptz NULL,
      created_by uuid NULL,
      updated_by uuid NULL,
      deleted_by uuid NULL`;

    await q.query(`CREATE SCHEMA IF NOT EXISTS financeiro`);

    await q.query(`CREATE TYPE financeiro.forma_pagamento AS ENUM
      ('pix','boleto','cartao_credito','cartao_debito','transferencia','dinheiro')`);
    await q.query(`CREATE TYPE financeiro.status_conta_receber AS ENUM
      ('em_aberto','agendada','paga','vencida','cancelada','estornada','parcialmente_paga')`);
    await q.query(`CREATE TYPE financeiro.status_conta_pagar AS ENUM
      ('em_aberto','agendada','paga','vencida','cancelada','parcialmente_paga')`);
    await q.query(`CREATE TYPE financeiro.status_cobranca AS ENUM ('rascunho','aprovada','paga','cancelada')`);
    await q.query(`CREATE TYPE financeiro.periodicidade AS ENUM ('mensal','trimestral','semestral','anual')`);

    await q.query(`CREATE TABLE financeiro.recorrencias (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id uuid NOT NULL,
      contrato_id uuid NOT NULL,
      descricao varchar(200) NOT NULL,
      periodicidade financeiro.periodicidade NOT NULL DEFAULT 'mensal',
      dia_vencimento smallint NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
      dias_antecedencia smallint NOT NULL DEFAULT 10 CHECK (dias_antecedencia BETWEEN 0 AND 60),
      data_inicio date NOT NULL,
      data_fim date NULL,
      proxima_competencia char(7) NOT NULL,
      forma_pagamento financeiro.forma_pagamento NOT NULL DEFAULT 'pix',
      aprovacao_automatica boolean NOT NULL DEFAULT true,
      ativa boolean NOT NULL DEFAULT true,
      itens jsonb NOT NULL,
      ${auditoria})`);
    await q.query(`CREATE INDEX ix_recorrencias_agenda ON financeiro.recorrencias (ativa, proxima_competencia) WHERE deleted_at IS NULL`);

    await q.query(`CREATE TABLE financeiro.cobrancas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id uuid NOT NULL,
      contrato_id uuid NULL,
      recorrencia_id uuid NULL REFERENCES financeiro.recorrencias(id),
      competencia char(7) NOT NULL,
      descricao varchar(200) NOT NULL,
      itens jsonb NOT NULL DEFAULT '[]',
      valor_total numeric(14,2) NOT NULL CHECK (valor_total > 0),
      data_vencimento date NOT NULL,
      forma_pagamento financeiro.forma_pagamento NOT NULL,
      status financeiro.status_cobranca NOT NULL DEFAULT 'rascunho',
      pix_txid varchar(35) NULL,
      pix_copia_cola text NULL,
      aprovada_em timestamptz NULL,
      aprovada_por uuid NULL,
      cancelada_em timestamptz NULL,
      motivo_cancelamento varchar(300) NULL,
      ${auditoria})`);
    await q.query(`CREATE UNIQUE INDEX ux_cobrancas_txid ON financeiro.cobrancas (pix_txid) WHERE pix_txid IS NOT NULL`);
    await q.query(`CREATE INDEX ix_cobrancas_tenant ON financeiro.cobrancas (tenant_id, status) WHERE deleted_at IS NULL`);

    await q.query(`CREATE TABLE financeiro.recorrencia_execucoes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      recorrencia_id uuid NOT NULL REFERENCES financeiro.recorrencias(id),
      competencia char(7) NOT NULL,
      cobranca_id uuid NOT NULL REFERENCES financeiro.cobrancas(id),
      origem varchar(20) NOT NULL,
      executada_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ux_recorrencia_competencia UNIQUE (recorrencia_id, competencia))`);

    await q.query(`CREATE TABLE financeiro.contas_receber (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id uuid NOT NULL,
      contrato_id uuid NULL,
      cobranca_id uuid NULL REFERENCES financeiro.cobrancas(id),
      descricao varchar(200) NOT NULL,
      competencia char(7) NOT NULL,
      data_vencimento date NOT NULL,
      valor numeric(14,2) NOT NULL CHECK (valor > 0),
      desconto numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
      juros numeric(14,2) NOT NULL DEFAULT 0 CHECK (juros >= 0),
      multa numeric(14,2) NOT NULL DEFAULT 0 CHECK (multa >= 0),
      valor_pago numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
      data_pagamento date NULL,
      forma_pagamento financeiro.forma_pagamento NULL,
      status financeiro.status_conta_receber NOT NULL DEFAULT 'em_aberto',
      pix_txid varchar(35) NULL,
      ${auditoria})`);
    await q.query(`CREATE INDEX ix_receber_tenant_status ON financeiro.contas_receber (tenant_id, status, data_vencimento) WHERE deleted_at IS NULL`);
    await q.query(`CREATE INDEX ix_receber_txid ON financeiro.contas_receber (pix_txid) WHERE pix_txid IS NOT NULL`);

    await q.query(`CREATE TABLE financeiro.contas_pagar (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      fornecedor_id uuid NOT NULL,
      centro_custo_id uuid NOT NULL,
      categoria_id uuid NOT NULL,
      descricao varchar(200) NOT NULL,
      documento varchar(60) NULL,
      competencia char(7) NOT NULL,
      data_vencimento date NOT NULL,
      valor numeric(14,2) NOT NULL CHECK (valor > 0),
      desconto numeric(14,2) NOT NULL DEFAULT 0 CHECK (desconto >= 0),
      juros numeric(14,2) NOT NULL DEFAULT 0 CHECK (juros >= 0),
      multa numeric(14,2) NOT NULL DEFAULT 0 CHECK (multa >= 0),
      valor_pago numeric(14,2) NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
      data_pagamento date NULL,
      forma_pagamento financeiro.forma_pagamento NULL,
      status financeiro.status_conta_pagar NOT NULL DEFAULT 'em_aberto',
      ${auditoria})`);
    await q.query(`CREATE INDEX ix_pagar_tenant_status ON financeiro.contas_pagar (tenant_id, status, data_vencimento) WHERE deleted_at IS NULL`);

    await q.query(`CREATE TABLE financeiro.promessas_pagamento (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conta_receber_id uuid NOT NULL REFERENCES financeiro.contas_receber(id),
      data_prometida date NOT NULL,
      valor numeric(14,2) NOT NULL CHECK (valor > 0),
      observacao varchar(500) NULL,
      status varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','cumprida','quebrada')),
      ${auditoria})`);

    await q.query(`CREATE TABLE financeiro.conciliacoes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      arquivo_nome varchar(200) NOT NULL,
      banco_id varchar(20) NULL,
      conta_id varchar(40) NULL,
      periodo_inicio date NULL,
      periodo_fim date NULL,
      total_transacoes int NOT NULL DEFAULT 0,
      conciliadas_automaticamente int NOT NULL DEFAULT 0,
      pendentes int NOT NULL DEFAULT 0,
      ignoradas_duplicadas int NOT NULL DEFAULT 0,
      ${auditoria})`);

    await q.query(`CREATE TABLE financeiro.extrato_transacoes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conciliacao_id uuid NOT NULL REFERENCES financeiro.conciliacoes(id),
      fitid varchar(100) NOT NULL,
      data date NOT NULL,
      valor numeric(14,2) NOT NULL,
      tipo varchar(10) NOT NULL CHECK (tipo IN ('credito','debito')),
      descricao varchar(300) NULL,
      status varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','conciliada','ignorada')),
      conta_receber_id uuid NULL REFERENCES financeiro.contas_receber(id),
      conta_pagar_id uuid NULL REFERENCES financeiro.contas_pagar(id),
      score smallint NULL,
      criterio varchar(60) NULL,
      conciliada_em timestamptz NULL,
      ${auditoria},
      CONSTRAINT ux_extrato_fitid UNIQUE (tenant_id, fitid))`);

    await q.query(`CREATE TABLE financeiro.pix_recebimentos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      end_to_end_id varchar(40) NOT NULL UNIQUE,
      txid varchar(35) NOT NULL,
      valor numeric(14,2) NOT NULL,
      horario timestamptz NOT NULL,
      conta_receber_id uuid NOT NULL REFERENCES financeiro.contas_receber(id),
      created_at timestamptz NOT NULL DEFAULT now())`);

    await q.query(`CREATE TABLE financeiro.eventos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      tipo varchar(60) NOT NULL,
      agregado_id uuid NOT NULL,
      payload jsonb NOT NULL,
      status varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','entregue','sem_assinantes','falha')),
      tentativas smallint NOT NULL DEFAULT 0,
      proxima_tentativa timestamptz NOT NULL DEFAULT now(),
      ultimo_erro varchar(500) NULL,
      entregue_em timestamptz NULL,
      created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX ix_eventos_fila ON financeiro.eventos (status, proxima_tentativa)`);

    await q.query(`CREATE TABLE financeiro.webhook_assinaturas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      modulo varchar(60) NOT NULL,
      url varchar(500) NOT NULL,
      eventos text[] NOT NULL,
      segredo varchar(120) NOT NULL,
      ativa boolean NOT NULL DEFAULT true,
      ${auditoria})`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP SCHEMA IF EXISTS financeiro CASCADE`);
  }
}
