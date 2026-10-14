import { Controller, Get, HttpCode, Param, ParseEnumPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiParam, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { EventosService } from '../eventos/eventos.service';
import { AgendadorService, NomeJob } from './agendador.service';

enum Jobs {
  recorrencias = 'recorrencias',
  vencimentos = 'vencimentos',
  promessas = 'promessas',
  eventos = 'eventos',
}

@ApiTags('Automação')
@ApiBearerAuth()
@Controller('automacao')
export class AutomacaoController {
  constructor(
    private readonly agendador: AgendadorService,
    private readonly eventos: EventosService,
  ) {}

  @Get('status')
  @Permissoes(Permissao.LEITURA)
  async status(@Usuario() u: AuthUser) {
    return { ...this.agendador.status(), eventos_por_status: await this.eventos.contarPorStatus(u.tenant_id) };
  }

  /** Disparo manual de um job, restrito ao tenant de quem chama (útil para homologação e suporte). */
  @Post('executar/:job')
  @HttpCode(200)
  @Permissoes(Permissao.ADMIN)
  @Mensagem('Job executado')
  @ApiParam({ name: 'job', enum: Jobs })
  executar(@Usuario() u: AuthUser, @Param('job', new ParseEnumPipe(Jobs)) job: NomeJob) {
    return this.agendador.executar(job, job === 'eventos' ? undefined : u.tenant_id);
  }
}
