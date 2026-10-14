import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { AtualizarContaPagarDto, CriarContaPagarDto, FiltroContasPagarDto, PagamentoDto } from './contas-pagar.dto';
import { ContasPagarService } from './contas-pagar.service';

@ApiTags('Contas a pagar')
@ApiBearerAuth()
@Controller('contas-pagar')
export class ContasPagarController {
  constructor(private readonly svc: ContasPagarService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() f: FiltroContasPagarDto) {
    return this.svc.listar(u, f);
  }

  @Get(':id')
  @Permissoes(Permissao.LEITURA)
  obter(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detalhar(u, id);
  }

  @Post()
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Conta a pagar criada')
  criar(@Usuario() u: AuthUser, @Body() dto: CriarContaPagarDto) {
    return this.svc.criar(u, dto);
  }

  @Patch(':id')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Conta a pagar atualizada')
  atualizar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarContaPagarDto) {
    return this.svc.atualizar(u, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Permissoes(Permissao.ESCRITA)
  async remover(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.remover(u, id);
  }

  @Post(':id/pagamento')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Pagamento registrado')
  pagar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PagamentoDto) {
    return this.svc.pagar(u, id, dto);
  }
}
