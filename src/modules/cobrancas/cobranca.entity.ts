import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { FormaPagamento, StatusCobranca } from '../../common/enums';
import { numericTransformer } from '../../common/money';

export interface ItemCobranca {
  tipo: 'servico' | 'consumo' | 'extra';
  servico_id?: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
}

@Entity({ name: 'cobrancas' })
export class Cobranca extends EntidadeBase {
  @Column('uuid') cliente_id: string;
  @Column('uuid', { nullable: true }) contrato_id: string | null;
  @Column('uuid', { nullable: true }) recorrencia_id: string | null;
  @Column('char', { length: 7 }) competencia: string;
  @Column() descricao: string;
  @Column({ type: TIPO.json }) itens: ItemCobranca[];
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor_total: number;
  @Column('date') data_vencimento: string;
  @Column({ type: 'enum', enum: FormaPagamento, enumName: 'forma_pagamento' }) forma_pagamento: FormaPagamento;
  @Column({ type: 'enum', enum: StatusCobranca, enumName: 'status_cobranca', default: StatusCobranca.RASCUNHO }) status: StatusCobranca;
  @Column({ nullable: true }) pix_txid: string | null;
  @Column('text', { nullable: true }) pix_copia_cola: string | null;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao, nullable: true }) aprovada_em: Date | null;
  @Column('uuid', { nullable: true }) aprovada_por: string | null;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao, nullable: true }) cancelada_em: Date | null;
  @Column({ nullable: true }) motivo_cancelamento: string | null;
}
