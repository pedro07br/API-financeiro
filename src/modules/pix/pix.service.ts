import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FormaPagamento } from '../../common/enums';
import { centavos } from '../../common/money';
import { ContaReceber } from '../contas-receber/conta-receber.entity';
import { ContasReceberService } from '../contas-receber/contas-receber.service';
import { PixRecebimento } from './pix-recebimento.entity';

export interface PixNotificado {
  endToEndId: string;
  txid: string;
  valor: string;
  horario: string;
  infoPagador?: string;
}

type Resultado = { endToEndId: string; resultado: 'baixado' | 'duplicado' | 'txid_desconhecido' | 'rejeitado'; detalhe?: string };

@Injectable()
export class PixService {
  private readonly logger = new Logger('Pix');

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly receber: ContasReceberService,
  ) {}

  /** Formato do callback da API Pix (BCB): { "pix": [ { endToEndId, txid, valor, horario } ] } */
  async processarNotificacao(body: { pix?: PixNotificado[] }) {
    if (!Array.isArray(body?.pix) || body.pix.length === 0) throw new UnprocessableEntityException('Corpo deve conter o array "pix"');
    const resultados: Resultado[] = [];
    for (const p of body.pix) {
      if (!p?.endToEndId || !p?.txid || !p?.valor || !p?.horario) {
        resultados.push({ endToEndId: p?.endToEndId ?? '?', resultado: 'rejeitado', detalhe: 'campos obrigatórios ausentes' });
        continue;
      }
      resultados.push(await this.processarUm(p));
    }
    return { recebidos: body.pix.length, resultados };
  }

  private processarUm(p: PixNotificado): Promise<Resultado> {
    return this.ds.transaction(async (m) => {
      if (await m.getRepository(PixRecebimento).exist({ where: { end_to_end_id: p.endToEndId } })) {
        return { endToEndId: p.endToEndId, resultado: 'duplicado' as const };
      }
      const conta = await m.getRepository(ContaReceber).findOne({ where: { pix_txid: p.txid }, lock: { mode: 'pessimistic_write' } });
      if (!conta) {
        this.logger.warn(`Pix ${p.endToEndId} com txid desconhecido ${p.txid}`);
        return { endToEndId: p.endToEndId, resultado: 'txid_desconhecido' as const };
      }
      const data = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(p.horario));
      try {
        await this.receber.registrarRecebimento(m, conta, centavos(p.valor), data, FormaPagamento.PIX, 'pix_webhook', null);
      } catch (e: any) {
        return { endToEndId: p.endToEndId, resultado: 'rejeitado' as const, detalhe: e?.message };
      }
      await m.getRepository(PixRecebimento).insert({
        tenant_id: conta.tenant_id,
        end_to_end_id: p.endToEndId,
        txid: p.txid,
        valor: Number(p.valor),
        horario: new Date(p.horario),
        conta_receber_id: conta.id,
      });
      return { endToEndId: p.endToEndId, resultado: 'baixado' as const };
    });
  }
}
