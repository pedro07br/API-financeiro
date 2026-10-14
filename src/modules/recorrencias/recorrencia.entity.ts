import { TIPO } from '../../common/dialeto';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { FormaPagamento, Periodicidade } from '../../common/enums';
import { ItemCobranca } from '../cobrancas/cobranca.entity';

@Entity({ name: 'recorrencias' })
export class Recorrencia extends EntidadeBase {
  @Column('uuid') cliente_id: string;
  @Column('uuid') contrato_id: string;
  @Column() descricao: string;
  @Column({ type: 'enum', enum: Periodicidade, enumName: 'periodicidade', default: Periodicidade.MENSAL }) periodicidade: Periodicidade;
  @Column('smallint') dia_vencimento: number;
  @Column('smallint', { default: 10 }) dias_antecedencia: number;
  @Column('date') data_inicio: string;
  @Column('date', { nullable: true }) data_fim: string | null;
  @Column('char', { length: 7 }) proxima_competencia: string;
  @Column({ type: 'enum', enum: FormaPagamento, enumName: 'forma_pagamento', default: FormaPagamento.PIX }) forma_pagamento: FormaPagamento;
  @Column({ default: true }) aprovacao_automatica: boolean;
  @Column({ default: true }) ativa: boolean;
  @Column({ type: TIPO.json }) itens: ItemCobranca[];
}

@Entity({ name: 'recorrencia_execucoes' })
export class RecorrenciaExecucao {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenant_id: string;
  @Column('uuid') recorrencia_id: string;
  @Column('char', { length: 7 }) competencia: string;
  @Column('uuid') cobranca_id: string;
  @Column() origem: string;
  @CreateDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao }) executada_em: Date;
}
