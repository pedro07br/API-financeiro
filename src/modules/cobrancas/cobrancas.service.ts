import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { paginar } from '../../common/dto/paginacao.dto';
import { FormaPagamento, StatusCobranca, StatusContaReceber } from '../../common/enums';
import { centavos, reais } from '../../common/money';
import { config } from '../../config';
import { ContaReceber } from '../contas-receber/conta-receber.entity';
import { ContasReceberService } from '../contas-receber/contas-receber.service';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { gerarBrCode, gerarTxid } from '../pix/brcode';
import { Cobranca, ItemCobranca } from './cobranca.entity';
import { AtualizarCobrancaDto, CriarCobrancaDto, FiltroCobrancasDto } from './cobrancas.dto';

export const totalItens = (itens: ItemCobranca[]) =>
  reais(itens.reduce((s, i) => s + Math.round(centavos(i.valor_unitario) * i.quantidade), 0));

@Injectable()
export class CobrancasService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly eventos: EventosService,
    private readonly contasReceber: ContasReceberService,
  ) {}

  private repo(m?: EntityManager) {
    return (m ?? this.ds.manager).getRepository(Cobranca);
  }

  async listar(u: AuthUser, f: FiltroCobrancasDto) {
    const qb = this.repo().createQueryBuilder('c').where('c.tenant_id = :t', { t: u.tenant_id });
    for (const campo of ['status', 'cliente_id', 'contrato_id', 'recorrencia_id', 'competencia'] as const) {
      if (f[campo]) qb.andWhere(`c.${campo} = :${campo}`, { [campo]: f[campo] });
    }
    const [items, total] = await qb.orderBy('c.created_at', 'DESC').skip((f.page - 1) * f.limit).take(f.limit).getManyAndCount();
    return paginar(items, total, f);
  }

  async obter(u: AuthUser, id: string, m?: EntityManager) {
    const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id } });
    if (!c) throw new NotFoundException('Cobrança não encontrada');
    return c;
  }

  async criar(u: AuthUser, dto: CriarCobrancaDto, m?: EntityManager, extra: Partial<Cobranca> = {}) {
    const c = this.repo(m).create({
      ...dto,
      ...extra,
      valor_total: totalItens(dto.itens),
      status: StatusCobranca.RASCUNHO,
      tenant_id: u.tenant_id,
      created_by: u.sub,
      updated_by: u.sub,
    });
    return this.repo(m).save(c);
  }

  async atualizar(u: AuthUser, id: string, dto: AtualizarCobrancaDto) {
    const c = await this.obter(u, id);
    if (c.status !== StatusCobranca.RASCUNHO) throw new ConflictException('Apenas cobranças em rascunho podem ser alteradas');
    Object.assign(c, dto, { updated_by: u.sub });
    if (dto.itens) c.valor_total = totalItens(dto.itens);
    return this.repo().save(c);
  }

  aprovar(u: AuthUser, id: string) {
    return this.ds.transaction(async (m) => {
      const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Cobrança não encontrada');
      return this.aprovarInterno(m, u, c);
    });
  }

  /**
   * Aprovação = emissão: gera a conta a receber vinculada e, se Pix, o txid e o BR Code "copia e cola".
   * Usado tanto pela rota manual quanto pela recorrência com aprovação automática.
   */
  async aprovarInterno(m: EntityManager, u: AuthUser, c: Cobranca) {
    if (c.status !== StatusCobranca.RASCUNHO) throw new ConflictException(`Cobrança com status "${c.status}" não pode ser aprovada`);
    c.status = StatusCobranca.APROVADA;
    c.aprovada_em = this.clock.agora();
    c.aprovada_por = u.sub;
    c.updated_by = u.sub;
    if (c.forma_pagamento === FormaPagamento.PIX) {
      c.pix_txid = gerarTxid();
      c.pix_copia_cola = gerarBrCode({
        chave: config.pix.chaveRecebedor,
        valor: c.valor_total,
        txid: c.pix_txid,
        nome: config.pix.nomeRecebedor,
        cidade: config.pix.cidadeRecebedor,
      });
    }
    await this.repo(m).save(c);

    const conta = await this.contasReceber.criar(
      u,
      {
        cliente_id: c.cliente_id,
        contrato_id: c.contrato_id ?? undefined,
        descricao: c.descricao,
        competencia: c.competencia,
        data_vencimento: c.data_vencimento,
        valor: c.valor_total,
        forma_pagamento: c.forma_pagamento,
      },
      m,
      { cobranca_id: c.id, pix_txid: c.pix_txid },
    );

    await this.eventos.publicar(m, c.tenant_id, TipoEvento.COBRANCA_APROVADA, c.id, {
      cobranca_id: c.id,
      conta_receber_id: conta.id,
      cliente_id: c.cliente_id,
      contrato_id: c.contrato_id,
      competencia: c.competencia,
      valor_total: c.valor_total,
      data_vencimento: c.data_vencimento,
      forma_pagamento: c.forma_pagamento,
      pix_copia_cola: c.pix_copia_cola,
    });
    return { ...c, conta_receber_id: conta.id };
  }

  /** QR Code do Pix "copia e cola" da cobrança (PNG ou SVG). */
  async qrCode(u: AuthUser, id: string, formato: 'png' | 'svg', tamanho: number) {
    const c = await this.obter(u, id);
    if (c.forma_pagamento !== FormaPagamento.PIX) throw new UnprocessableEntityException('A forma de pagamento desta cobrança não é Pix');
    if (!c.pix_copia_cola) throw new ConflictException('O QR Code é gerado quando a cobrança é aprovada');
    if (c.status !== StatusCobranca.APROVADA) throw new ConflictException(`Cobrança com status "${c.status}" não está aguardando pagamento`);
    const opcoes = { errorCorrectionLevel: 'M' as const, margin: 2, width: tamanho };
    return formato === 'svg'
      ? { tipo: 'image/svg+xml', corpo: Buffer.from(await QRCode.toString(c.pix_copia_cola, { ...opcoes, type: 'svg' })) }
      : { tipo: 'image/png', corpo: await QRCode.toBuffer(c.pix_copia_cola, { ...opcoes, type: 'png' }) };
  }

  cancelar(u: AuthUser, id: string, motivo: string) {
    return this.ds.transaction(async (m) => {
      const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Cobrança não encontrada');
      if (![StatusCobranca.RASCUNHO, StatusCobranca.APROVADA].includes(c.status)) {
        throw new ConflictException(`Cobrança com status "${c.status}" não pode ser cancelada`);
      }
      const contas = m.getRepository(ContaReceber);
      const conta = await contas.findOne({ where: { cobranca_id: c.id, tenant_id: u.tenant_id } });
      if (conta && conta.valor_pago > 0) throw new ConflictException('Cobrança com pagamento parcial registrado: estorne antes de cancelar');
      if (conta) await contas.update(conta.id, { status: StatusContaReceber.CANCELADA, updated_by: u.sub });

      c.status = StatusCobranca.CANCELADA;
      c.cancelada_em = this.clock.agora();
      c.motivo_cancelamento = motivo;
      c.updated_by = u.sub;
      await this.repo(m).save(c);
      await this.eventos.publicar(m, c.tenant_id, TipoEvento.COBRANCA_CANCELADA, c.id, {
        cobranca_id: c.id,
        cliente_id: c.cliente_id,
        contrato_id: c.contrato_id,
        motivo,
      });
      return c;
    });
  }
}
