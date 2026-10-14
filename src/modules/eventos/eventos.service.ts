import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes } from 'crypto';
import { EntityManager, In, LessThanOrEqual, Repository } from 'typeorm';
import { AuthUser } from '../../common/auth/auth-user';
import { ClockService } from '../../common/clock.service';
import { sql } from '../../common/dialeto';
import { PaginacaoDto, paginar } from '../../common/dto/paginacao.dto';
import { Evento } from './evento.entity';
import { WebhookAssinatura } from './webhook-assinatura.entity';

const MAX_TENTATIVAS = 8;

@Injectable()
export class EventosService {
  private readonly logger = new Logger('Eventos');

  constructor(
    @InjectRepository(Evento) private readonly eventos: Repository<Evento>,
    @InjectRepository(WebhookAssinatura) private readonly assinaturas: Repository<WebhookAssinatura>,
    private readonly clock: ClockService,
  ) {}

  /** Registra o evento dentro da transação corrente (outbox). Nunca faz I/O de rede aqui. */
  async publicar(m: EntityManager, tenantId: string, tipo: string, agregadoId: string, payload: Record<string, unknown>) {
    await m.getRepository(Evento).insert({
      tenant_id: tenantId,
      tipo,
      agregado_id: agregadoId,
      payload: { ...payload, tipo, tenant_id: tenantId, ocorrido_em: this.clock.agora().toISOString() },
      proxima_tentativa: this.clock.agora(),
    });
  }

  listar(user: AuthUser, p: PaginacaoDto & { tipo?: string }) {
    return this.eventos
      .findAndCount({
        where: { tenant_id: user.tenant_id, ...(p.tipo ? { tipo: p.tipo } : {}) },
        order: { created_at: 'DESC' },
        skip: (p.page - 1) * p.limit,
        take: p.limit,
      })
      .then(([items, total]) => paginar(items, total, p));
  }

  async criarAssinatura(user: AuthUser, dto: { modulo: string; url: string; eventos: string[] }) {
    const segredo = randomBytes(24).toString('hex');
    const salvo = await this.assinaturas.save(
      this.assinaturas.create({ ...dto, segredo, tenant_id: user.tenant_id, created_by: user.sub }),
    );
    // O segredo é exibido UMA única vez, para o assinante validar a assinatura HMAC das entregas.
    return { ...salvo, segredo };
  }

  listarAssinaturas(user: AuthUser) {
    return this.assinaturas.find({ where: { tenant_id: user.tenant_id }, order: { created_at: 'DESC' } });
  }

  async removerAssinatura(user: AuthUser, id: string) {
    const a = await this.assinaturas.findOne({ where: { id, tenant_id: user.tenant_id } });
    if (!a) throw new NotFoundException('Assinatura não encontrada');
    await this.assinaturas.update(a.id, { deleted_by: user.sub, ativa: false });
    await this.assinaturas.softDelete(a.id);
  }

  /**
   * Despachante: entrega os eventos pendentes aos assinantes via HTTP POST assinado (HMAC-SHA256),
   * com nova tentativa em backoff exponencial. Comunicação máquina-a-máquina, sem operador.
   */
  async despachar(lote = 50): Promise<{ processados: number; entregues: number; falhas: number }> {
    const pendentes = await this.eventos.find({
      where: { status: 'pendente', proxima_tentativa: LessThanOrEqual(this.clock.agora()) },
      order: { created_at: 'ASC' },
      take: lote,
    });
    let entregues = 0;
    let falhas = 0;

    for (const ev of pendentes) {
      const destinos = await this.assinaturas
        .createQueryBuilder('a')
        .addSelect('a.segredo')
        .where(`a.tenant_id = :t AND a.ativa = true AND ${sql.listaContem('a.eventos', 'tipo')}`, { t: ev.tenant_id, tipo: ev.tipo })
        .getMany();

      if (destinos.length === 0) {
        await this.eventos.update(ev.id, { status: 'sem_assinantes' });
        continue;
      }

      const corpo = JSON.stringify({ id: ev.id, ...ev.payload });
      const erros: string[] = [];
      await Promise.all(
        destinos.map(async (d) => {
          const assinatura = createHmac('sha256', d.segredo).update(corpo).digest('hex');
          try {
            const r = await fetch(d.url, {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'x-financeiro-evento': ev.tipo,
                'x-financeiro-assinatura': `sha256=${assinatura}`,
              },
              body: corpo,
              signal: AbortSignal.timeout(5000),
            });
            if (!r.ok) erros.push(`${d.modulo}: HTTP ${r.status}`);
          } catch (e: any) {
            erros.push(`${d.modulo}: ${e?.message ?? e}`);
          }
        }),
      );

      if (erros.length === 0) {
        entregues++;
        await this.eventos.update(ev.id, { status: 'entregue', entregue_em: this.clock.agora(), tentativas: ev.tentativas + 1 });
      } else {
        falhas++;
        const tentativas = ev.tentativas + 1;
        const atraso = Math.min(2 ** tentativas * 30, 3600) * 1000;
        await this.eventos.update(ev.id, {
          tentativas,
          status: tentativas >= MAX_TENTATIVAS ? 'falha' : 'pendente',
          ultimo_erro: erros.join('; ').slice(0, 500),
          proxima_tentativa: new Date(this.clock.agora().getTime() + atraso),
        });
        this.logger.warn(`Evento ${ev.tipo} (${ev.id}) falhou: ${erros.join('; ')}`);
      }
    }
    return { processados: pendentes.length, entregues, falhas };
  }

  async contarPorStatus(tenantId: string) {
    const linhas = await this.eventos
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)', 'total')
      .where('e.tenant_id = :t', { t: tenantId })
      .groupBy('e.status')
      .getRawMany();
    return linhas.map((l) => ({ status: l.status, total: Number(l.total) }));
  }

  porIds(ids: string[]) {
    return this.eventos.find({ where: { id: In(ids) } });
  }
}
