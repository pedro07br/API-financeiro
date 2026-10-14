import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Publico } from '../../common/auth/decorators';
import { config } from '../../config';
import { AgendadorService } from '../automacao/agendador.service';

const VERSAO = '0.1.0';

/** Endpoint público de disponibilidade, consultado automaticamente por outros módulos e monitoramento. */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly agendador: AgendadorService,
  ) {}

  @Get()
  @Publico()
  async health() {
    const t0 = Date.now();
    let banco: 'ok' | 'indisponivel' = 'ok';
    try {
      await this.ds.query('SELECT 1');
    } catch {
      banco = 'indisponivel';
    }
    const corpo = {
      status: banco === 'ok' ? 'ok' : 'degradado',
      modulo: 'financeiro',
      versao: VERSAO,
      uptime_s: Math.round(process.uptime()),
      dependencias: { banco: { tipo: config.banco, status: banco, latencia_ms: Date.now() - t0 } },
      agendador: this.agendador.status(),
    };
    if (banco !== 'ok') throw new ServiceUnavailableException({ message: 'Banco de dados indisponível', errors: [] });
    return corpo;
  }
}
