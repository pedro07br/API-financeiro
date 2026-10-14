import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { AtualizarRecorrenciaDto, CriarRecorrenciaDto, FiltroRecorrenciasDto, PrevisaoDto } from './recorrencias.dto';
import { RecorrenciasService } from './recorrencias.service';

@ApiTags('Recorrências')
@ApiBearerAuth()
@Controller('recorrencias')
export class RecorrenciasController {
  constructor(private readonly svc: RecorrenciasService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() f: FiltroRecorrenciasDto) {
    return this.svc.listar(u, f);
  }

  @Get(':id')
  @Permissoes(Permissao.LEITURA)
  obter(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detalhar(u, id);
  }

  @Get(':id/previsao')
  @Permissoes(Permissao.LEITURA)
  previsao(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: PrevisaoDto) {
    return this.svc.previsao(u, id, q.ciclos);
  }

  @Post()
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recorrência criada')
  criar(@Usuario() u: AuthUser, @Body() dto: CriarRecorrenciaDto) {
    return this.svc.criar(u, dto);
  }

  @Patch(':id')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recorrência atualizada')
  atualizar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarRecorrenciaDto) {
    return this.svc.atualizar(u, id, dto);
  }

  @Post(':id/pausar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recorrência pausada')
  pausar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.alterarAtiva(u, id, false);
  }

  @Post(':id/reativar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recorrência reativada')
  reativar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.alterarAtiva(u, id, true);
  }

  @Post(':id/gerar')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Cobrança da próxima competência gerada')
  gerar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.gerarAgora(u, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissoes(Permissao.ESCRITA)
  async remover(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remover(u, id);
  }
}
