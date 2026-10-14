import { diffDias } from '../../common/datas';

/**
 * Motor de conciliação: dado um lançamento do extrato, pontua os títulos em aberto candidatos.
 * Função pura (sem banco) para ser testável isoladamente.
 *
 *  - txid do Pix presente na descrição do extrato ......... 100 pontos (identificação unívoca)
 *  - valor idêntico ao saldo do título .................... 60 pontos (condição obrigatória sem txid)
 *  - data do crédito até 3 dias do vencimento ............. +30
 *  - data do crédito entre 4 e 10 dias do vencimento ...... +15
 *  - diferença acima de 45 dias ........................... descartado
 *
 * A baixa automática ocorre apenas quando o melhor candidato atinge LIMIAR_AUTOMATICO e é ÚNICO
 * com essa pontuação; empates ou pontuação menor ficam pendentes para decisão humana (com sugestões).
 */
export const LIMIAR_AUTOMATICO = 75;

export interface Candidato {
  id: string;
  saldo_cent: number;
  data_vencimento: string;
  pix_txid?: string | null;
}

export interface Lancamento {
  valor_cent: number; // absoluto
  data: string;
  descricao: string;
}

export interface Pontuacao {
  id: string;
  score: number;
  criterio: string;
}

export function pontuar(l: Lancamento, candidatos: Candidato[]): Pontuacao[] {
  const desc = l.descricao.toUpperCase();
  const out: Pontuacao[] = [];
  for (const c of candidatos) {
    if (c.pix_txid && desc.includes(c.pix_txid.toUpperCase()) && l.valor_cent <= c.saldo_cent) {
      out.push({ id: c.id, score: 100, criterio: 'txid_pix' });
      continue;
    }
    if (c.saldo_cent !== l.valor_cent) continue;
    const dias = Math.abs(diffDias(c.data_vencimento, l.data));
    if (dias > 45) continue;
    const bonus = dias <= 3 ? 30 : dias <= 10 ? 15 : 0;
    out.push({ id: c.id, score: 60 + bonus, criterio: bonus ? `valor_exato+data(${dias}d)` : 'valor_exato' });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Retorna o candidato vencedor para baixa automática, ou null se a decisão for ambígua. */
export function escolherAutomatico(p: Pontuacao[]): Pontuacao | null {
  if (!p.length || p[0].score < LIMIAR_AUTOMATICO) return null;
  if (p.length > 1 && p[1].score === p[0].score) return null;
  return p[0];
}
