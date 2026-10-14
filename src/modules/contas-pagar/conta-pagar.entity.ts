import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { FormaPagamento, StatusContaPagar } from '../../common/enums';
import { numericTransformer } from '../../common/money';

@Entity({ name: 'contas_pagar' })
export class ContaPagar extends EntidadeBase {
  @Column('uuid') fornecedor_id: string;
  @Column('uuid') centro_custo_id: string;
  @Column('uuid') categoria_id: string;
  @Column() descricao: string;
  @Column({ nullable: true }) documento: string | null;
  @Column('char', { length: 7 }) competencia: string;
  @Column('date') data_vencimento: string;
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) desconto: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) juros: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) multa: number;
  @Column('numeric', { precision: 14, scale: 2, default: 0, transformer: numericTransformer }) valor_pago: number;
  @Column('date', { nullable: true }) data_pagamento: string | null;
  @Column({ type: 'enum', enum: FormaPagamento, enumName: 'forma_pagamento', nullable: true }) forma_pagamento: FormaPagamento | null;
  @Column({ type: 'enum', enum: StatusContaPagar, enumName: 'status_conta_pagar', default: StatusContaPagar.EM_ABERTO })
  status: StatusContaPagar;
}
