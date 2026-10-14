import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { numericTransformer } from '../../common/money';

@Entity({ name: 'promessas_pagamento' })
export class PromessaPagamento extends EntidadeBase {
  @Column('uuid') conta_receber_id: string;
  @Column('date') data_prometida: string;
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor: number;
  @Column({ nullable: true }) observacao: string | null;
  @Column({ default: 'pendente' }) status: 'pendente' | 'cumprida' | 'quebrada';
}
