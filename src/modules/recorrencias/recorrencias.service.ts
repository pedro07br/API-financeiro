import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser, Permissao } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { addDias, addMeses, comDia, competenciaDe } from '../../common/datas';
import { sql } from '../../common/dialeto';
import { paginar } from '../../common/dto/paginacao.dto';
import { MESES_POR_PERIODICIDADE } from '../../common/enums';
import { CobrancasService, totalItens } from '../cobrancas/cobrancas.service';
import { EventosService } from '../eventos/eventos.service';
import { TipoEvento } from '../eventos/tipos';
import { Recorrencia, RecorrenciaExecucao } from './recorrencia.entity';
import { AtualizarRecorrenciaDto, CriarRecorrenciaDto, FiltroRecorrenciasDto } from './recorrencias.dto';

/** Identidade usada pelos processos automáticos (agendador) na auditoria. */
export const SISTEMA_ID = '00000000-0000-0000-0000-000000000000';
const MAX_CICLOS_POR_EXECUCAO = 24;

export interface Ciclo {
  competencia: string;
  data_vencimento: string;
  data_geracao: string;
}

/** Calcula o ciclo de uma competência: vencimento no dia configurado e geração N dias antes. */
export function cicloDe(r: Pick<Recorrencia, 'dia_vencimento' | 'dias_antecedencia'>, competencia: string): Ciclo {
  const venc = comDia(competencia, r.dia_vencimento);
  return { competencia, data_vencimento: venc, data_geracao: addDias(venc, -r.dias_antecedencia) };
}

export function proximaCompetencia(r: Pick<Recorrencia, 'periodicidade'>, competencia: string) {
  return competenciaDe(addMeses(`${competencia}-01`, MESES_POR_PERIODICIDADE[r.periodicidade]));
}

export interface ResultadoProcessamento {
  recorrencias_avaliadas: number;
  cobrancas_geradas: number;
  cobrancas_aprovadas: number;
  encerradas: number;
  erros: { recorrencia_id: string; erro: string }[];
}

