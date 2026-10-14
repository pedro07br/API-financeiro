import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { CriarPromessaDto, FiltroInadimplenciaDto, FiltroPromessasDto } from './inadimplencia.dto';
import { InadimplenciaService } from './inadimplencia.service';

@ApiTags('Inadimplência')
@ApiBearerAuth()
@Controller('inadimplencia')
export class InadimplenciaController {
  constructor(private readonly svc: InadimplenciaService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() f: FiltroInadimplenciaDto) {
    return this.svc.listar(u, f);
  }

  @Get('resumo')
  @Permissoes(Permissao.LEITURA)
  resumo(@Usuario() u: AuthUser) {
    return this.svc.resumo(u);
  }

  @Get('promessas')
  @Permissoes(Permissao.LEITURA)
  promessas(@Usuario() u: AuthUser, @Query() f: FiltroPromessasDto) {
    return this.svc.listarPromessas(u, f);
  }

  @Post('promessas')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Promessa de pagamento registrada')
  criarPromessa(@Usuario() u: AuthUser, @Body() dto: CriarPromessaDto) {
    return this.svc.criarPromessa(u, dto);
  }
}
