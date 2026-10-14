import { TIPO } from '../../common/dialeto';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Outbox transacional: o evento é gravado na MESMA transação da mudança de estado. */
@Entity({ name: 'eventos' })
export class Evento {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenant_id: string;
  @Column() tipo: string;
  @Column('uuid') agregado_id: string;
  @Column({ type: TIPO.json }) payload: Record<string, unknown>;
  @Column({ default: 'pendente' }) status: 'pendente' | 'entregue' | 'sem_assinantes' | 'falha';
  @Column('smallint', { default: 0 }) tentativas: number;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao }) proxima_tentativa: Date;
  @Column({ nullable: true }) ultimo_erro: string | null;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao, nullable: true }) entregue_em: Date | null;
  @CreateDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao }) created_at: Date;
}
