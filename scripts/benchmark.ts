/**
 * Benchmark dos mecanismos de automação com dados sintéticos (resultados usados na seção 4.7 do artigo).
 * Uso: npm run benchmark   (usa o banco TEST_DATABASE_URL/erp_test e o recria do zero)
 */
import '../test/env';
import { cpus } from 'os';
import { writeFileSync } from 'fs';
import { AddressInfo } from 'net';
import { assinarPix, BASE, criarApp, token, uuid } from '../test/helpers';
import { Permissao } from '../src/common/auth/auth-user';
import { CobrancasService } from '../src/modules/cobrancas/cobrancas.service';
import { ContasReceberService } from '../src/modules/contas-receber/contas-receber.service';
import { RecorrenciasService } from '../src/modules/recorrencias/recorrencias.service';
import { ConciliacoesService } from '../src/modules/conciliacoes/conciliacoes.service';
import { FormaPagamento, Periodicidade, StatusContaReceber } from '../src/common/enums';
import { config } from '../src/config';
import { Cobranca } from '../src/modules/cobrancas/cobranca.entity';
import { Evento } from '../src/modules/eventos/evento.entity';
import { ContaReceber } from '../src/modules/contas-receber/conta-receber.entity';
import { ExtratoTransacao } from '../src/modules/conciliacoes/conciliacao.entity';

const percentil = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 100) / 100;
};
const ms = (t0: bigint) => Number(process.hrtime.bigint() - t0) / 1e6;

// gerador pseudoaleatório determinístico (resultados reprodutíveis)
let semente = 42;
const rnd = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

