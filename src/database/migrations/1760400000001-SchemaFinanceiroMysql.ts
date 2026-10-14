import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versão MySQL (8.0.16 ou superior) do schema do módulo Financeiro — mesma estrutura da migration PostgreSQL.
 * Diferenças de tipo: uuid → CHAR(36), timestamptz → DATETIME(6) em UTC, jsonb → JSON,
 * text[] → JSON, tipos ENUM declarados na própria coluna e índices sem cláusula WHERE.
 * Regra (iii) mantida: nenhuma FK para tabelas de outros módulos, só entre tabelas deste database.
 */
export class SchemaFinanceiroMysql1760400000001 implements MigrationInterface {
  name = 'SchemaFinanceiroMysql1760400000001';

  async up(q: QueryRunner): Promise<void> {
    const UUID = 'CHAR(36)';
    const PK = `id ${UUID} NOT NULL DEFAULT (UUID()) PRIMARY KEY`;
    const auditoria = `
      tenant_id ${UUID} NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
      deleted_at DATETIME(6) NULL,
      created_by ${UUID} NULL,
      updated_by ${UUID} NULL,
      deleted_by ${UUID} NULL`;
    const FIM = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

    const FORMA = `ENUM('pix','boleto','cartao_credito','cartao_debito','transferencia','dinheiro')`;
    const ST_RECEBER = `ENUM('em_aberto','agendada','paga','vencida','cancelada','estornada','parcialmente_paga')`;
    const ST_PAGAR = `ENUM('em_aberto','agendada','paga','vencida','cancelada','parcialmente_paga')`;
    const ST_COBRANCA = `ENUM('rascunho','aprovada','paga','cancelada')`;
    const PERIODICIDADE = `ENUM('mensal','trimestral','semestral','anual')`;
    const DINHEIRO = 'DECIMAL(14,2)';

    await q.query(`CREATE TABLE recorrencias (
      ${PK},
      cliente_id ${UUID} NOT NULL,
      contrato_id ${UUID} NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      periodicidade ${PERIODICIDADE} NOT NULL DEFAULT 'mensal',
      dia_vencimento SMALLINT NOT NULL CHECK (dia_vencimento BETWEEN 1 AND 31),
      dias_antecedencia SMALLINT NOT NULL DEFAULT 10 CHECK (dias_antecedencia BETWEEN 0 AND 60),
      data_inicio DATE NOT NULL,
      data_fim DATE NULL,
      proxima_competencia CHAR(7) NOT NULL,
      forma_pagamento ${FORMA} NOT NULL DEFAULT 'pix',
      aprovacao_automatica BOOLEAN NOT NULL DEFAULT TRUE,
      ativa BOOLEAN NOT NULL DEFAULT TRUE,
      itens JSON NOT NULL,
      ${auditoria},
      INDEX ix_recorrencias_agenda (ativa, proxima_competencia)
    ) ${FIM}`);

    await q.query(`CREATE TABLE cobrancas (
      ${PK},
      cliente_id ${UUID} NOT NULL,
      contrato_id ${UUID} NULL,
      recorrencia_id ${UUID} NULL,
      competencia CHAR(7) NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      itens JSON NOT NULL DEFAULT (JSON_ARRAY()),
      valor_total ${DINHEIRO} NOT NULL CHECK (valor_total > 0),
      data_vencimento DATE NOT NULL,
      forma_pagamento ${FORMA} NOT NULL,
      status ${ST_COBRANCA} NOT NULL DEFAULT 'rascunho',
      pix_txid VARCHAR(35) NULL,
      pix_copia_cola TEXT NULL,
      aprovada_em DATETIME(6) NULL,
      aprovada_por ${UUID} NULL,
      cancelada_em DATETIME(6) NULL,
      motivo_cancelamento VARCHAR(300) NULL,
      ${auditoria},
      UNIQUE KEY ux_cobrancas_txid (pix_txid),
      INDEX ix_cobrancas_tenant (tenant_id, status),
      CONSTRAINT fk_cobrancas_recorrencia FOREIGN KEY (recorrencia_id) REFERENCES recorrencias(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE recorrencia_execucoes (
      ${PK},
      tenant_id ${UUID} NOT NULL,
      recorrencia_id ${UUID} NOT NULL,
      competencia CHAR(7) NOT NULL,
      cobranca_id ${UUID} NOT NULL,
      origem VARCHAR(20) NOT NULL,
      executada_em DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY ux_recorrencia_competencia (recorrencia_id, competencia),
      CONSTRAINT fk_execucoes_recorrencia FOREIGN KEY (recorrencia_id) REFERENCES recorrencias(id),
      CONSTRAINT fk_execucoes_cobranca FOREIGN KEY (cobranca_id) REFERENCES cobrancas(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE contas_receber (
      ${PK},
      cliente_id ${UUID} NOT NULL,
      contrato_id ${UUID} NULL,
      cobranca_id ${UUID} NULL,
      descricao VARCHAR(200) NOT NULL,
      competencia CHAR(7) NOT NULL,
      data_vencimento DATE NOT NULL,
      valor ${DINHEIRO} NOT NULL CHECK (valor > 0),
      desconto ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (desconto >= 0),
      juros ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (juros >= 0),
      multa ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (multa >= 0),
      valor_pago ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
      data_pagamento DATE NULL,
      forma_pagamento ${FORMA} NULL,
      status ${ST_RECEBER} NOT NULL DEFAULT 'em_aberto',
      pix_txid VARCHAR(35) NULL,
      ${auditoria},
      INDEX ix_receber_tenant_status (tenant_id, status, data_vencimento),
      INDEX ix_receber_txid (pix_txid),
      CONSTRAINT fk_receber_cobranca FOREIGN KEY (cobranca_id) REFERENCES cobrancas(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE contas_pagar (
      ${PK},
      fornecedor_id ${UUID} NOT NULL,
      centro_custo_id ${UUID} NOT NULL,
      categoria_id ${UUID} NOT NULL,
      descricao VARCHAR(200) NOT NULL,
      documento VARCHAR(60) NULL,
      competencia CHAR(7) NOT NULL,
      data_vencimento DATE NOT NULL,
      valor ${DINHEIRO} NOT NULL CHECK (valor > 0),
      desconto ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (desconto >= 0),
      juros ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (juros >= 0),
      multa ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (multa >= 0),
      valor_pago ${DINHEIRO} NOT NULL DEFAULT 0 CHECK (valor_pago >= 0),
      data_pagamento DATE NULL,
      forma_pagamento ${FORMA} NULL,
      status ${ST_PAGAR} NOT NULL DEFAULT 'em_aberto',
      ${auditoria},
      INDEX ix_pagar_tenant_status (tenant_id, status, data_vencimento)
    ) ${FIM}`);

    await q.query(`CREATE TABLE promessas_pagamento (
      ${PK},
      conta_receber_id ${UUID} NOT NULL,
      data_prometida DATE NOT NULL,
      valor ${DINHEIRO} NOT NULL CHECK (valor > 0),
      observacao VARCHAR(500) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','cumprida','quebrada')),
      ${auditoria},
      CONSTRAINT fk_promessas_conta FOREIGN KEY (conta_receber_id) REFERENCES contas_receber(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE conciliacoes (
      ${PK},
      arquivo_nome VARCHAR(200) NOT NULL,
      banco_id VARCHAR(20) NULL,
      conta_id VARCHAR(40) NULL,
      periodo_inicio DATE NULL,
      periodo_fim DATE NULL,
      total_transacoes INT NOT NULL DEFAULT 0,
      conciliadas_automaticamente INT NOT NULL DEFAULT 0,
      pendentes INT NOT NULL DEFAULT 0,
      ignoradas_duplicadas INT NOT NULL DEFAULT 0,
      ${auditoria}
    ) ${FIM}`);

    await q.query(`CREATE TABLE extrato_transacoes (
      ${PK},
      conciliacao_id ${UUID} NOT NULL,
      fitid VARCHAR(100) NOT NULL,
      data DATE NOT NULL,
      valor ${DINHEIRO} NOT NULL,
      tipo VARCHAR(10) NOT NULL CHECK (tipo IN ('credito','debito')),
      descricao VARCHAR(300) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','conciliada','ignorada')),
      conta_receber_id ${UUID} NULL,
      conta_pagar_id ${UUID} NULL,
      score SMALLINT NULL,
      criterio VARCHAR(60) NULL,
      conciliada_em DATETIME(6) NULL,
      ${auditoria},
      UNIQUE KEY ux_extrato_fitid (tenant_id, fitid),
      CONSTRAINT fk_extrato_conciliacao FOREIGN KEY (conciliacao_id) REFERENCES conciliacoes(id),
      CONSTRAINT fk_extrato_receber FOREIGN KEY (conta_receber_id) REFERENCES contas_receber(id),
      CONSTRAINT fk_extrato_pagar FOREIGN KEY (conta_pagar_id) REFERENCES contas_pagar(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE pix_recebimentos (
      ${PK},
      tenant_id ${UUID} NOT NULL,
      end_to_end_id VARCHAR(40) NOT NULL,
      txid VARCHAR(35) NOT NULL,
      valor ${DINHEIRO} NOT NULL,
      horario DATETIME(6) NOT NULL,
      conta_receber_id ${UUID} NOT NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      UNIQUE KEY ux_pix_e2e (end_to_end_id),
      CONSTRAINT fk_pix_conta FOREIGN KEY (conta_receber_id) REFERENCES contas_receber(id)
    ) ${FIM}`);

    await q.query(`CREATE TABLE eventos (
      ${PK},
      tenant_id ${UUID} NOT NULL,
      tipo VARCHAR(60) NOT NULL,
      agregado_id ${UUID} NOT NULL,
      payload JSON NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','entregue','sem_assinantes','falha')),
      tentativas SMALLINT NOT NULL DEFAULT 0,
      proxima_tentativa DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      ultimo_erro VARCHAR(500) NULL,
      entregue_em DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
      INDEX ix_eventos_fila (status, proxima_tentativa)
    ) ${FIM}`);

    await q.query(`CREATE TABLE webhook_assinaturas (
      ${PK},
      modulo VARCHAR(60) NOT NULL,
      url VARCHAR(500) NOT NULL,
      eventos JSON NOT NULL,
      segredo VARCHAR(120) NOT NULL,
      ativa BOOLEAN NOT NULL DEFAULT TRUE,
      ${auditoria}
    ) ${FIM}`);
  }

  async down(q: QueryRunner): Promise<void> {
    for (const t of [
      'webhook_assinaturas', 'eventos', 'pix_recebimentos', 'extrato_transacoes', 'conciliacoes', 'promessas_pagamento',
      'contas_pagar', 'contas_receber', 'recorrencia_execucoes', 'cobrancas', 'recorrencias',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${t}`);
    }
  }
}
