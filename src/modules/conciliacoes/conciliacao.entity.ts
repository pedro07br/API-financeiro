import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';
import { numericTransformer } from '../../common/money';

@Entity({ name: 'conciliacoes' })
export class Conciliacao extends EntidadeBase {
  @Column() arquivo_nome: string;
  @Column({ nullable: true }) banco_id: string | null;
  @Column({ nullable: true }) conta_id: string | null;
  @Column('date', { nullable: true }) periodo_inicio: string | null;
  @Column('date', { nullable: true }) periodo_fim: string | null;
  @Column('int', { default: 0 }) total_transacoes: number;
  @Column('int', { default: 0 }) conciliadas_automaticamente: number;
  @Column('int', { default: 0 }) pendentes: number;
  @Column('int', { default: 0 }) ignoradas_duplicadas: number;
}

@Entity({ name: 'extrato_transacoes' })
export class ExtratoTransacao extends EntidadeBase {
  @Column('uuid') conciliacao_id: string;
  @Column() fitid: string;
  @Column('date') data: string;
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor: number;
  @Column() tipo: 'credito' | 'debito';
  @Column({ nullable: true }) descricao: string | null;
  @Column({ default: 'pendente' }) status: 'pendente' | 'conciliada' | 'ignorada';
  @Column('uuid', { nullable: true }) conta_receber_id: string | null;
  @Column('uuid', { nullable: true }) conta_pagar_id: string | null;
  @Column('smallint', { nullable: true }) score: number | null;
  @Column({ nullable: true }) criterio: string | null;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao, nullable: true }) conciliada_em: Date | null;
}
