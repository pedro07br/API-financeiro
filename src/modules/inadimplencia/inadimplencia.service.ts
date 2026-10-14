import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { addDias, diffDias } from '../../common/datas';
import { paginar } from '../../common/dto/paginacao.dto';
import { StatusContaPagar, StatusContaReceber, STATUS_RECEBER_EM_ABERTO } from '../../common/enums';
import { centavos, reais } from '../../common/money';
import { ContaPagar } from '../contas-pagar/conta-pagar.entity';
import { ContaReceber } from '../contas-receber/conta-receber.entity';
import { saldoCentavos } from '../contas-receber/saldo';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { SISTEMA_ID } from '../recorrencias/recorrencias.service';
import { calcularEncargos, FAIXAS_AGING, faixaDe } from './encargos';
import { CriarPromessaDto, FiltroInadimplenciaDto, FiltroPromessasDto } from './inadimplencia.dto';
import { PromessaPagamento } from './promessa-pagamento.entity';

@Injectable()
export class InadimplenciaService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly eventos: EventosService,
  ) {}

  private detalharAtraso(c: ContaReceber, hoje: string) {
    const saldo = saldoCentavos(c);
    const dias = Math.max(0, diffDias(c.data_vencimento, hoje));
    return {
      conta_receber_id: c.id,
      cliente_id: c.cliente_id,
      contrato_id: c.contrato_id,
      cobranca_id: c.cobranca_id,
      descricao: c.descricao,
      competencia: c.competencia,
      data_vencimento: c.data_vencimento,
      status: c.status,
      saldo: reais(saldo),
      dias_atraso: dias,
      faixa_aging: faixaDe(dias),
      ...calcularEncargos(saldo, dias),
    };
  }

  /** Lançamentos vencidos com dias de atraso e valor atualizado (multa + juros). */
  async listar(u: AuthUser, f: FiltroInadimplenciaDto) {
    const hoje = this.clock.hoje();
    const qb = this.ds
      .getRepository(ContaReceber)
      .createQueryBuilder('c')
      .where('c.tenant_id = :t', { t: u.tenant_id })
      .andWhere('c.status IN (:...st)', { st: STATUS_RECEBER_EM_ABERTO })
      .andWhere('c.data_vencimento < :hoje', { hoje });
    if (f.cliente_id) qb.andWhere('c.cliente_id = :cl', { cl: f.cliente_id });
    if (f.dias_min) qb.andWhere('c.data_vencimento <= :limiteAtraso', { limiteAtraso: addDias(hoje, -f.dias_min) });
    const [items, total] = await qb.orderBy('c.data_vencimento', 'ASC').skip((f.page - 1) * f.limit).take(f.limit).getManyAndCount();
    return paginar(items.map((c) => this.detalharAtraso(c, hoje)), total, f);
  }

  /** Visão consolidada da carteira: aging, totais e taxa de inadimplência. */
  async resumo(u: AuthUser) {
    const hoje = this.clock.hoje();
    const contas = await this.ds
      .getRepository(ContaReceber)
      .createQueryBuilder('c')
      .where('c.tenant_id = :t AND c.status IN (:...st)', { t: u.tenant_id, st: STATUS_RECEBER_EM_ABERTO })
      .getMany();

    const aging = Object.fromEntries(FAIXAS_AGING.map((f) => [f.faixa, { quantidade: 0, valor: 0 }])) as Record<string, { quantidade: number; valor: number }>;
    const clientesInad = new Set<string>();
    let totalAberto = 0;
    let totalVencido = 0;
    let totalAtualizado = 0;
    for (const c of contas) {
      const d = this.detalharAtraso(c, hoje);
      const saldo = centavos(d.saldo);
      totalAberto += saldo;
      aging[d.faixa_aging].quantidade++;
      aging[d.faixa_aging].valor = reais(centavos(aging[d.faixa_aging].valor) + saldo);
      if (d.dias_atraso > 0) {
        totalVencido += saldo;
        totalAtualizado += centavos(d.valor_atualizado);
        clientesInad.add(c.cliente_id);
      }
    }
    return {
      data_referencia: hoje,
      total_em_aberto: reais(totalAberto),
      total_vencido: reais(totalVencido),
      total_vencido_atualizado: reais(totalAtualizado),
      taxa_inadimplencia_percentual: totalAberto ? Math.round((totalVencido / totalAberto) * 10000) / 100 : 0,
      clientes_inadimplentes: clientesInad.size,
      aging,
    };
  }

  async criarPromessa(u: AuthUser, dto: CriarPromessaDto) {
    const conta = await this.ds.getRepository(ContaReceber).findOne({ where: { id: dto.conta_receber_id, tenant_id: u.tenant_id } });
    if (!conta) throw new NotFoundException('Conta a receber não encontrada');
    if (!STATUS_RECEBER_EM_ABERTO.includes(conta.status)) throw new ConflictException(`Conta com status "${conta.status}" não aceita promessa`);
    if (dto.data_prometida < this.clock.hoje()) throw new UnprocessableEntityException('data_prometida não pode estar no passado');
    if (centavos(dto.valor) > saldoCentavos(conta)) throw new UnprocessableEntityException('Valor prometido maior que o saldo');
    const repo = this.ds.getRepository(PromessaPagamento);
    return repo.save(repo.create({ ...dto, tenant_id: u.tenant_id, created_by: u.sub, updated_by: u.sub, status: 'pendente' }));
  }

  async listarPromessas(u: AuthUser, f: FiltroPromessasDto) {
    const where: any = { tenant_id: u.tenant_id };
    if (f.status) where.status = f.status;
    if (f.conta_receber_id) where.conta_receber_id = f.conta_receber_id;
    const [items, total] = await this.ds
      .getRepository(PromessaPagamento)
      .findAndCount({ where, order: { data_prometida: 'ASC' }, skip: (f.page - 1) * f.limit, take: f.limit });
    return paginar(items, total, f);
  }

  // ------------------------------------------------------------------ automações (agendador)

  /**
   * Marca como vencidas as contas cujo vencimento passou e publica o evento para os demais módulos.
   * Seleciona com bloqueio e atualiza por id (funciona igual no PostgreSQL e no MySQL, que não tem RETURNING).
   */
  async marcarVencidas(tenantId?: string) {
    const hoje = this.clock.hoje();
    return this.ds.transaction(async (m) => {
      const qb = m
        .getRepository(ContaReceber)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.status IN (:...st) AND c.data_vencimento < :hoje', {
          st: [StatusContaReceber.EM_ABERTO, StatusContaReceber.AGENDADA],
          hoje,
        });
      if (tenantId) qb.andWhere('c.tenant_id = :t', { t: tenantId });
      const vencidas = await qb.getMany();
      if (vencidas.length) {
        await m.getRepository(ContaReceber).update(
          { id: In(vencidas.map((c) => c.id)) },
          { status: StatusContaReceber.VENCIDA, updated_by: SISTEMA_ID },
        );
      }
      for (const c of vencidas) {
        await this.eventos.publicar(m, c.tenant_id, TipoEvento.CONTA_RECEBER_VENCIDA, c.id, {
          conta_receber_id: c.id,
          cliente_id: c.cliente_id,
          contrato_id: c.contrato_id,
          cobranca_id: c.cobranca_id,
          data_vencimento: c.data_vencimento,
          valor: c.valor,
        });
      }

      const qp = m
        .getRepository(ContaPagar)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .select('c.id')
        .where('c.status IN (:...st) AND c.data_vencimento < :hoje', {
          st: [StatusContaPagar.EM_ABERTO, StatusContaPagar.AGENDADA],
          hoje,
        });
      if (tenantId) qp.andWhere('c.tenant_id = :t', { t: tenantId });
      const pagar = await qp.getMany();
      if (pagar.length) {
        await m.getRepository(ContaPagar).update(
          { id: In(pagar.map((c) => c.id)) },
          { status: StatusContaPagar.VENCIDA, updated_by: SISTEMA_ID },
        );
      }
      return { contas_receber_vencidas: vencidas.length, contas_pagar_vencidas: pagar.length };
    });
  }

  /** Promessas cuja data passou sem pagamento são marcadas como quebradas. */
  async verificarPromessas(tenantId?: string) {
    const hoje = this.clock.hoje();
    return this.ds.transaction(async (m) => {
      const qb = m
        .getRepository(PromessaPagamento)
        .createQueryBuilder('p')
        .setLock('pessimistic_write')
        .where(`p.status = 'pendente' AND p.data_prometida < :hoje`, { hoje });
      if (tenantId) qb.andWhere('p.tenant_id = :t', { t: tenantId });
      const quebradas = await qb.getMany();
      if (quebradas.length) {
        await m.getRepository(PromessaPagamento).update(
          { id: In(quebradas.map((p) => p.id)) },
          { status: 'quebrada', updated_by: SISTEMA_ID },
        );
      }
      for (const p of quebradas) {
        await this.eventos.publicar(m, p.tenant_id, TipoEvento.PROMESSA_QUEBRADA, p.id, {
          promessa_id: p.id,
          conta_receber_id: p.conta_receber_id,
          data_prometida: p.data_prometida,
          valor: p.valor,
        });
      }
      return { promessas_quebradas: quebradas.length };
    });
  }
}
