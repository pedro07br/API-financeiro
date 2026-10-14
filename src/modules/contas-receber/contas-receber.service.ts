import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { paginar } from '../../common/dto/paginacao.dto';
import { FormaPagamento, StatusCobranca, StatusContaReceber, STATUS_RECEBER_EM_ABERTO } from '../../common/enums';
import { centavos, reais } from '../../common/money';
import { Cobranca } from '../cobrancas/cobranca.entity';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { PromessaPagamento } from '../inadimplencia/promessa-pagamento.entity';
import { ContaReceber } from './conta-receber.entity';
import { AtualizarContaReceberDto, BaixaDto, CriarContaReceberDto, FiltroContasReceberDto } from './contas-receber.dto';
import { saldoCentavos } from './saldo';

const FINAIS = [StatusContaReceber.PAGA, StatusContaReceber.CANCELADA, StatusContaReceber.ESTORNADA];

export type OrigemBaixa = 'manual' | 'pix_webhook' | 'conciliacao_ofx';

@Injectable()
export class ContasReceberService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly eventos: EventosService,
  ) {}

  private repo(m?: EntityManager) {
    return (m ?? this.ds.manager).getRepository(ContaReceber);
  }

  async listar(u: AuthUser, f: FiltroContasReceberDto) {
    const qb = this.repo().createQueryBuilder('c').where('c.tenant_id = :t', { t: u.tenant_id });
    if (f.status) qb.andWhere('c.status = :s', { s: f.status });
    if (f.cliente_id) qb.andWhere('c.cliente_id = :cl', { cl: f.cliente_id });
    if (f.contrato_id) qb.andWhere('c.contrato_id = :ct', { ct: f.contrato_id });
    if (f.competencia) qb.andWhere('c.competencia = :cp', { cp: f.competencia });
    if (f.vencimento_de) qb.andWhere('c.data_vencimento >= :vd', { vd: f.vencimento_de });
    if (f.vencimento_ate) qb.andWhere('c.data_vencimento <= :va', { va: f.vencimento_ate });
    const [items, total] = await qb
      .orderBy('c.data_vencimento', 'ASC')
      .addOrderBy('c.created_at', 'ASC')
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginar(items.map((c) => this.comSaldo(c)), total, f);
  }

  async obter(u: AuthUser, id: string, m?: EntityManager) {
    const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id } });
    if (!c) throw new NotFoundException('Conta a receber não encontrada');
    return c;
  }

  async detalhar(u: AuthUser, id: string) {
    return this.comSaldo(await this.obter(u, id));
  }

  async criar(u: AuthUser, dto: CriarContaReceberDto, m?: EntityManager, extra: Partial<ContaReceber> = {}) {
    if (centavos(dto.desconto) >= centavos(dto.valor)) throw new UnprocessableEntityException('Desconto deve ser menor que o valor');
    const status = dto.data_vencimento < this.clock.hoje() ? StatusContaReceber.VENCIDA : StatusContaReceber.EM_ABERTO;
    const conta = this.repo(m).create({
      ...dto,
      ...extra,
      desconto: dto.desconto ?? 0,
      status,
      tenant_id: u.tenant_id,
      created_by: u.sub,
      updated_by: u.sub,
    });
    return this.comSaldo(await this.repo(m).save(conta));
  }

  async atualizar(u: AuthUser, id: string, dto: AtualizarContaReceberDto) {
    const c = await this.obter(u, id);
    if (FINAIS.includes(c.status) || c.valor_pago > 0) {
      throw new ConflictException(`Conta com status "${c.status}" ou com pagamento registrado não pode ser alterada`);
    }
    Object.assign(c, dto, { updated_by: u.sub });
    if (centavos(c.desconto) >= centavos(c.valor)) throw new UnprocessableEntityException('Desconto deve ser menor que o valor');
    if (!dto.status && c.status !== StatusContaReceber.AGENDADA) {
      c.status = c.data_vencimento < this.clock.hoje() ? StatusContaReceber.VENCIDA : StatusContaReceber.EM_ABERTO;
    }
    return this.comSaldo(await this.repo().save(c));
  }

  async remover(u: AuthUser, id: string) {
    const c = await this.obter(u, id);
    if (c.valor_pago > 0) throw new ConflictException('Conta com pagamento registrado não pode ser excluída; use estorno');
    await this.repo().update(c.id, { deleted_by: u.sub });
    await this.repo().softDelete(c.id);
  }

  baixaManual(u: AuthUser, id: string, dto: BaixaDto) {
    return this.ds.transaction(async (m) => {
      const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Conta a receber não encontrada');
      return this.comSaldo(await this.registrarRecebimento(m, c, centavos(dto.valor), dto.data_pagamento, dto.forma_pagamento, 'manual', u.sub));
    });
  }

  estornar(u: AuthUser, id: string) {
    return this.ds.transaction(async (m) => {
      const c = await this.obter(u, id, m);
      if (c.valor_pago <= 0) throw new ConflictException('Só é possível estornar contas com pagamento registrado');
      c.status = StatusContaReceber.ESTORNADA;
      c.updated_by = u.sub;
      return this.comSaldo(await this.repo(m).save(c));
    });
  }

  /**
   * Ponto único de "baixa" de recebimento, usado pela baixa manual, pelo webhook Pix e pela conciliação OFX.
   * Atualiza o status pelo saldo, propaga para a cobrança, cumpre promessas e publica eventos.
   */
  async registrarRecebimento(
    m: EntityManager,
    c: ContaReceber,
    valorCent: number,
    data: string,
    forma: FormaPagamento,
    origem: OrigemBaixa,
    autor: string | null,
  ): Promise<ContaReceber> {
    if (!STATUS_RECEBER_EM_ABERTO.includes(c.status)) {
      throw new ConflictException(`Conta com status "${c.status}" não aceita recebimento`);
    }
    const saldo = saldoCentavos(c);
    if (valorCent > saldo) {
      throw new UnprocessableEntityException(`Valor (${reais(valorCent)}) maior que o saldo devedor (${reais(saldo)})`);
    }
    c.valor_pago = reais(centavos(c.valor_pago) + valorCent);
    c.data_pagamento = data;
    c.forma_pagamento = forma;
    c.status = valorCent === saldo ? StatusContaReceber.PAGA : StatusContaReceber.PARCIALMENTE_PAGA;
    c.updated_by = autor;
    await m.getRepository(ContaReceber).save(c);

    if (c.status === StatusContaReceber.PAGA) {
      await this.eventos.publicar(m, c.tenant_id, TipoEvento.CONTA_RECEBER_PAGA, c.id, {
        conta_receber_id: c.id,
        cliente_id: c.cliente_id,
        contrato_id: c.contrato_id,
        cobranca_id: c.cobranca_id,
        valor_pago: c.valor_pago,
        data_pagamento: data,
        origem,
      });
      await m.getRepository(PromessaPagamento).update(
        { conta_receber_id: c.id, status: 'pendente' },
        { status: 'cumprida', updated_by: autor },
      );
      if (c.cobranca_id) {
        const cob = await m.getRepository(Cobranca).findOne({ where: { id: c.cobranca_id } });
        if (cob && cob.status === StatusCobranca.APROVADA) {
          cob.status = StatusCobranca.PAGA;
          cob.updated_by = autor;
          await m.getRepository(Cobranca).save(cob);
          await this.eventos.publicar(m, c.tenant_id, TipoEvento.COBRANCA_PAGA, cob.id, {
            cobranca_id: cob.id,
            cliente_id: cob.cliente_id,
            contrato_id: cob.contrato_id,
            competencia: cob.competencia,
            valor: c.valor_pago,
            origem,
          });
        }
      }
    }
    return c;
  }

  comSaldo(c: ContaReceber) {
    return { ...c, saldo: reais(saldoCentavos(c)) };
  }
}
