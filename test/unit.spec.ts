import { addDias, addMeses, comDia, diffDias } from '../src/common/datas';
import { cicloDe, proximaCompetencia } from '../src/modules/recorrencias/recorrencias.service';
import { calcularEncargos, faixaDe } from '../src/modules/inadimplencia/encargos';
import { escolherAutomatico, pontuar } from '../src/modules/conciliacoes/motor-conciliacao';
import { decodificarOfx, OfxInvalidoError, parseOfx } from '../src/modules/conciliacoes/ofx.parser';
import { crc16, gerarBrCode } from '../src/modules/pix/brcode';
import { totalItens } from '../src/modules/cobrancas/cobrancas.service';
import { Periodicidade } from '../src/common/enums';

describe('datas', () => {
  it('soma meses respeitando fim de mês', () => {
    expect(addMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMeses('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMeses('2026-11-15', 3)).toBe('2027-02-15');
  });
  it('diferença e soma de dias', () => {
    expect(diffDias('2026-10-01', '2026-10-31')).toBe(30);
    expect(diffDias('2026-12-31', '2027-01-01')).toBe(1);
    expect(addDias('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('dia de vencimento 31 em mês curto cai no último dia', () => {
    expect(comDia('2026-02', 31)).toBe('2026-02-28');
    expect(comDia('2026-04', 31)).toBe('2026-04-30');
  });
});

describe('recorrência — cálculo de ciclo', () => {
  it('gera N dias antes do vencimento', () => {
    expect(cicloDe({ dia_vencimento: 10, dias_antecedencia: 10 }, '2026-11')).toEqual({
      competencia: '2026-11', data_vencimento: '2026-11-10', data_geracao: '2026-10-31',
    });
  });
  it('avança pela periodicidade', () => {
    expect(proximaCompetencia({ periodicidade: Periodicidade.MENSAL }, '2026-12')).toBe('2027-01');
    expect(proximaCompetencia({ periodicidade: Periodicidade.TRIMESTRAL }, '2026-11')).toBe('2027-02');
    expect(proximaCompetencia({ periodicidade: Periodicidade.ANUAL }, '2026-10')).toBe('2027-10');
  });
  it('soma itens em centavos sem erro de ponto flutuante', () => {
    expect(totalItens([
      { tipo: 'servico', descricao: 'a', quantidade: 3, valor_unitario: 0.1 },
      { tipo: 'consumo', descricao: 'b', quantidade: 1.5, valor_unitario: 19.99 },
    ])).toBe(30.29);
  });
});

describe('encargos e aging', () => {
  it('sem atraso não há encargos', () => {
    expect(calcularEncargos(10000, 0)).toEqual({ multa: 0, juros: 0, valor_atualizado: 100 });
  });
  it('multa 2% + juros 1% a.m. pro rata', () => {
    // R$ 1.000,00 com 15 dias: multa 20,00 + juros 5,00
    expect(calcularEncargos(100000, 15)).toEqual({ multa: 20, juros: 5, valor_atualizado: 1025 });
  });
  it('classifica faixas de aging', () => {
    expect([0, 1, 30, 31, 61, 91, 400].map(faixaDe)).toEqual(['a_vencer', '1_30', '1_30', '31_60', '61_90', 'acima_90', 'acima_90']);
  });
});

describe('Pix BR Code', () => {
  it('CRC16-CCITT (vetor de referência "123456789" = 29B1)', () => {
    expect(crc16('123456789')).toBe('29B1');
  });
  it('payload termina com CRC válido e contém chave, valor e txid', () => {
    const br = gerarBrCode({ chave: 'financeiro@empresa.com.br', valor: 199.9, txid: 'ABC123' });
    expect(br.startsWith('000201')).toBe(true);
    expect(br).toContain('0014br.gov.bcb.pix');
    expect(br).toContain('5406199.90');
    expect(br).toContain('0506ABC123');
    expect(crc16(br.slice(0, -4))).toBe(br.slice(-4));
  });
});

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
ENCODING:USASCII
CHARSET:1252

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0001<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010120000[-3:BRT]<TRNAMT>199,90<FITID>A1<NAME>PIX RECEBIDO<MEMO>Pagamento São João</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015<TRNAMT>-850.00<FITID>A2<MEMO>TED fornecedor</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

describe('parser OFX', () => {
  it('lê OFX 1.x SGML (tags sem fechamento, vírgula decimal, Latin-1)', () => {
    const e = parseOfx(decodificarOfx(Buffer.from(OFX_SGML, 'latin1')));
    expect(e).toMatchObject({ banco_id: '0001', conta_id: '12345-6', periodo_inicio: '2026-10-01', periodo_fim: '2026-10-31' });
    expect(e.transacoes).toEqual([
      { fitid: 'A1', data: '2026-10-10', valor: 199.9, tipo: 'credito', trntype: 'CREDIT', descricao: 'PIX RECEBIDO | Pagamento São João' },
      { fitid: 'A2', data: '2026-10-15', valor: -850, tipo: 'debito', trntype: 'DEBIT', descricao: 'TED fornecedor' },
    ]);
  });
  it('lê OFX 2.x XML', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200" VERSION="220"?>
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>20261005</DTPOSTED><TRNAMT>10.00</TRNAMT><FITID>X</FITID><MEMO>ok</MEMO></STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    expect(parseOfx(xml).transacoes[0]).toMatchObject({ fitid: 'X', valor: 10, data: '2026-10-05' });
  });
  it('rejeita arquivo que não é OFX ou transação sem valor', () => {
    expect(() => parseOfx('nome;valor\nfoo;10')).toThrow(OfxInvalidoError);
    expect(() => parseOfx('<OFX><STMTTRN><DTPOSTED>20261001</STMTTRN></OFX>')).toThrow(OfxInvalidoError);
  });
});

describe('motor de conciliação', () => {
  const base = { valor_cent: 19990, data: '2026-10-10', descricao: 'PIX RECEBIDO' };
  it('txid na descrição identifica univocamente (score 100)', () => {
    const p = pontuar({ ...base, descricao: 'PIX abcDEF123' }, [
      { id: 'a', saldo_cent: 19990, data_vencimento: '2026-10-10', pix_txid: 'ABCDEF123' },
      { id: 'b', saldo_cent: 19990, data_vencimento: '2026-10-10' },
    ]);
    expect(escolherAutomatico(p)).toEqual({ id: 'a', score: 100, criterio: 'txid_pix' });
  });
  it('valor exato + data próxima concilia sozinho', () => {
    const p = pontuar(base, [{ id: 'a', saldo_cent: 19990, data_vencimento: '2026-10-08' }]);
    expect(escolherAutomatico(p)?.id).toBe('a');
  });
  it('empate fica pendente para decisão humana', () => {
    const p = pontuar(base, [
      { id: 'a', saldo_cent: 19990, data_vencimento: '2026-10-10' },
      { id: 'b', saldo_cent: 19990, data_vencimento: '2026-10-11' },
    ]);
    expect(p).toHaveLength(2);
    expect(escolherAutomatico(p)).toBeNull();
  });
  it('valor exato mas data distante não passa do limiar', () => {
    const p = pontuar(base, [{ id: 'a', saldo_cent: 19990, data_vencimento: '2026-09-20' }]);
    expect(p[0].score).toBe(60);
    expect(escolherAutomatico(p)).toBeNull();
  });
  it('valor diferente é descartado', () => {
    expect(pontuar(base, [{ id: 'a', saldo_cent: 19991, data_vencimento: '2026-10-10' }])).toEqual([]);
  });
});
