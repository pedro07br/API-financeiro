import {
  BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { Mensagem } from '../../common/http/resposta';
import { ConciliacoesService } from './conciliacoes.service';

class ImportarJsonDto {
  @ApiPropertyOptional({ example: 'extrato-outubro.ofx' }) @IsOptional() @IsString() @MaxLength(200) nome_arquivo?: string;
  @ApiPropertyOptional({ description: 'Conteúdo OFX em texto (alternativa ao upload multipart)' }) @IsOptional() @IsString() conteudo?: string;
}

class ConciliarManualDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() conta_receber_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conta_pagar_id?: string;
}

class FiltroTransacoesDto {
  @ApiPropertyOptional({ enum: ['pendente', 'conciliada', 'ignorada'] }) @IsOptional() @IsIn(['pendente', 'conciliada', 'ignorada']) status?: string;
}

const MAX_OFX = 5 * 1024 * 1024;

@ApiTags('Conciliação bancária')
@ApiBearerAuth()
@Controller('conciliacoes')
export class ConciliacoesController {
  constructor(private readonly svc: ConciliacoesService) {}

  @Post('importar')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Extrato importado e conciliado')
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { arquivo: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('arquivo', { limits: { fileSize: MAX_OFX } }))
  importar(@Usuario() u: AuthUser, @UploadedFile() arquivo: any, @Body() body: ImportarJsonDto) {
    if (arquivo?.buffer) return this.svc.importar(u, arquivo.originalname ?? 'extrato.ofx', arquivo.buffer);
    if (body?.conteudo) {
      if (body.conteudo.length > MAX_OFX) throw new BadRequestException('Arquivo maior que 5 MB');
      return this.svc.importar(u, body.nome_arquivo ?? 'extrato.ofx', Buffer.from(body.conteudo, 'utf8'));
    }
    throw new BadRequestException('Envie o arquivo OFX no campo "arquivo" (multipart) ou em "conteudo" (JSON)');
  }

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() p: PaginacaoDto) {
    return this.svc.listar(u, p);
  }

  @Get(':id')
  @Permissoes(Permissao.LEITURA)
  obter(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() f: FiltroTransacoesDto) {
    return this.svc.obter(u, id, f.status);
  }

  @Get(':id/transacoes/:transacaoId/sugestoes')
  @Permissoes(Permissao.LEITURA)
  sugestoes(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('transacaoId', ParseUUIDPipe) tid: string) {
    return this.svc.sugestoes(u, id, tid);
  }

  @Post(':id/transacoes/:transacaoId/conciliar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Transação conciliada manualmente')
  conciliar(
    @Usuario() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('transacaoId', ParseUUIDPipe) tid: string,
    @Body() dto: ConciliarManualDto,
  ) {
    return this.svc.conciliarManual(u, id, tid, dto);
  }

  @Post(':id/transacoes/:transacaoId/ignorar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Transação marcada como ignorada')
  ignorar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('transacaoId', ParseUUIDPipe) tid: string) {
    return this.svc.ignorar(u, id, tid);
  }
}
