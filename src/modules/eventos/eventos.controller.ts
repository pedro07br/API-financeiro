import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { Mensagem } from '../../common/http/resposta';
import { EventosService } from './eventos.service';
import { TODOS_EVENTOS } from './tipos';

class CriarAssinaturaDto {
  @ApiProperty({ example: 'core' }) @IsString() @MaxLength(60) modulo: string;
  @ApiProperty({ example: 'http://core:3001/api/core/webhooks/financeiro' })
  @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] })
  url: string;
  @ApiProperty({ example: ['cobranca.paga', 'conta_receber.vencida'], enum: TODOS_EVENTOS, isArray: true })
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(TODOS_EVENTOS, { each: true })
  eventos: string[];
}

class ListarEventosDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: TODOS_EVENTOS }) @IsOptional() @IsIn(TODOS_EVENTOS) tipo?: string;
}

@ApiTags('Eventos e webhooks (integração entre módulos)')
@ApiBearerAuth()
@Controller('eventos')
export class EventosController {
  constructor(private readonly svc: EventosService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() q: ListarEventosDto) {
    return this.svc.listar(u, q);
  }

  @Get('assinaturas')
  @Permissoes(Permissao.ADMIN)
  listarAssinaturas(@Usuario() u: AuthUser) {
    return this.svc.listarAssinaturas(u);
  }

  @Post('assinaturas')
  @Permissoes(Permissao.ADMIN)
  @Mensagem('Assinatura criada. Guarde o segredo: ele não será exibido novamente.')
  criar(@Usuario() u: AuthUser, @Body() dto: CriarAssinaturaDto) {
    return this.svc.criarAssinatura(u, dto);
  }

  @Delete('assinaturas/:id')
  @HttpCode(204)
  @Permissoes(Permissao.ADMIN)
  async remover(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.svc.removerAssinatura(u, id);
  }
}
