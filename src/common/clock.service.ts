import { Injectable } from '@nestjs/common';

/**
 * Fonte única de "agora" do módulo. Os jobs automáticos dependem de data;
 * centralizar aqui permite simular a passagem do tempo nos testes e na demonstração.
 */
@Injectable()
export class ClockService {
  private fixo: Date | null = null;

  agora(): Date {
    return this.fixo ? new Date(this.fixo) : new Date();
  }

  /** Data de hoje no fuso de Brasília, formato YYYY-MM-DD. */
  hoje(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(this.agora());
  }

  fixar(dataIso: string | null) {
    this.fixo = dataIso ? new Date(`${dataIso}T12:00:00-03:00`) : null;
  }
}
