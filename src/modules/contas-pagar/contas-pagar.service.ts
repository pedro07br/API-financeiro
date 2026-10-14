import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { paginar } from '../../common/dto/paginacao.dto';
import { FormaPagamento, StatusContaPagar, STATUS_PAGAR_EM_ABERTO } from '../../common/enums';
import { centavos, reais } from '../../common/money';
import { saldoCentavos } from '../contas-receber/saldo';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { ContaPagar } from './conta-pagar.entity';
import { AtualizarContaPagarDto, CriarContaPagarDto, FiltroContasPagarDto, PagamentoDto } from './contas-pagar.dto';

@Injectable()
export class ContasPagarService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly eventos: EventosService,
  ) {}

  private repo(m?: EntityManager) {
    return (m ?? this.ds.manager).getRepository(ContaPagar);
  }

  async listar(u: AuthUser, f: FiltroContasPagarDto) {
    const qb = this.repo().createQueryBuilder('c').where('c.tenant_id = :t', { t: u.tenant_id });
    for (const campo of ['status', 'fornecedor_id', 'centro_custo_id', 'categoria_id', 'competencia'] as const) {
      if (f[campo]) qb.andWhere(`c.${campo} = :${campo}`, { [campo]: f[campo] });
    }
    if (f.vencimento_de) qb.andWhere('c.data_vencimento >= :vd', { vd: f.vencimento_de });
    if (f.vencimento_ate) qb.andWhere('c.data_vencimento <= :va', { va: f.vencimento_ate });
    const [items, total] = await qb
      .orderBy('c.data_vencimento', 'ASC')
      .skip((f.page - 1) * f.limit)
      .take(f.limit)
      .getManyAndCount();
    return paginar(items.map((c) => this.comSaldo(c)), total, f);
  }

  async obter(u: AuthUser, id: string, m?: EntityManager) {
    const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id } });
    if (!c) throw new NotFoundException('Conta a pagar não encontrada');
    return c;
  }

  async detalhar(u: AuthUser, id: string) {
    return this.comSaldo(await this.obter(u, id));
  }

  async criar(u: AuthUser, dto: CriarContaPagarDto) {
    if (centavos(dto.desconto) >= centavos(dto.valor)) throw new UnprocessableEntityException('Desconto deve ser menor que o valor');
    const c = this.repo().create({
      ...dto,
      desconto: dto.desconto ?? 0,
      status: dto.data_vencimento < this.clock.hoje() ? StatusContaPagar.VENCIDA : StatusContaPagar.EM_ABERTO,
      tenant_id: u.tenant_id,
      created_by: u.sub,
      updated_by: u.sub,
    });
    return this.comSaldo(await this.repo().save(c));
  }

  async atualizar(u: AuthUser, id: string, dto: AtualizarContaPagarDto) {
    const c = await this.obter(u, id);
    if ([StatusContaPagar.PAGA, StatusContaPagar.CANCELADA].includes(c.status) || c.valor_pago > 0) {
      throw new ConflictException(`Conta com status "${c.status}" ou com pagamento registrado não pode ser alterada`);
    }
    Object.assign(c, dto, { updated_by: u.sub });
    if (centavos(c.desconto) >= centavos(c.valor)) throw new UnprocessableEntityException('Desconto deve ser menor que o valor');
    if (!dto.status && c.status !== StatusContaPagar.AGENDADA) {
      c.status = c.data_vencimento < this.clock.hoje() ? StatusContaPagar.VENCIDA : StatusContaPagar.EM_ABERTO;
    }
    return this.comSaldo(await this.repo().save(c));
  }

  async remover(u: AuthUser, id: string) {
    const c = await this.obter(u, id);
    if (c.valor_pago > 0) throw new ConflictException('Conta com pagamento registrado não pode ser excluída');
    await this.repo().update(c.id, { deleted_by: u.sub });
    await this.repo().softDelete(c.id);
  }

  pagar(u: AuthUser, id: string, dto: PagamentoDto) {
    return this.ds.transaction(async (m) => {
      const c = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Conta a pagar não encontrada');
      return this.comSaldo(await this.registrarPagamento(m, c, centavos(dto.valor), dto.data_pagamento, dto.forma_pagamento, 'manual', u.sub));
    });
  }

  async registrarPagamento(m: EntityManager, c: ContaPagar, valorCent: number, data: string, forma: FormaPagamento, origem: string, autor: string | null) {
    if (!STATUS_PAGAR_EM_ABERTO.includes(c.status)) throw new ConflictException(`Conta com status "${c.status}" não aceita pagamento`);
    const saldo = saldoCentavos(c);
    if (valorCent > saldo) throw new UnprocessableEntityException(`Valor (${reais(valorCent)}) maior que o saldo (${reais(saldo)})`);
    c.valor_pago = reais(centavos(c.valor_pago) + valorCent);
    c.data_pagamento = data;
    c.forma_pagamento = forma;
    c.status = valorCent === saldo ? StatusContaPagar.PAGA : StatusContaPagar.PARCIALMENTE_PAGA;
    c.updated_by = autor;
    await m.getRepository(ContaPagar).save(c);
    if (c.status === StatusContaPagar.PAGA) {
      await this.eventos.publicar(m, c.tenant_id, TipoEvento.CONTA_PAGAR_PAGA, c.id, {
        conta_pagar_id: c.id,
        fornecedor_id: c.fornecedor_id,
        centro_custo_id: c.centro_custo_id,
        valor_pago: c.valor_pago,
        data_pagamento: data,
        origem,
      });
    }
    return c;
  }

  comSaldo(c: ContaPagar) {
    return { ...c, saldo: reais(saldoCentavos(c)) };
  }
}
