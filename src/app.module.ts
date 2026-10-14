import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtGuard } from './common/auth/jwt.guard';
import { ClockService } from './common/clock.service';
import { ExcecaoFilter } from './common/http/excecao.filter';
import { RespostaInterceptor } from './common/http/resposta.interceptor';
import { opcoesBanco } from './database/data-source';
import { AgendadorService } from './modules/automacao/agendador.service';
import { AutomacaoController } from './modules/automacao/automacao.controller';
import { CobrancasController } from './modules/cobrancas/cobrancas.controller';
import { CobrancasService } from './modules/cobrancas/cobrancas.service';
import { ConciliacoesController } from './modules/conciliacoes/conciliacoes.controller';
import { ConciliacoesService } from './modules/conciliacoes/conciliacoes.service';
import { ContasPagarController } from './modules/contas-pagar/contas-pagar.controller';
import { ContasPagarService } from './modules/contas-pagar/contas-pagar.service';
import { ContasReceberController } from './modules/contas-receber/contas-receber.controller';
import { ContasReceberService } from './modules/contas-receber/contas-receber.service';
import { Evento } from './modules/eventos/evento.entity';
import { EventosController } from './modules/eventos/eventos.controller';
import { EventosService } from './modules/eventos/eventos.service';
import { WebhookAssinatura } from './modules/eventos/webhook-assinatura.entity';
import { HealthController } from './modules/health/health.controller';
import { InadimplenciaController } from './modules/inadimplencia/inadimplencia.controller';
import { InadimplenciaService } from './modules/inadimplencia/inadimplencia.service';
import { PixWebhookController } from './modules/pix/pix-webhook.controller';
import { PixService } from './modules/pix/pix.service';
import { RecorrenciasController } from './modules/recorrencias/recorrencias.controller';
import { RecorrenciasService } from './modules/recorrencias/recorrencias.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({ ...opcoesBanco(), migrationsRun: true }),
    TypeOrmModule.forFeature([Evento, WebhookAssinatura]),
    ScheduleModule.forRoot(),
  ],
  controllers: [
    HealthController,
    ContasReceberController,
    ContasPagarController,
    CobrancasController,
    RecorrenciasController,
    InadimplenciaController,
    ConciliacoesController,
    PixWebhookController,
    EventosController,
    AutomacaoController,
  ],
  providers: [
    ClockService,
    EventosService,
    ContasReceberService,
    ContasPagarService,
    CobrancasService,
    RecorrenciasService,
    InadimplenciaService,
    ConciliacoesService,
    PixService,
    AgendadorService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_INTERCEPTOR, useClass: RespostaInterceptor },
    { provide: APP_FILTER, useClass: ExcecaoFilter },
  ],
})
export class AppModule {}