@Injectable()
export class RecorrenciasService {
  private readonly logger = new Logger('Recorrencias');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly clock: ClockService,
    private readonly cobrancas: CobrancasService,
    private readonly eventos: EventosService,
  ) {}

  private repo(m?: EntityManager) {
    return (m ?? this.ds.manager).getRepository(Recorrencia);
  }

  async listar(u: AuthUser, f: FiltroRecorrenciasDto) {
    const where: any = { tenant_id: u.tenant_id };
    if (f.cliente_id) where.cliente_id = f.cliente_id;
    if (f.contrato_id) where.contrato_id = f.contrato_id;
    if (f.ativa !== undefined) where.ativa = f.ativa;
    const [items, total] = await this.repo().findAndCount({ where, order: { created_at: 'DESC' }, skip: (f.page - 1) * f.limit, take: f.limit });
    return paginar(items.map((r) => this.enriquecer(r)), total, f);
  }

  async obter(u: AuthUser, id: string) {
    const r = await this.repo().findOne({ where: { id, tenant_id: u.tenant_id } });
    if (!r) throw new NotFoundException('Recorrência não encontrada');
    return r;
  }

  async detalhar(u: AuthUser, id: string) {
    const r = await this.obter(u, id);
    const execucoes = await this.ds.getRepository(RecorrenciaExecucao).find({
      where: { recorrencia_id: r.id, tenant_id: u.tenant_id },
      order: { competencia: 'DESC' },
      take: 24,
    });
    return { ...this.enriquecer(r), execucoes };
  }

  async criar(u: AuthUser, dto: CriarRecorrenciaDto) {
    if (dto.data_fim && dto.data_fim < dto.data_inicio) throw new UnprocessableEntityException('data_fim deve ser posterior a data_inicio');
    const base = { dia_vencimento: dto.dia_vencimento, dias_antecedencia: dto.dias_antecedencia ?? 10, periodicidade: dto.periodicidade };
    // Primeira competência cujo vencimento não é anterior ao início do contrato.
    let comp = competenciaDe(dto.data_inicio);
    if (cicloDe(base, comp).data_vencimento < dto.data_inicio) comp = proximaCompetencia(base, comp);
    const r = this.repo().create({
      ...dto,
      ...base,
      aprovacao_automatica: dto.aprovacao_automatica ?? true,
      proxima_competencia: comp,
      ativa: true,
      tenant_id: u.tenant_id,
      created_by: u.sub,
      updated_by: u.sub,
    });
    return this.enriquecer(await this.repo().save(r));
  }

  async atualizar(u: AuthUser, id: string, dto: AtualizarRecorrenciaDto) {
    const r = await this.obter(u, id);
    Object.assign(r, dto, { updated_by: u.sub });
    if (r.data_fim && r.data_fim < r.data_inicio) throw new UnprocessableEntityException('data_fim deve ser posterior a data_inicio');
    return this.enriquecer(await this.repo().save(r));
  }

  async alterarAtiva(u: AuthUser, id: string, ativa: boolean) {
    const r = await this.obter(u, id);
    if (r.ativa === ativa) throw new ConflictException(ativa ? 'Recorrência já está ativa' : 'Recorrência já está pausada');
    r.ativa = ativa;
    r.updated_by = u.sub;
    return this.enriquecer(await this.repo().save(r));
  }

  async remover(u: AuthUser, id: string) {
    const r = await this.obter(u, id);
    await this.repo().update(r.id, { ativa: false, deleted_by: u.sub });
    await this.repo().softDelete(r.id);
  }

  async previsao(u: AuthUser, id: string, ciclos: number) {
    const r = await this.obter(u, id);
    const out: (Ciclo & { valor: number })[] = [];
    let comp = r.proxima_competencia;
    for (let i = 0; i < ciclos; i++) {
      const c = cicloDe(r, comp);
      if (r.data_fim && c.data_vencimento > r.data_fim) break;
      out.push({ ...c, valor: totalItens(r.itens) });
      comp = proximaCompetencia(r, comp);
    }
    return out;
  }

  /** Geração manual imediata da próxima competência (ignora a antecedência). */
  gerarAgora(u: AuthUser, id: string) {
    return this.ds.transaction(async (m) => {
      const r = await this.repo(m).findOne({ where: { id, tenant_id: u.tenant_id }, lock: { mode: 'pessimistic_write' } });
      if (!r) throw new NotFoundException('Recorrência não encontrada');
      if (!r.ativa) throw new ConflictException('Recorrência pausada');
      const ciclo = cicloDe(r, r.proxima_competencia);
      if (r.data_fim && ciclo.data_vencimento > r.data_fim) throw new ConflictException('Contrato encerrado: não há próxima competência');
      return this.gerarCiclo(m, r, ciclo, 'manual', u);
    });
  }

  /**
   * NÚCLEO DA AUTOMAÇÃO. Chamado pelo agendador (cron) sem nenhuma ação humana:
   * para cada recorrência ativa cuja data de geração chegou, emite a cobrança da competência,
   * aprova (se configurado), gera a conta a receber/Pix, publica eventos e avança o ciclo.
   * Idempotente: a UNIQUE (recorrencia_id, competencia) impede cobrança duplicada mesmo com
   * mais de uma instância do serviço rodando, e o lock SKIP LOCKED evita disputa.
   */
  async processarPendentes(tenantId?: string): Promise<ResultadoProcessamento> {
    const hoje = this.clock.hoje();
    const res: ResultadoProcessamento = { recorrencias_avaliadas: 0, cobrancas_geradas: 0, cobrancas_aprovadas: 0, encerradas: 0, erros: [] };
    // Pré-filtro no banco: o 1º dia da competência menos a antecedência é um limite inferior da data de
    // geração (o vencimento nunca é antes do dia 1). Assim só os contratos possivelmente devidos são travados.
    const qb = this.repo()
      .createQueryBuilder('r')
      .select('r.id')
      .where('r.ativa = true')
      .andWhere(`${sql.inicioCompetenciaMenosDias('r.proxima_competencia', 'r.dias_antecedencia')} <= :hoje`, { hoje });
    if (tenantId) qb.andWhere('r.tenant_id = :t', { t: tenantId });
    const ids = (await qb.getMany()).map((r) => r.id);

    for (const id of ids) {
      res.recorrencias_avaliadas++;
      try {
        await this.ds.transaction(async (m) => {
          const r = await this.repo(m)
            .createQueryBuilder('r')
            .setLock('pessimistic_write')
            .setOnLocked('skip_locked')
            .where('r.id = :id AND r.ativa = true', { id })
            .getOne();
          if (!r) return;
          const sistema: AuthUser = { sub: SISTEMA_ID, tenant_id: r.tenant_id, permissoes: [Permissao.ADMIN], tipo: 'servico' };
          for (let i = 0; i < MAX_CICLOS_POR_EXECUCAO; i++) {
            const ciclo = cicloDe(r, r.proxima_competencia);
            if (r.data_fim && ciclo.data_vencimento > r.data_fim) {
              r.ativa = false;
              r.updated_by = SISTEMA_ID;
              await this.repo(m).save(r);
              res.encerradas++;
              break;
            }
            if (ciclo.data_geracao > hoje) break;
            const cob = await this.gerarCiclo(m, r, ciclo, 'agendador', sistema);
            res.cobrancas_geradas++;
            if (cob.status === 'aprovada') res.cobrancas_aprovadas++;
          }
        });
      } catch (e: any) {
        this.logger.error(`Recorrência ${id}: ${e?.message}`);
        res.erros.push({ recorrencia_id: id, erro: e?.message ?? String(e) });
      }
    }
    return res;
  }

  private async gerarCiclo(m: EntityManager, r: Recorrencia, ciclo: Ciclo, origem: 'agendador' | 'manual', u: AuthUser) {
    const cobranca = await this.cobrancas.criar(
      u,
      {
        cliente_id: r.cliente_id,
        contrato_id: r.contrato_id,
        competencia: ciclo.competencia,
        descricao: `${r.descricao} — ${ciclo.competencia.slice(5)}/${ciclo.competencia.slice(0, 4)}`,
        itens: r.itens,
        data_vencimento: ciclo.data_vencimento,
        forma_pagamento: r.forma_pagamento,
      },
      m,
      { recorrencia_id: r.id },
    );
    await m.getRepository(RecorrenciaExecucao).insert({
      tenant_id: r.tenant_id,
      recorrencia_id: r.id,
      competencia: ciclo.competencia,
      cobranca_id: cobranca.id,
      origem,
    });
    const final = r.aprovacao_automatica ? await this.cobrancas.aprovarInterno(m, u, cobranca) : cobranca;

    await this.eventos.publicar(m, r.tenant_id, TipoEvento.RECORRENCIA_COBRANCA_GERADA, r.id, {
      recorrencia_id: r.id,
      cobranca_id: cobranca.id,
      contrato_id: r.contrato_id,
      cliente_id: r.cliente_id,
      competencia: ciclo.competencia,
      data_vencimento: ciclo.data_vencimento,
      valor_total: cobranca.valor_total,
      aprovada_automaticamente: r.aprovacao_automatica,
      origem,
    });

    r.proxima_competencia = proximaCompetencia(r, ciclo.competencia);
    r.updated_by = u.sub;
    await this.repo(m).save(r);
    return final;
  }

  private enriquecer(r: Recorrencia) {
    const proximo = r.ativa ? cicloDe(r, r.proxima_competencia) : null;
    return { ...r, valor_ciclo: totalItens(r.itens), proximo_ciclo: proximo };
  }
}
