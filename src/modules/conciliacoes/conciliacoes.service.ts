import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { addDias } from '../../common/datas';
import { sql } from '../../common/dialeto';
import { PaginacaoDto, paginar } from '../../common/dto/paginacao.dto';
import { FormaPagamento, STATUS_PAGAR_EM_ABERTO, STATUS_RECEBER_EM_ABERTO } from '../../common/enums';
import { centavos } from '../../common/money';
import { ContaPagar } from '../contas-pagar/conta-pagar.entity';
import { ContasPagarService } from '../contas-pagar/contas-pagar.service';
import { ContaReceber } from '../contas-receber/conta-receber.entity';
import { ContasReceberService } from '../contas-receber/contas-receber.service';
import { saldoCentavos } from '../contas-receber/saldo';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { Conciliacao, ExtratoTransacao } from './conciliacao.entity';
import { Candidato, escolherAutomatico, pontuar } from './motor-conciliacao';
import { decodificarOfx, OfxInvalidoError, parseOfx } from './ofx.parser';

const JANELA_DIAS = 45;

@Injectable()
export class ConciliacoesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly receber: ContasReceberService,
    private readonly pagar: ContasPagarService,
    private readonly eventos: EventosService,
  ) {}

  /**
   * Importa o extrato OFX e concilia automaticamente. Tudo em uma transação:
   * se algo falhar, nada é gravado (nem metade do extrato).
   */
  async importar(u: AuthUser, nomeArquivo: string, buf: Buffer) {
    let extrato;
    try {
      extrato = parseOfx(decodificarOfx(buf));
    } catch (e) {
      if (e instanceof OfxInvalidoError) throw new UnprocessableEntityException(`OFX inválido: ${e.message}`);
      throw e;
    }
    if (!extrato.transacoes.length) throw new UnprocessableEntityException('Extrato sem transações');

    return this.ds.transaction(async (m) => {
      const conc = await m.getRepository(Conciliacao).save(
        m.getRepository(Conciliacao).create({
          arquivo_nome: nomeArquivo.slice(0, 200),
          banco_id: extrato.banco_id,
          conta_id: extrato.conta_id,
          periodo_inicio: extrato.periodo_inicio,
          periodo_fim: extrato.periodo_fim,
          tenant_id: u.tenant_id,
          created_by: u.sub,
        }),
      );

      // Deduplicação por FITID: reimportar o mesmo extrato não gera lançamentos em dobro.
      const fitids = extrato.transacoes.map((t) => t.fitid);
      const existentes = new Set(
        (await m.getRepository(ExtratoTransacao).find({ select: ['fitid'], where: { tenant_id: u.tenant_id, fitid: In(fitids) }, withDeleted: true })).map((t) => t.fitid),
      );
      const vistos = new Set<string>();
      const novas = extrato.transacoes.filter((t) => {
        if (existentes.has(t.fitid) || vistos.has(t.fitid)) return false;
        vistos.add(t.fitid);
        return true;
      });

      const salvas = await m.getRepository(ExtratoTransacao).save(
        novas.map((t) =>
          m.getRepository(ExtratoTransacao).create({
            conciliacao_id: conc.id,
            fitid: t.fitid,
            data: t.data,
            valor: t.valor,
            tipo: t.tipo,
            descricao: t.descricao,
            tenant_id: u.tenant_id,
            created_by: u.sub,
          }),
        ),
      );

      const usados = new Set<string>();
      let automaticas = 0;
      for (const t of salvas) {
        if (await this.conciliarAutomatico(m, u, t, usados)) automaticas++;
      }

      conc.total_transacoes = extrato.transacoes.length;
      conc.ignoradas_duplicadas = extrato.transacoes.length - novas.length;
      conc.conciliadas_automaticamente = automaticas;
      conc.pendentes = salvas.length - automaticas;
      await m.getRepository(Conciliacao).save(conc);

      await this.eventos.publicar(m, u.tenant_id, TipoEvento.CONCILIACAO_CONCLUIDA, conc.id, {
        conciliacao_id: conc.id,
        arquivo_nome: conc.arquivo_nome,
        total_transacoes: conc.total_transacoes,
        conciliadas_automaticamente: automaticas,
        pendentes: conc.pendentes,
      });
      return {
        ...conc,
        taxa_automatica_percentual: salvas.length ? Math.round((automaticas / salvas.length) * 10000) / 100 : 0,
      };
    });
  }

  private async candidatos(m: EntityManager, u: AuthUser, t: ExtratoTransacao): Promise<(Candidato & { tipo: 'receber' | 'pagar' })[]> {
    const de = addDias(t.data, -JANELA_DIAS);
    const ate = addDias(t.data, JANELA_DIAS);
    if (t.tipo === 'credito') {
      const contas = await m
        .getRepository(ContaReceber)
        .createQueryBuilder('c')
        .where('c.tenant_id = :t AND c.status IN (:...st)', { t: u.tenant_id, st: STATUS_RECEBER_EM_ABERTO })
        .andWhere(`(c.data_vencimento BETWEEN :de AND :ate OR (c.pix_txid IS NOT NULL AND ${sql.textoContemColuna('desc', 'c.pix_txid')}))`, {
          de,
          ate,
          desc: t.descricao ?? '',
        })
        .getMany();
      return contas.map((c) => ({ id: c.id, saldo_cent: saldoCentavos(c), data_vencimento: c.data_vencimento, pix_txid: c.pix_txid, tipo: 'receber' }));
    }
    const contas = await m
      .getRepository(ContaPagar)
      .createQueryBuilder('c')
      .where('c.tenant_id = :t AND c.status IN (:...st)', { t: u.tenant_id, st: STATUS_PAGAR_EM_ABERTO })
      .andWhere('c.data_vencimento BETWEEN :de AND :ate', { de, ate })
      .getMany();
    return contas.map((c) => ({ id: c.id, saldo_cent: saldoCentavos(c), data_vencimento: c.data_vencimento, tipo: 'pagar' }));
  }

  /**
   * Pix já baixado em tempo real pelo webhook aparece depois no extrato: apenas vincula a transação
   * ao título (fecha o ciclo de auditoria) sem registrar o recebimento uma segunda vez.
   */
  private async vincularPixJaBaixado(m: EntityManager, u: AuthUser, t: ExtratoTransacao, usados: Set<string>) {
    if (t.tipo !== 'credito' || !t.descricao) return false;
    const conta = await m
      .getRepository(ContaReceber)
      .createQueryBuilder('c')
      .where('c.tenant_id = :t AND c.status = :paga AND c.pix_txid IS NOT NULL', { t: u.tenant_id, paga: 'paga' })
      .andWhere(sql.textoContemColuna('desc', 'c.pix_txid'), { desc: t.descricao })
      .andWhere(
        `NOT EXISTS (SELECT 1 FROM ${m.getRepository(ExtratoTransacao).metadata.tablePath} e WHERE e.conta_receber_id = c.id AND e.status = 'conciliada' AND e.deleted_at IS NULL)`,
      )
      .getOne();
    if (!conta || usados.has(conta.id) || centavos(conta.valor_pago) !== Math.abs(centavos(t.valor))) return false;
    usados.add(conta.id);
    Object.assign(t, {
      status: 'conciliada',
      conta_receber_id: conta.id,
      score: 100,
      criterio: 'txid_pix_ja_baixado',
      conciliada_em: this.clock.agora(),
    });
    await m.getRepository(ExtratoTransacao).save(t);
    return true;
  }

  private async conciliarAutomatico(m: EntityManager, u: AuthUser, t: ExtratoTransacao, usados: Set<string>) {
    if (await this.vincularPixJaBaixado(m, u, t, usados)) return true;
    const cands = (await this.candidatos(m, u, t)).filter((c) => !usados.has(c.id));
    const vencedor = escolherAutomatico(pontuar({ valor_cent: Math.abs(centavos(t.valor)), data: t.data, descricao: t.descricao ?? '' }, cands));
    if (!vencedor) return false;
    usados.add(vencedor.id);
    await this.baixar(m, u, t, cands.find((c) => c.id === vencedor.id)!.tipo, vencedor.id, vencedor.score, vencedor.criterio, 'conciliacao_ofx', null);
    return true;
  }

  private async baixar(
    m: EntityManager,
    u: AuthUser,
    t: ExtratoTransacao,
    tipo: 'receber' | 'pagar',
    contaId: string,
    score: number | null,
    criterio: string,
    origem: 'conciliacao_ofx',
    autor: string | null,
  ) {
    const valorCent = Math.abs(centavos(t.valor));
    if (tipo === 'receber') {
      const c = await m.getRepository(ContaReceber).findOne({ where: { id: contaId, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Conta a receber não encontrada');
      await this.receber.registrarRecebimento(m, c, valorCent, t.data, c.forma_pagamento ?? FormaPagamento.TRANSFERENCIA, origem, autor);
      t.conta_receber_id = c.id;
    } else {
      const c = await m.getRepository(ContaPagar).findOne({ where: { id: contaId, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!c) throw new NotFoundException('Conta a pagar não encontrada');
      await this.pagar.registrarPagamento(m, c, valorCent, t.data, c.forma_pagamento ?? FormaPagamento.TRANSFERENCIA, origem, autor);
      t.conta_pagar_id = c.id;
    }
    t.status = 'conciliada';
    t.score = score;
    t.criterio = criterio;
    t.conciliada_em = this.clock.agora();
    t.updated_by = autor;
    await m.getRepository(ExtratoTransacao).save(t);
  }

  async listar(u: AuthUser, p: PaginacaoDto) {
    const [items, total] = await this.ds
      .getRepository(Conciliacao)
      .findAndCount({ where: { tenant_id: u.tenant_id }, order: { created_at: 'DESC' }, skip: (p.page - 1) * p.limit, take: p.limit });
    return paginar(items, total, p);
  }

  async obter(u: AuthUser, id: string, status?: string) {
    const conc = await this.ds.getRepository(Conciliacao).findOne({ where: { id, tenant_id: u.tenant_id } });
    if (!conc) throw new NotFoundException('Conciliação não encontrada');
    const transacoes = await this.ds.getRepository(ExtratoTransacao).find({
      where: { conciliacao_id: id, tenant_id: u.tenant_id, ...(status ? { status: status as any } : {}) },
      order: { data: 'ASC' },
    });
    return { ...conc, transacoes };
  }

  private async transacao(m: EntityManager, u: AuthUser, concId: string, tId: string) {
    const t = await m.getRepository(ExtratoTransacao).findOne({ where: { id: tId, conciliacao_id: concId, tenant_id: u.tenant_id } });
    if (!t) throw new NotFoundException('Transação não encontrada nesta conciliação');
    return t;
  }

  async sugestoes(u: AuthUser, concId: string, tId: string) {
    const m = this.ds.manager;
    const t = await this.transacao(m, u, concId, tId);
    const cands = await this.candidatos(m, u, t);
    const pts = pontuar({ valor_cent: Math.abs(centavos(t.valor)), data: t.data, descricao: t.descricao ?? '' }, cands);
    return pts.slice(0, 10).map((p) => ({ ...p, tipo: cands.find((c) => c.id === p.id)!.tipo }));
  }

  conciliarManual(u: AuthUser, concId: string, tId: string, dto: { conta_receber_id?: string; conta_pagar_id?: string }) {
    if (!!dto.conta_receber_id === !!dto.conta_pagar_id) throw new BadRequestException('Informe exatamente um entre conta_receber_id e conta_pagar_id');
    return this.ds.transaction(async (m) => {
      const t = await this.transacao(m, u, concId, tId);
      if (t.status !== 'pendente') throw new ConflictException(`Transação já está "${t.status}"`);
      if (dto.conta_receber_id && t.tipo !== 'credito') throw new UnprocessableEntityException('Débito do extrato só concilia com conta a pagar');
      if (dto.conta_pagar_id && t.tipo !== 'debito') throw new UnprocessableEntityException('Crédito do extrato só concilia com conta a receber');
      const tipo = dto.conta_receber_id ? 'receber' : 'pagar';
      await this.baixar(m, u, t, tipo, (dto.conta_receber_id ?? dto.conta_pagar_id)!, null, 'manual', 'conciliacao_ofx', u.sub);
      await m.getRepository(Conciliacao).decrement({ id: concId }, 'pendentes', 1);
      return t;
    });
  }

  ignorar(u: AuthUser, concId: string, tId: string) {
    return this.ds.transaction(async (m) => {
      const t = await this.transacao(m, u, concId, tId);
      if (t.status !== 'pendente') throw new ConflictException(`Transação já está "${t.status}"`);
      t.status = 'ignorada';
      t.updated_by = u.sub;
      await m.getRepository(ExtratoTransacao).save(t);
      await m.getRepository(Conciliacao).decrement({ id: concId }, 'pendentes', 1);
      return t;
    });
  }
}
