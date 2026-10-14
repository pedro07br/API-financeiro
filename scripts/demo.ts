/**
 * Demonstração narrada do fluxo M2M (para a apresentação do trabalho).
 * Mostra o módulo Financeiro operando como um "nó" autônomo: o tempo passa, ele cobra, o banco avisa,
 * ele baixa, avisa o módulo Core — e a única ação humana é configurar o contrato.
 *
 * Uso: npm run demo   (usa o banco erp_test e o recria do zero)
 */
import '../test/env';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { assinarPix, BASE, cliente, criarApp, uuid } from '../test/helpers';

const cor = { titulo: '\x1b[1;36m', ok: '\x1b[32m', auto: '\x1b[35m', humano: '\x1b[33m', fim: '\x1b[0m', cinza: '\x1b[90m' };
let passo = 0;
let acoesHumanas = 0;
let acoesAutomaticas = 0;
const titulo = (t: string) => console.log(`\n${cor.titulo}${++passo}. ${t}${cor.fim}`);
const humano = (t: string) => (acoesHumanas++, console.log(`   ${cor.humano}[HUMANO]${cor.fim} ${t}`));
const auto = (t: string) => (acoesAutomaticas++, console.log(`   ${cor.auto}[AUTOMÁTICO]${cor.fim} ${t}`));
const info = (t: string) => console.log(`   ${cor.cinza}${t}${cor.fim}`);
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function main() {
  const ctx = await criarApp();
  const TENANT = uuid();
  const api = cliente(ctx, TENANT);

  // "Módulo Core" simulado, que só escuta eventos do Financeiro
  const recebidosCore: any[] = [];
  const core = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      recebidosCore.push(JSON.parse(b));
      res.statusCode = 204;
      res.end();
    });
  });
  await new Promise<void>((r) => core.listen(0, r));
  const urlCore = `http://127.0.0.1:${(core.address() as AddressInfo).port}/api/core/webhooks/financeiro`;

  titulo('Descoberta: outro serviço verifica se o Financeiro está no ar');
  const h = (await ctx.http().get(`${BASE}/health`)).body.data;
  auto(`GET /health → ${h.status} (${h.dependencias.banco.tipo} ${h.dependencias.banco.status}, v${h.versao})`);

  titulo('Módulo Core se inscreve para ser avisado de pagamentos e atrasos');
  await api.post('/eventos/assinaturas', { modulo: 'core', url: urlCore, eventos: ['cobranca.paga', 'conta_receber.vencida', 'recorrencia.cobranca_gerada'] });
  auto('Assinatura criada via API (comunicação serviço-a-serviço)');

  titulo('Configuração dos contratos (única etapa humana)');
  ctx.clock.fixar('2026-09-15');
  const itens = [
    { tipo: 'servico', descricao: 'Licença plano Pro', quantidade: 1, valor_unitario: 249.9 },
    { tipo: 'consumo', descricao: 'Usuários adicionais', quantidade: 4, valor_unitario: 15 },
  ];
  const r1 = (await api.post('/recorrencias', { cliente_id: uuid(), contrato_id: uuid(), descricao: 'Assinatura Cliente Alfa', periodicidade: 'mensal', dia_vencimento: 10, dias_antecedencia: 10, data_inicio: '2026-10-01', forma_pagamento: 'pix', itens })).body.data;
  humano(`Recorrência "Cliente Alfa" — ${brl(r1.valor_ciclo)}/mês, vence dia 10, Pix`);
  const r2 = (await api.post('/recorrencias', { cliente_id: uuid(), contrato_id: uuid(), descricao: 'Assinatura Cliente Beta', periodicidade: 'mensal', dia_vencimento: 10, dias_antecedencia: 10, data_inicio: '2026-10-01', forma_pagamento: 'boleto', itens: [itens[0]] })).body.data;
  humano(`Recorrência "Cliente Beta" — ${brl(r2.valor_ciclo)}/mês, vence dia 10, boleto`);

  titulo('30/09 00:05 — o agendador acorda sozinho');
  ctx.clock.fixar('2026-09-30');
  const g = (await ctx.agendador.executar('recorrencias')).resultado as any;
  auto(`${g.cobrancas_geradas} cobranças emitidas e aprovadas para a competência 10/2026`);
  const contas = (await api.get('/contas-receber')).body.data.items;
  const alfa = contas.find((c: any) => c.pix_txid);
  const beta = contas.find((c: any) => !c.pix_txid);
  auto(`Pix copia-e-cola gerado para Alfa (txid ${alfa.pix_txid.slice(0, 12)}…)`);
  auto(`Contas a receber criadas: ${contas.length}`);

  titulo('08/10 — Cliente Alfa paga o Pix; o banco (PSP) notifica o Financeiro');
  const corpo = JSON.stringify({ pix: [{ endToEndId: 'E18236120202610081432s0000000001', txid: alfa.pix_txid, valor: alfa.valor.toFixed(2), horario: '2026-10-08T17:32:00Z' }] });
  const w = (await ctx.http().post(`${BASE}/webhooks/pix`).set('content-type', 'application/json').set('x-pix-assinatura', assinarPix(corpo)).send(corpo)).body.data;
  auto(`Webhook Pix assinado (HMAC) recebido → ${w.resultados[0].resultado}`);
  const alfaDepois = (await api.get(`/contas-receber/${alfa.id}`)).body.data;
  auto(`Conta Alfa: ${alfaDepois.status}, ${brl(alfaDepois.valor_pago)} em ${alfaDepois.data_pagamento} — sem digitação`);

  titulo('Despachante entrega os eventos ao módulo Core');
  const d = await ctx.eventos.despachar();
  auto(`${d.entregues} eventos entregues via HTTP POST assinado`);
  for (const e of recebidosCore) info(`Core recebeu: ${e.tipo}${e.competencia ? ` (${e.competencia})` : ''}`);

  titulo('11/10 00:15 — job de vencimentos');
  ctx.clock.fixar('2026-10-11');
  const v = (await ctx.agendador.executar('vencimentos')).resultado as any;
  auto(`${v.contas_receber_vencidas} conta marcada como vencida (Cliente Beta)`);
  recebidosCore.length = 0;
  await ctx.eventos.despachar();
  for (const e of recebidosCore) info(`Core recebeu: ${e.tipo} → pode suspender o acesso do cliente automaticamente`);

  titulo('25/10 — painel de inadimplência');
  ctx.clock.fixar('2026-10-25');
  const res = (await api.get('/inadimplencia/resumo')).body.data;
  const linha = (await api.get('/inadimplencia')).body.data.items[0];
  info(`Total vencido ${brl(res.total_vencido)} | atualizado ${brl(res.total_vencido_atualizado)} | taxa ${res.taxa_inadimplencia_percentual}%`);
  info(`Beta: ${linha.dias_atraso} dias de atraso, multa ${brl(linha.multa)}, juros ${brl(linha.juros)}`);

  titulo('26/10 — extrato OFX do banco chega com o boleto do Beta pago');
  const ofx = `OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nCHARSET:1252\n\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0001<ACCTID>12345-6</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261008<TRNAMT>${alfa.valor.toFixed(2)}<FITID>X1<MEMO>PIX ${alfa.pix_txid}</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261013<TRNAMT>${beta.valor.toFixed(2)}<FITID>X2<MEMO>LIQUIDACAO BOLETO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261015<TRNAMT>-19.90<FITID>X3<MEMO>TARIFA PACOTE SERVICOS</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  humano('Upload do arquivo OFX (no futuro: busca automática via Open Finance)');
  const imp = (await api.post('/conciliacoes/importar', { nome_arquivo: 'extrato-out.ofx', conteudo: ofx })).body.data;
  auto(`${imp.total_transacoes} transações lidas, ${imp.conciliadas_automaticamente} conciliadas automaticamente, ${imp.pendentes} pendentes`);
  info('Pix do Alfa, já baixado pelo webhook, foi só vinculado ao título (sem baixa em dobro)');
  info('Tarifa bancária não tem título → fica para o financeiro classificar');
  const betaDepois = (await api.get(`/contas-receber/${beta.id}`)).body.data;
  auto(`Conta Beta: ${betaDepois.status} em ${betaDepois.data_pagamento}`);

  console.log(`\n${cor.ok}Resumo: ${acoesHumanas} ações humanas × ${acoesAutomaticas} ações executadas automaticamente pelo sistema.${cor.fim}\n`);
  core.close();
  await ctx.app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
