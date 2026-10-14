import { TIPO } from '../../common/dialeto';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { numericTransformer } from '../../common/money';

/** Registro idempotente das notificações Pix recebidas (endToEndId é único no SPI). */
@Entity({ name: 'pix_recebimentos' })
export class PixRecebimento {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') tenant_id: string;
  @Column() end_to_end_id: string;
  @Column() txid: string;
  @Column('numeric', { precision: 14, scale: 2, transformer: numericTransformer }) valor: number;
  @Column({ type: TIPO.dataHora, precision: TIPO.precisao }) horario: Date;
  @Column('uuid') conta_receber_id: string;
  @CreateDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao }) created_at: Date;
}
