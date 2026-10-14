import { Body, Controller, Headers, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'crypto';
import { Publico } from '../../common/auth/decorators';
import { Mensagem } from '../../common/http/resposta';
import { config } from '../../config';
import { PixService } from './pix.service';

/**
 * Endpoint chamado pelo PSP (banco) quando um Pix é liquidado — notificação máquina-a-máquina.
 * Não usa JWT (o chamador é o banco); a autenticidade é garantida por assinatura HMAC-SHA256
 * sobre o corpo bruto. Em produção, soma-se mTLS conforme o padrão de webhooks da API Pix do BCB.
 */
@ApiTags('Webhook Pix (PSP → Financeiro)')
@Controller('webhooks/pix')
export class PixWebhookController {
  constructor(private readonly svc: PixService) {}

  @Post()
  @Publico()
  @HttpCode(200)
  @Mensagem('Notificação Pix processada')
  @ApiHeader({ name: 'x-pix-assinatura', description: 'sha256=<hex HMAC-SHA256 do corpo com o segredo compartilhado>' })
  receber(@Req() req: any, @Headers('x-pix-assinatura') assinatura: string, @Body() body: any) {
    const bruto: Buffer = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const esperado = Buffer.from(`sha256=${createHmac('sha256', config.pix.webhookSecret).update(bruto).digest('hex')}`);
    const recebido = Buffer.from(assinatura ?? '');
    if (recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado)) {
      throw new UnauthorizedException('Assinatura do webhook inválida');
    }
    return this.svc.processarNotificacao(body);
  }
}
