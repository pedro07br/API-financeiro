/**
 * Parser de extratos OFX (Open Financial Exchange) — suporta OFX 1.x (SGML, tags folha sem fechamento,
 * padrão da maioria dos bancos brasileiros) e OFX 2.x (XML). Sem dependências externas.
 */
export interface TransacaoOfx {
  fitid: string;
  data: string; // YYYY-MM-DD
  valor: number; // positivo = crédito, negativo = débito
  tipo: 'credito' | 'debito';
  trntype: string;
  descricao: string;
}

export interface ExtratoOfx {
  banco_id: string | null;
  conta_id: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  transacoes: TransacaoOfx[];
}

export class OfxInvalidoError extends Error {}

/** Decodifica o buffer respeitando o CHARSET do cabeçalho (bancos BR costumam usar 1252/Latin-1). */
export function decodificarOfx(buf: Buffer): string {
  const cabecalho = buf.subarray(0, 400).toString('latin1');
  const latin = /CHARSET:\s*(1252|ISO-8859-1|8859-1)/i.test(cabecalho) || /encoding="(windows-1252|iso-8859-1)"/i.test(cabecalho);
  return buf.toString(latin ? 'latin1' : 'utf8');
}

const tag = (bloco: string, nome: string): string | null => {
  const m = new RegExp(`<${nome}>\\s*([^<\\r\\n]*)`, 'i').exec(bloco);
  return m ? m[1].trim() : null;
};

function dataOfx(v: string | null): string | null {
  if (!v || !/^\d{8}/.test(v)) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

export function parseOfx(conteudo: string): ExtratoOfx {
  if (!/<OFX>/i.test(conteudo)) throw new OfxInvalidoError('Arquivo não contém o elemento <OFX>');
  const blocos = conteudo.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) ?? [];
  const transacoes: TransacaoOfx[] = [];

  blocos.forEach((b, i) => {
    const valorBruto = tag(b, 'TRNAMT');
    const data = dataOfx(tag(b, 'DTPOSTED'));
    if (!valorBruto || !data) throw new OfxInvalidoError(`Transação #${i + 1} sem TRNAMT ou DTPOSTED válidos`);
    const valor = Number(valorBruto.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(valor) || valor === 0) throw new OfxInvalidoError(`Transação #${i + 1} com valor inválido: ${valorBruto}`);
    const memo = tag(b, 'MEMO');
    const nome = tag(b, 'NAME');
    transacoes.push({
      fitid: tag(b, 'FITID') || `${data}-${valor}-${i}`,
      data,
      valor: Math.round(valor * 100) / 100,
      tipo: valor > 0 ? 'credito' : 'debito',
      trntype: (tag(b, 'TRNTYPE') ?? '').toUpperCase(),
      descricao: [nome, memo].filter(Boolean).join(' | ').slice(0, 300),
    });
  });

  return {
    banco_id: tag(conteudo, 'BANKID'),
    conta_id: tag(conteudo, 'ACCTID'),
    periodo_inicio: dataOfx(tag(conteudo, 'DTSTART')),
    periodo_fim: dataOfx(tag(conteudo, 'DTEND')),
    transacoes,
  };
}
