import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { AtualizarContaReceberDto, BaixaDto, CriarContaReceberDto, FiltroContasReceberDto } from './contas-receber.dto';
import { ContasReceberService } from './contas-receber.service';

@ApiTags('Contas a receber')
@ApiBearerAuth()
@Controller('contas-receber')
export class ContasReceberController {
  constructor(private readonly svc: ContasReceberService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() f: FiltroContasReceberDto) {
    return this.svc.listar(u, f);
  }

  @Get(':id')
  @Permissoes(Permissao.LEITURA)
  obter(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detalhar(u, id);
  }

  @Post()
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Conta a receber criada')
  criar(@Usuario() u: AuthUser, @Body() dto: CriarContaReceberDto) {
    return this.svc.criar(u, dto);
  }

  @Patch(':id')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Conta a receber atualizada')
  atualizar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarContaReceberDto) {
    return this.svc.atualizar(u, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissoes(Permissao.ESCRITA)
  async remover(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remover(u, id);
  }

  @Post(':id/baixa')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recebimento registrado')
  baixa(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: BaixaDto) {
    return this.svc.baixaManual(u, id, dto);
  }

  @Post(':id/estorno')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Recebimento estornado')
  estornar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.estornar(u, id);
  }
}
