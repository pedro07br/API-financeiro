import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { FormaPagamento, StatusContaReceber } from '../../common/enums';
import { numericTransformer } from '../../common/money';

@Entity({ name: 'contas_receber' })
export class ContaReceber extends EntidadeBase {
  @Column('uuid') cliente_id: string;
  @Column('uuid', { nullable: true }) contrato_id: string | null;
  @Column('uuid', { nullable: true }) cobranca_id: string | null;
  @Column() descricao: string;
  @Column('char', { length: 7 }) competencia: string;
  @Column('date') data_vencimento: string;
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) desconto: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) juros: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) multa: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) valor_pago: number;
  @Column('date', { nullable: true }) data_pagamento: string | null;
  @Column({ type: 'enum', enum: FormaPagamento, enumName: 'forma_pagamento', nullable: true }) forma_pagamento: FormaPagamento | null;
  @Column({ type: 'enum', enum: StatusContaReceber, enumName: 'status_conta_receber', default: StatusContaReceber.EM_ABERTO })
  status: StatusContaReceber;
  @Column({ nullable: true }) pix_txid: string | null;
}
