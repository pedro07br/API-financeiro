import { TIPO } from '../dialeto';
import { Column, CreateDateColumn, DeleteDateColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Regra técnica (i) do projeto: toda tabela de negócio possui id único, tenant e campos de auditoria,
 * com exclusão lógica (soft delete).
 */
export abstract class EntidadeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  tenant_id: string;

  @CreateDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao })
  created_at: Date;

  @UpdateDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao })
  updated_at: Date;

  @DeleteDateColumn({ type: TIPO.dataHora, precision: TIPO.precisao, nullable: true })
  deleted_at: Date | null;

  @Column('uuid', { nullable: true })
  created_by: string | null;

  @Column('uuid', { nullable: true })
  updated_by: string | null;

  @Column('uuid', { nullable: true })
  deleted_by: string | null;
}