async function main() {
  const ctx = await criarApp();
  await ctx.app.listen(0);
  const porta = (ctx.app.getHttpServer().address() as AddressInfo).port;
  const url = (p: string) => `http://127.0.0.1:${porta}${BASE}${p}`;
  const versaoBanco = String(Object.values((await ctx.ds.query('SELECT VERSION() AS v'))[0])[0]).split(' on ')[0];
  const resultados: any = {
    ambiente: { cpu: cpus()[0].model, nucleos: cpus().length, node: process.version, banco: `${config.banco} ${versaoBanco}`, data: new Date().toISOString() },
  };
  const sys = (tenant: string) => ({ sub: uuid(), tenant_id: tenant, permissoes: [Permissao.ADMIN], tipo: 'usuario' as const });

  // ---------------------------------------------------------------- 1. Recorrências
  {
    const TENANTS = 10, POR_TENANT = 100;
    ctx.clock.fixar('2026-09-01');
    const svc = ctx.app.get(RecorrenciasService);
    for (let t = 0; t < TENANTS; t++) {
      const u = sys(uuid());
      for (let i = 0; i < POR_TENANT; i++) {
        await svc.criar(u, {
          cliente_id: uuid(), contrato_id: uuid(), descricao: `Contrato ${i}`, periodicidade: Periodicidade.MENSAL,
          dia_vencimento: 1 + Math.floor(rnd() * 28), dias_antecedencia: 10, data_inicio: '2026-10-01',
          forma_pagamento: FormaPagamento.PIX, aprovacao_automatica: true,
          itens: [
            { tipo: 'servico', descricao: 'Plano', quantidade: 1, valor_unitario: Math.round(50 + rnd() * 500) },
            { tipo: 'consumo', descricao: 'Uso', quantidade: Math.ceil(rnd() * 10), valor_unitario: 2.5 },
          ],
        });
      }
    }
    // Avança o relógio para o fim de outubro: cada contrato tem 1 ciclo devido (out) e parte deles o de novembro.
    ctx.clock.fixar('2026-10-25');
    const t0 = process.hrtime.bigint();
    const r = await svc.processarPendentes();
    const dur = ms(t0);
    const cobs = await ctx.ds.getRepository(Cobranca).count();
    const evs = await ctx.ds.getRepository(Evento).count();
    const t1 = process.hrtime.bigint();
    const r2 = await svc.processarPendentes();
    resultados.recorrencias = {
      contratos: TENANTS * POR_TENANT,
      tenants: TENANTS,
      cobrancas_geradas: r.cobrancas_geradas,
      cobrancas_no_banco: cobs,
      eventos_publicados: evs,
      erros: r.erros.length,
      duracao_ms: Math.round(dur),
      cobrancas_por_segundo: Math.round((r.cobrancas_geradas / dur) * 1000),
      segunda_execucao_mesmo_dia: { cobrancas_geradas: r2.cobrancas_geradas, duracao_ms: Math.round(ms(t1)) },
    };
    console.log('recorrencias', resultados.recorrencias);
  }

  // ---------------------------------------------------------------- 2. Conciliação OFX
  {
    const T = uuid();
    const u = sys(T);
    ctx.clock.fixar('2026-10-01');
    const receber = ctx.app.get(ContasReceberService);
    const cobrancas = ctx.app.get(CobrancasService);
    type Esperado = { fitid: string; esperado: string | null };
    const linhas: string[] = [];
    const gabarito: Esperado[] = [];
    let n = 0;
    const venc = () => `2026-10-${String(1 + Math.floor(rnd() * 28)).padStart(2, '0')}`;
    const dataPg = (v: string, desvio: number) => {
      const d = new Date(v + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + desvio);
      return d.toISOString().slice(0, 10);
    };
    const stmt = (data: string, valor: number, memo: string) => {
      const fitid = `B${++n}`;
      linhas.push(`<STMTTRN><TRNTYPE>${valor > 0 ? 'CREDIT' : 'DEBIT'}<DTPOSTED>${data.replace(/-/g, '')}<TRNAMT>${valor.toFixed(2)}<FITID>${fitid}<MEMO>${memo}</STMTTRN>`);
      return fitid;
    };
    const usados = new Set<number>();
    const valorUnico = () => {
      let v: number;
      do v = Math.round((100 + rnd() * 4900) * 100); while (usados.has(v));
      usados.add(v);
      return v / 100;
    };

    // (a) 150 cobranças Pix pagas com txid no extrato
    for (let i = 0; i < 150; i++) {
      const c = await cobrancas.criar(u, {
        cliente_id: uuid(), competencia: '2026-10', descricao: 'Fatura', data_vencimento: venc(), forma_pagamento: FormaPagamento.PIX,
        itens: [{ tipo: 'servico', descricao: 'Plano', quantidade: 1, valor_unitario: valorUnico() }],
      });
      const ap = await ctx.ds.transaction((m) => cobrancas.aprovarInterno(m, u, c));
      gabarito.push({ fitid: stmt(dataPg(ap.data_vencimento, Math.floor(rnd() * 5) - 2), ap.valor_total, `PIX ${ap.pix_txid}`), esperado: ap.conta_receber_id });
    }
    // (b) 250 boletos/TED pagos com valor exato, até 3 dias do vencimento
    for (let i = 0; i < 250; i++) {
      const c = await receber.criar(u, { cliente_id: uuid(), descricao: 'Boleto', competencia: '2026-10', data_vencimento: venc(), valor: valorUnico() });
      gabarito.push({ fitid: stmt(dataPg(c.data_vencimento, Math.floor(rnd() * 4)), c.valor, 'LIQ BOLETO'), esperado: c.id });
    }
    // (c) 50 pagos com atraso de 5 a 10 dias (pontuação 75 → ainda automático)
    for (let i = 0; i < 50; i++) {
      const c = await receber.criar(u, { cliente_id: uuid(), descricao: 'Boleto', competencia: '2026-10', data_vencimento: venc(), valor: valorUnico() });
      gabarito.push({ fitid: stmt(dataPg(c.data_vencimento, 5 + Math.floor(rnd() * 6)), c.valor, 'TED'), esperado: c.id });
    }
    // (d) 40 pagos com juros embutidos (valor diferente do título) → devem ficar pendentes
    for (let i = 0; i < 40; i++) {
      const c = await receber.criar(u, { cliente_id: uuid(), descricao: 'Boleto', competencia: '2026-10', data_vencimento: venc(), valor: valorUnico() });
      gabarito.push({ fitid: stmt(dataPg(c.data_vencimento, 12), Math.round(c.valor * 1.024 * 100) / 100, 'LIQ BOLETO C/ JUROS'), esperado: null });
    }
    // (e) 30 pares de títulos com mesmo valor e mesmo vencimento → ambíguos, devem ficar pendentes
    for (let i = 0; i < 30; i++) {
      const v = valorUnico(), d = venc();
      await receber.criar(u, { cliente_id: uuid(), descricao: 'Mensalidade', competencia: '2026-10', data_vencimento: d, valor: v });
      await receber.criar(u, { cliente_id: uuid(), descricao: 'Mensalidade', competencia: '2026-10', data_vencimento: d, valor: v });
      gabarito.push({ fitid: stmt(d, v, 'PIX RECEBIDO'), esperado: null });
    }
    // (f) 30 créditos sem título correspondente (rendimentos, estornos de tarifa…)
    for (let i = 0; i < 30; i++) gabarito.push({ fitid: stmt(venc(), valorUnico(), 'CREDITO DIVERSO'), esperado: null });

    // embaralha a ordem das linhas do extrato
    for (let i = linhas.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [linhas[i], linhas[j]] = [linhas[j], linhas[i]];
    }
    const ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nCHARSET:1252\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0001<ACCTID>1-0</BANKACCTFROM><BANKTRANLIST>\n${linhas.join('\n')}\n</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const t0 = process.hrtime.bigint();
    const imp = await ctx.app.get(ConciliacoesService).importar(u, 'benchmark.ofx', Buffer.from(ofx, 'latin1'));
    const dur = ms(t0);

    const trans = await ctx.ds.getRepository(ExtratoTransacao).findBy({ conciliacao_id: imp.id });
    const porFitid = new Map(trans.map((t: any) => [t.fitid, t]));
    let vp = 0, fp = 0, fn = 0, vn = 0;
    for (const g of gabarito) {
      const t: any = porFitid.get(g.fitid);
      const auto = t.status === 'conciliada';
      if (g.esperado && auto && t.conta_receber_id === g.esperado) vp++;
      else if (auto) fp++;
      else if (g.esperado) fn++;
      else vn++;
    }
    resultados.conciliacao = {
      transacoes_no_extrato: gabarito.length,
      com_titulo_identificavel: gabarito.filter((g) => g.esperado).length,
      conciliadas_automaticamente: imp.conciliadas_automaticamente,
      pendentes_para_revisao: imp.pendentes,
      taxa_automatica_percentual: imp.taxa_automatica_percentual,
      matriz: { verdadeiros_positivos: vp, falsos_positivos: fp, falsos_negativos: fn, verdadeiros_negativos: vn },
      precisao_percentual: vp + fp ? Math.round((vp / (vp + fp)) * 10000) / 100 : 100,
      revocacao_percentual: vp + fn ? Math.round((vp / (vp + fn)) * 10000) / 100 : 100,
      duracao_ms: Math.round(dur),
      ms_por_transacao: Math.round((dur / gabarito.length) * 100) / 100,
    };
    console.log('conciliacao', resultados.conciliacao);
  }

  // ---------------------------------------------------------------- 3. Webhook Pix
  {
    const T = uuid();
    const u = sys(T);
    const cobrancas = ctx.app.get(CobrancasService);
    const notifs: any[] = [];
    for (let i = 0; i < 200; i++) {
      const c = await cobrancas.criar(u, {
        cliente_id: uuid(), competencia: '2026-10', descricao: 'Fatura', data_vencimento: '2026-10-20', forma_pagamento: FormaPagamento.PIX,
        itens: [{ tipo: 'servico', descricao: 'Plano', quantidade: 1, valor_unitario: 99.9 }],
      });
      const ap = await ctx.ds.transaction((m) => cobrancas.aprovarInterno(m, u, c));
      notifs.push({ endToEndId: `E${String(i).padStart(31, '0')}`, txid: ap.pix_txid, valor: '99.90', horario: '2026-10-19T13:00:00Z' });
    }
    const lat: number[] = [];
    let baixados = 0;
    for (const p of notifs) {
      const corpo = JSON.stringify({ pix: [p] });
      const t0 = process.hrtime.bigint();
      const r = await fetch(url('/webhooks/pix'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-pix-assinatura': assinarPix(corpo) }, body: corpo });
      lat.push(ms(t0));
      const j: any = await r.json();
      if (j.data?.resultados?.[0]?.resultado === 'baixado') baixados++;
    }
    const pagas = await ctx.ds.getRepository(ContaReceber).count({ where: { tenant_id: T, status: StatusContaReceber.PAGA } });
    resultados.webhook_pix = {
      notificacoes: notifs.length, baixados, contas_pagas_no_banco: pagas,
      latencia_ms: { p50: percentil(lat, 50), p95: percentil(lat, 95), p99: percentil(lat, 99) },
    };
    console.log('webhook_pix', resultados.webhook_pix);
  }

  // ---------------------------------------------------------------- 4. Latência da API (inclui validação do JWT RS256)
  {
    const T = uuid();
    const auth = { Authorization: `Bearer ${token(T)}`, 'content-type': 'application/json' };
    const medir = async (n: number, f: () => Promise<Response>) => {
      const xs: number[] = [];
      for (let i = 0; i < n; i++) {
        const t0 = process.hrtime.bigint();
        const r = await f();
        await r.arrayBuffer();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        xs.push(ms(t0));
      }
      return { requisicoes: n, p50: percentil(xs, 50), p95: percentil(xs, 95), p99: percentil(xs, 99) };
    };
    const criar = await medir(300, () =>
      fetch(url('/contas-receber'), {
        method: 'POST', headers: auth,
        body: JSON.stringify({ cliente_id: uuid(), descricao: 'X', competencia: '2026-11', data_vencimento: '2026-11-10', valor: Math.round((10 + rnd() * 100) * 100) / 100 }),
      }),
    );
    const listar = await medir(300, () => fetch(url('/contas-receber?limit=100'), { headers: auth }));
    const health = await medir(300, () => fetch(url('/health')));
    resultados.latencia_api_ms = { 'POST /contas-receber': criar, 'GET /contas-receber?limit=100': listar, 'GET /health': health };
    console.log('latencia', resultados.latencia_api_ms);
  }

  writeFileSync('benchmark-resultados.json', JSON.stringify(resultados, null, 2));
  console.log('\nResultados gravados em benchmark-resultados.json');
  await ctx.app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
