import { Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { config } from '../../config';
import { EventosService } from '../eventos/eventos.service';
import { InadimplenciaService } from '../inadimplencia/inadimplencia.service';
import { RecorrenciasService } from '../recorrencias/recorrencias.service';

export type NomeJob = 'recorrencias' | 'vencimentos' | 'promessas' | 'eventos';

interface Execucao {
  job: NomeJob;
  inicio: string;
  duracao_ms: number;
  ok: boolean;
  resultado: unknown;
}

/**
 * Agendador: o "relógio" que faz o módulo agir sozinho, como um dispositivo IoT que reporta
 * leituras periodicamente sem que ninguém peça cada uma. Nenhum desses jobs exige ação humana.
 */
@Injectable()
export class AgendadorService {
  private readonly logger = new Logger('Agendador');
  private readonly ultimas = new Map<NomeJob, Execucao>();
  private readonly rodando = new Set<NomeJob>();

  constructor(
    private readonly recorrencias: RecorrenciasService,
    private readonly inadimplencia: InadimplenciaService,
    private readonly eventos: EventosService,
  ) {}

  @Cron('0 5 0 * * *', { timeZone: 'America/Sao_Paulo', name: 'recorrencias' })
  cronRecorrencias() {
    if (config.jobsEnabled) return this.executar('recorrencias');
  }

  @Cron('0 15 0 * * *', { timeZone: 'America/Sao_Paulo', name: 'vencimentos' })
  cronVencimentos() {
    if (config.jobsEnabled) return this.executar('vencimentos');
  }

  @Cron('0 20 0 * * *', { timeZone: 'America/Sao_Paulo', name: 'promessas' })
  cronPromessas() {
    if (config.jobsEnabled) return this.executar('promessas');
  }

  @Interval('eventos', 15_000)
  intervaloEventos() {
    if (config.jobsEnabled) return this.executar('eventos');
  }

  async executar(job: NomeJob, tenantId?: string) {
    if (this.rodando.has(job)) return { job, ignorado: 'execução anterior ainda em andamento' };
    this.rodando.add(job);
    const t0 = Date.now();
    const inicio = new Date().toISOString();
    try {
      const resultado = await this.rodar(job, tenantId);
      this.ultimas.set(job, { job, inicio, duracao_ms: Date.now() - t0, ok: true, resultado });
      if (job !== 'eventos' || (resultado as any).processados) this.logger.log(`${job}: ${JSON.stringify(resultado)}`);
      return { job, duracao_ms: Date.now() - t0, resultado };
    } catch (e: any) {
      this.ultimas.set(job, { job, inicio, duracao_ms: Date.now() - t0, ok: false, resultado: e?.message });
      this.logger.error(`${job} falhou: ${e?.message}`);
      throw e;
    } finally {
      this.rodando.delete(job);
    }
  }

  private rodar(job: NomeJob, tenantId?: string) {
    switch (job) {
      case 'recorrencias':
        return this.recorrencias.processarPendentes(tenantId);
      case 'vencimentos':
        return this.inadimplencia.marcarVencidas(tenantId);
      case 'promessas':
        return this.inadimplencia.verificarPromessas(tenantId);
      case 'eventos':
        return this.eventos.despachar();
    }
  }

  status() {
    return {
      agendamento_ativo: config.jobsEnabled,
      jobs: {
        recorrencias: { agenda: 'diariamente 00:05 (America/Sao_Paulo)', ultima: this.ultimas.get('recorrencias') ?? null },
        vencimentos: { agenda: 'diariamente 00:15', ultima: this.ultimas.get('vencimentos') ?? null },
        promessas: { agenda: 'diariamente 00:20', ultima: this.ultimas.get('promessas') ?? null },
        eventos: { agenda: 'a cada 15 segundos', ultima: this.ultimas.get('eventos') ?? null },
      },
    };
  }
}
