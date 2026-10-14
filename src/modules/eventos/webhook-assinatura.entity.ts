import { TIPO } from '../../common/dialeto';
import { Column, Entity } from 'typeorm';
import { EntidadeBase } from '../../common/entities/base.entity';

/** Outro módulo (ou sistema externo) se inscreve para ser avisado automaticamente de eventos financeiros. */
@Entity({ name: 'webhook_assinaturas' })
export class WebhookAssinatura extends EntidadeBase {
  @Column() modulo: string;
  @Column() url: string;
  @Column(TIPO.lista) eventos: string[];
  @Column({ select: false }) segredo: string;
  @Column({ default: true }) ativa: boolean;
}
