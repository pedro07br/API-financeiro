import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { Permissoes, Usuario } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { AtualizarCobrancaDto, CancelarCobrancaDto, CriarCobrancaDto, FiltroCobrancasDto, QrCodeDto } from './cobrancas.dto';
import { CobrancasService } from './cobrancas.service';

@ApiTags('Cobranças')
@ApiBearerAuth()
@Controller('cobrancas')
export class CobrancasController {
  constructor(private readonly svc: CobrancasService) {}

  @Get()
  @Permissoes(Permissao.LEITURA)
  listar(@Usuario() u: AuthUser, @Query() f: FiltroCobrancasDto) {
    return this.svc.listar(u, f);
  }

  @Get(':id')
  @Permissoes(Permissao.LEITURA)
  obter(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.obter(u, id);
  }

  /** Imagem do QR Code Pix para exibir na tela, no e-mail ou na fatura. Devolve a imagem, não JSON. */
  @Get(':id/qrcode')
  @Permissoes(Permissao.LEITURA)
  @ApiProduces('image/png', 'image/svg+xml')
  async qrCode(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: QrCodeDto, @Res() res: any) {
    const img = await this.svc.qrCode(u, id, q.formato, q.tamanho);
    res.setHeader('Content-Type', img.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(img.corpo);
  }

  @Post()
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Cobrança criada em rascunho')
  criar(@Usuario() u: AuthUser, @Body() dto: CriarCobrancaDto) {
    return this.svc.criar(u, dto);
  }

  @Patch(':id')
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Cobrança atualizada')
  atualizar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCobrancaDto) {
    return this.svc.atualizar(u, id, dto);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Cobrança aprovada e emitida')
  aprovar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.aprovar(u, id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Permissoes(Permissao.ESCRITA)
  @Mensagem('Cobrança cancelada')
  cancelar(@Usuario() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelarCobrancaDto) {
    return this.svc.cancelar(u, id, dto.motivo);
  }
}
