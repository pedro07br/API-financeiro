import './env';
import { createHmac } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import * as jwt from 'jsonwebtoken';
import { generateKeyPairSync } from 'crypto';
import { assinarPix, BASE, cliente, criarApp, Ctx, token, uuid } from './helpers';
import { crc16 } from '../src/modules/pix/brcode';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

const binario = (res: any, cb: any) => {
  const partes: Buffer[] = [];
  res.on('data', (c: Buffer) => partes.push(c));
  res.on('end', () => cb(null, Buffer.concat(partes)));
};
import { ContaReceber } from '../src/modules/contas-receber/conta-receber.entity';
import { Cobranca } from '../src/modules/cobrancas/cobranca.entity';
import { Evento } from '../src/modules/eventos/evento.entity';

let ctx: Ctx;
const TENANT_A = uuid();
const TENANT_B = uuid();
let A: ReturnType<typeof cliente>;
let B: ReturnType<typeof cliente>;

beforeAll(async () => {
  ctx = await criarApp();
  A = cliente(ctx, TENANT_A);
  B = cliente(ctx, TENANT_B);
});
afterAll(async () => {
  await ctx.app.close();
});
beforeEach(() => ctx.clock.fixar('2026-10-01'));

const novaConta = (over: object = {}) => ({
  cliente_id: uuid(),
  descricao: 'Mensalidade',
  competencia: '2026-10',
  data_vencimento: '2026-10-10',
  valor: 199.9,
  ...over,
});

// ------------------------------------------------------------------------------------------------
describe('Health e formato de resposta', () => {
  it('GET /health é público e informa banco e agendador', async () => {
    const r = await ctx.http().get(`${BASE}/health`).expect(200);
    expect(r.body).toMatchObject({ success: true, message: null, errors: null, data: { status: 'ok', modulo: 'financeiro' } });
    expect(r.body.data.dependencias.banco.status).toBe('ok');
  });

  it('erros seguem { success:false, data:null, message, errors }', async () => {
    const r = await A.post('/contas-receber', { valor: -1 }).expect(422);
    expect(r.body.success).toBe(false);
    expect(r.body.data).toBeNull();
    expect(r.body.message).toBe('Dados inválidos');
    expect(r.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ campo: 'cliente_id' }), expect.objectContaining({ campo: 'valor' })]));
  });

  it('paginação limitada a 100 registros', async () => {
    await A.get('/contas-receber?limit=100').expect(200);
    const r = await A.get('/contas-receber?limit=101').expect(422);
    expect(r.body.errors[0].mensagem).toMatch(/100/);
  });

  it('documentação OpenAPI disponível', async () => {
    await ctx.http().get(`${BASE}/docs-json`).expect(200);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Autenticação JWT RS256 e multi-tenant', () => {
  it('sem token → 401', async () => {
    const r = await ctx.http().get(`${BASE}/contas-receber`).expect(401);
    expect(r.body.message).toBe('Token de acesso ausente');
  });

  it('token assinado por outra chave → 401', async () => {
    const outra = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const t = jwt.sign({ tenant_id: TENANT_A, permissoes: ['financeiro:admin'] }, outra, { algorithm: 'RS256', subject: 'x', issuer: 'auth' });
    await ctx.http().get(`${BASE}/contas-receber`).set('Authorization', `Bearer ${t}`).expect(401);
  });

  it('ataque de troca de algoritmo (HS256 com a chave pública como segredo) → 401', async () => {
    const t = jwt.sign({ tenant_id: TENANT_A, permissoes: ['financeiro:admin'] }, 'qualquer', { algorithm: 'HS256', subject: 'x' });
    await ctx.http().get(`${BASE}/contas-receber`).set('Authorization', `Bearer ${t}`).expect(401);
  });

  it('token expirado → 401 com mensagem específica', async () => {
    const t = token(TENANT_A, undefined, {}, { expiresIn: -10 });
    const r = await ctx.http().get(`${BASE}/contas-receber`).set('Authorization', `Bearer ${t}`).expect(401);
    expect(r.body.message).toBe('Token expirado');
  });

  it('token sem tenant_id → 401', async () => {
    const t = token(undefined as any);
    await ctx.http().get(`${BASE}/contas-receber`).set('Authorization', `Bearer ${t}`).expect(401);
  });

  it('permissão insuficiente → 403 (somente leitura não escreve)', async () => {
    const leitor = cliente(ctx, TENANT_A, ['financeiro:leitura']);
    await leitor.get('/contas-receber').expect(200);
    await leitor.post('/contas-receber', novaConta()).expect(403);
  });

  it('tenant_id nunca é aceito do cliente da API', async () => {
    const r = await A.post('/contas-receber', novaConta({ tenant_id: TENANT_B })).expect(422);
    expect(JSON.stringify(r.body.errors)).toMatch(/tenant_id/);
  });

  it('isolamento: tenant B não enxerga dados do tenant A', async () => {
    const { body } = await A.post('/contas-receber', novaConta()).expect(201);
    const id = body.data.id;
    expect(body.data.tenant_id).toBe(TENANT_A);
    await B.get(`/contas-receber/${id}`).expect(404);
    await B.patch(`/contas-receber/${id}`, { descricao: 'x' }).expect(404);
    await B.del(`/contas-receber/${id}`).expect(404);
    const lista = await B.get('/contas-receber').expect(200);
    expect(lista.body.data.items.find((c: any) => c.id === id)).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------
describe('Contas a receber', () => {
  it('ciclo completo: cria, atualiza, baixa parcial, baixa total, bloqueia exclusão', async () => {
    const c = (await A.post('/contas-receber', novaConta({ valor: 300, desconto: 0 })).expect(201)).body.data;
    expect(c).toMatchObject({ status: 'em_aberto', saldo: 300 });

    await A.patch(`/contas-receber/${c.id}`, { status: 'agendada' }).expect(200);

    const p1 = (await A.post(`/contas-receber/${c.id}/baixa`, { valor: 100, data_pagamento: '2026-10-05', forma_pagamento: 'pix' }).expect(200)).body.data;
    expect(p1).toMatchObject({ status: 'parcialmente_paga', valor_pago: 100, saldo: 200 });

    await A.post(`/contas-receber/${c.id}/baixa`, { valor: 250, data_pagamento: '2026-10-05', forma_pagamento: 'pix' }).expect(422);

    const p2 = (await A.post(`/contas-receber/${c.id}/baixa`, { valor: 200, data_pagamento: '2026-10-06', forma_pagamento: 'pix' }).expect(200)).body.data;
    expect(p2).toMatchObject({ status: 'paga', valor_pago: 300, saldo: 0 });

    await A.patch(`/contas-receber/${c.id}`, { valor: 1 }).expect(409);
    await A.del(`/contas-receber/${c.id}`).expect(409);
    const est = (await A.post(`/contas-receber/${c.id}/estorno`).expect(200)).body.data;
    expect(est.status).toBe('estornada');
  });

  it('exclusão é lógica (soft delete) com auditoria', async () => {
    const c = (await A.post('/contas-receber', novaConta()).expect(201)).body.data;
    await A.del(`/contas-receber/${c.id}`).expect(204);
    await A.get(`/contas-receber/${c.id}`).expect(404);
    const linha = await ctx.ds.getRepository(ContaReceber).findOne({ where: { id: c.id }, withDeleted: true });
    expect(linha.deleted_at).not.toBeNull();
    expect(linha.deleted_by).not.toBeNull();
    expect(linha.created_by).not.toBeNull();
  });

  it('filtros e paginação', async () => {
    const cli = uuid();
    for (let i = 1; i <= 3; i++) await A.post('/contas-receber', novaConta({ cliente_id: cli, data_vencimento: `2026-11-0${i}`, competencia: '2026-11' }));
    const r = (await A.get(`/contas-receber?cliente_id=${cli}&limit=2&page=2`).expect(200)).body.data;
    expect(r.meta).toEqual({ page: 2, limit: 2, total: 3, total_pages: 2 });
    expect(r.items).toHaveLength(1);
    expect(r.items[0].data_vencimento).toBe('2026-11-03');
  });
});

// ------------------------------------------------------------------------------------------------
describe('Contas a pagar', () => {
  it('cria, paga e publica evento conta_pagar.paga', async () => {
    const c = (await A.post('/contas-pagar', {
      fornecedor_id: uuid(), centro_custo_id: uuid(), categoria_id: uuid(),
      descricao: 'Hospedagem', competencia: '2026-10', data_vencimento: '2026-10-15', valor: 850,
    }).expect(201)).body.data;
    const p = (await A.post(`/contas-pagar/${c.id}/pagamento`, { valor: 850, data_pagamento: '2026-10-14', forma_pagamento: 'transferencia' }).expect(200)).body.data;
    expect(p.status).toBe('paga');
    const ev = (await A.get('/eventos?tipo=conta_pagar.paga').expect(200)).body.data.items;
    expect(ev.some((e: any) => e.agregado_id === c.id)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Cobranças', () => {
  const cobranca = () => ({
    cliente_id: uuid(),
    competencia: '2026-10',
    descricao: 'Fatura outubro',
    data_vencimento: '2026-10-10',
    forma_pagamento: 'pix',
    itens: [
      { tipo: 'servico', descricao: 'Plano Pro', quantidade: 1, valor_unitario: 150 },
      { tipo: 'consumo', descricao: 'Usuários extras', quantidade: 3, valor_unitario: 10 },
      { tipo: 'extra', descricao: 'Suporte', quantidade: 1, valor_unitario: 19.9 },
    ],
  });

  it('rascunho → aprovação gera conta a receber, txid e Pix copia-e-cola válido', async () => {
    const c = (await A.post('/cobrancas', cobranca()).expect(201)).body.data;
    expect(c).toMatchObject({ status: 'rascunho', valor_total: 199.9, pix_txid: null });

    const ap = (await A.post(`/cobrancas/${c.id}/aprovar`).expect(200)).body.data;
    expect(ap.status).toBe('aprovada');
    expect(ap.pix_txid).toMatch(/^[0-9a-f]{32}$/);
    expect(crc16(ap.pix_copia_cola.slice(0, -4))).toBe(ap.pix_copia_cola.slice(-4));

    const conta = (await A.get(`/contas-receber/${ap.conta_receber_id}`).expect(200)).body.data;
    expect(conta).toMatchObject({ cobranca_id: c.id, valor: 199.9, pix_txid: ap.pix_txid, status: 'em_aberto' });

    await A.post(`/cobrancas/${c.id}/aprovar`).expect(409);
    await A.patch(`/cobrancas/${c.id}`, { descricao: 'x' }).expect(409);
  });

  it('QR Code: imagem PNG legível contendo exatamente o Pix copia-e-cola; SVG; erros', async () => {
    const rasc = (await A.post('/cobrancas', cobranca()).expect(201)).body.data;
    await A.get(`/cobrancas/${rasc.id}/qrcode`).expect(409);
    const ap = (await A.post(`/cobrancas/${rasc.id}/aprovar`).expect(200)).body.data;

    const png = await A.get(`/cobrancas/${rasc.id}/qrcode?tamanho=400`).buffer(true).parse(binario).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    const img = PNG.sync.read(png.body);
    expect(img.width).toBe(400);
    const lido = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    expect(lido?.data).toBe(ap.pix_copia_cola);

    const svg = await A.get(`/cobrancas/${rasc.id}/qrcode?formato=svg`).buffer(true).parse(binario).expect(200);
    expect(svg.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(svg.body.toString()).toContain('<svg');

    await A.get(`/cobrancas/${rasc.id}/qrcode?formato=gif`).expect(422);
    await B.get(`/cobrancas/${rasc.id}/qrcode`).expect(404);
    const boleto = (await A.post('/cobrancas', { ...cobranca(), forma_pagamento: 'boleto' })).body.data;
    await A.post(`/cobrancas/${boleto.id}/aprovar`).expect(200);
    await A.get(`/cobrancas/${boleto.id}/qrcode`).expect(422);
  });

  it('cancelamento cancela a conta vinculada; cobrança paga não cancela', async () => {
    const c = (await A.post('/cobrancas', cobranca()).expect(201)).body.data;
    const ap = (await A.post(`/cobrancas/${c.id}/aprovar`).expect(200)).body.data;
    const can = (await A.post(`/cobrancas/${c.id}/cancelar`, { motivo: 'Cliente desistiu' }).expect(200)).body.data;
    expect(can.status).toBe('cancelada');
    expect((await A.get(`/contas-receber/${ap.conta_receber_id}`)).body.data.status).toBe('cancelada');

    const c2 = (await A.post('/cobrancas', cobranca()).expect(201)).body.data;
    const ap2 = (await A.post(`/cobrancas/${c2.id}/aprovar`).expect(200)).body.data;
    await A.post(`/contas-receber/${ap2.conta_receber_id}/baixa`, { valor: 199.9, data_pagamento: '2026-10-09', forma_pagamento: 'pix' }).expect(200);
    expect((await A.get(`/cobrancas/${c2.id}`)).body.data.status).toBe('paga');
    await A.post(`/cobrancas/${c2.id}/cancelar`, { motivo: 'tarde demais' }).expect(409);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Recorrências — automação por agendamento', () => {
  const recorrencia = (over: object = {}) => ({
    cliente_id: uuid(),
    contrato_id: uuid(),
    descricao: 'Assinatura Pro',
    periodicidade: 'mensal',
    dia_vencimento: 10,
    dias_antecedencia: 10,
    data_inicio: '2026-10-01',
    forma_pagamento: 'pix',
    itens: [{ tipo: 'servico', descricao: 'Plano Pro', quantidade: 1, valor_unitario: 199.9 }],
    ...over,
  });

  it('gera a cobrança sozinha quando chega a data, sem duplicar e recuperando ciclos perdidos', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const r = (await C.post('/recorrencias', recorrencia()).expect(201)).body.data;
    expect(r).toMatchObject({ proxima_competencia: '2026-10', valor_ciclo: 199.9 });
    expect(r.proximo_ciclo).toEqual({ competencia: '2026-10', data_vencimento: '2026-10-10', data_geracao: '2026-09-30' });

    ctx.clock.fixar('2026-09-29');
    expect((await ctx.agendador.executar('recorrencias', T)).resultado).toMatchObject({ cobrancas_geradas: 0 });

    ctx.clock.fixar('2026-09-30');
    expect((await ctx.agendador.executar('recorrencias', T)).resultado).toMatchObject({ cobrancas_geradas: 1, cobrancas_aprovadas: 1 });

    // Rodar de novo no mesmo dia não duplica (idempotência).
    expect((await ctx.agendador.executar('recorrencias', T)).resultado).toMatchObject({ cobrancas_geradas: 0 });

    // Serviço ficou fora do ar de outubro a janeiro: ao voltar, emite nov, dez e jan de uma vez.
    ctx.clock.fixar('2027-01-05');
    expect((await ctx.agendador.executar('recorrencias', T)).resultado).toMatchObject({ cobrancas_geradas: 3 });

    const cobs = (await C.get(`/cobrancas?recorrencia_id=${r.id}`)).body.data.items.map((c: any) => c.competencia).sort();
    expect(cobs).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    const contas = (await C.get('/contas-receber?limit=100')).body.data.items;
    expect(contas).toHaveLength(4);
    expect(contas.every((c: any) => c.pix_txid && c.valor === 199.9)).toBe(true);

    const det = (await C.get(`/recorrencias/${r.id}`)).body.data;
    expect(det.execucoes).toHaveLength(4);
    expect(det.execucoes.every((e: any) => e.origem === 'agendador')).toBe(true);
    expect(det.proxima_competencia).toBe('2027-02');
  });

  it('execuções concorrentes (duas instâncias) não geram cobrança em dobro', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    for (let i = 0; i < 20; i++) await C.post('/recorrencias', recorrencia()).expect(201);
    ctx.clock.fixar('2026-09-30');
    const [r1, r2, r3] = await Promise.all([
      ctx.recorrencias.processarPendentes(T),
      ctx.recorrencias.processarPendentes(T),
      ctx.recorrencias.processarPendentes(T),
    ]);
    expect(r1.cobrancas_geradas + r2.cobrancas_geradas + r3.cobrancas_geradas).toBe(20);
    expect(await ctx.ds.getRepository(Cobranca).count({ where: { tenant_id: T } })).toBe(20);
  });

  it('respeita data_fim (encerra) e aprovação manual (fica em rascunho)', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const r = (await C.post('/recorrencias', recorrencia({ data_fim: '2026-11-30', aprovacao_automatica: false })).expect(201)).body.data;
    ctx.clock.fixar('2027-03-01');
    const res = (await ctx.agendador.executar('recorrencias', T)).resultado as any;
    expect(res).toMatchObject({ cobrancas_geradas: 2, cobrancas_aprovadas: 0, encerradas: 1 });
    expect((await C.get(`/recorrencias/${r.id}`)).body.data.ativa).toBe(false);
    const cobs = (await C.get('/cobrancas')).body.data.items;
    expect(cobs.every((c: any) => c.status === 'rascunho')).toBe(true);
  });

  it('pausar impede geração; previsão lista próximos ciclos; geração manual', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const r = (await C.post('/recorrencias', recorrencia({ periodicidade: 'trimestral', dia_vencimento: 31 })).expect(201)).body.data;
    const prev = (await C.get(`/recorrencias/${r.id}/previsao?ciclos=3`).expect(200)).body.data;
    expect(prev.map((p: any) => p.data_vencimento)).toEqual(['2026-10-31', '2027-01-31', '2027-04-30']);

    await C.post(`/recorrencias/${r.id}/pausar`).expect(200);
    ctx.clock.fixar('2026-12-01');
    expect(((await ctx.agendador.executar('recorrencias', T)).resultado as any).cobrancas_geradas).toBe(0);
    await C.post(`/recorrencias/${r.id}/gerar`).expect(409);
    await C.post(`/recorrencias/${r.id}/reativar`).expect(200);
    const g = (await C.post(`/recorrencias/${r.id}/gerar`).expect(201)).body.data;
    expect(g.competencia).toBe('2026-10');
  });
});

// ------------------------------------------------------------------------------------------------
describe('Inadimplência', () => {
  it('job marca vencidas, calcula encargos, aging e promessas', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const cli = uuid();
    ctx.clock.fixar('2026-08-01');
    const a = (await C.post('/contas-receber', novaConta({ cliente_id: cli, valor: 1000, data_vencimento: '2026-09-15', competencia: '2026-09' }))).body.data;
    const b = (await C.post('/contas-receber', novaConta({ valor: 500, data_vencimento: '2026-08-10', competencia: '2026-08' }))).body.data;
    await C.post('/contas-receber', novaConta({ valor: 300, data_vencimento: '2026-11-10', competencia: '2026-11' }));

    ctx.clock.fixar('2026-09-30');
    const job = (await ctx.agendador.executar('vencimentos', T)).resultado as any;
    expect(job.contas_receber_vencidas).toBe(2);
    expect((await C.get(`/contas-receber/${a.id}`)).body.data.status).toBe('vencida');

    const lista = (await C.get('/inadimplencia')).body.data.items;
    const la = lista.find((x: any) => x.conta_receber_id === a.id);
    expect(la).toMatchObject({ dias_atraso: 15, multa: 20, juros: 5, valor_atualizado: 1025, faixa_aging: '1_30' });
    const lb = lista.find((x: any) => x.conta_receber_id === b.id);
    expect(lb).toMatchObject({ dias_atraso: 51, faixa_aging: '31_60' });

    const resumo = (await C.get('/inadimplencia/resumo')).body.data;
    expect(resumo).toMatchObject({ total_em_aberto: 1800, total_vencido: 1500, clientes_inadimplentes: 2, taxa_inadimplencia_percentual: 83.33 });
    expect(resumo.aging.a_vencer).toEqual({ quantidade: 1, valor: 300 });

    const ev = (await C.get('/eventos?tipo=conta_receber.vencida')).body.data;
    expect(ev.meta.total).toBe(2);

    // Promessa: cumprida quando paga, quebrada quando a data passa sem pagamento.
    const pa = (await C.post('/inadimplencia/promessas', { conta_receber_id: a.id, data_prometida: '2026-10-05', valor: 1000 }).expect(201)).body.data;
    const pb = (await C.post('/inadimplencia/promessas', { conta_receber_id: b.id, data_prometida: '2026-10-05', valor: 500 }).expect(201)).body.data;
    await C.post('/inadimplencia/promessas', { conta_receber_id: b.id, data_prometida: '2026-09-01', valor: 1 }).expect(422);
    await C.post(`/contas-receber/${a.id}/baixa`, { valor: 1000, data_pagamento: '2026-10-03', forma_pagamento: 'pix' }).expect(200);
    ctx.clock.fixar('2026-10-06');
    expect(((await ctx.agendador.executar('promessas', T)).resultado as any).promessas_quebradas).toBe(1);
    const proms = (await C.get('/inadimplencia/promessas')).body.data.items;
    expect(proms.find((p: any) => p.id === pa.id).status).toBe('cumprida');
    expect(proms.find((p: any) => p.id === pb.id).status).toBe('quebrada');
  });
});

// ------------------------------------------------------------------------------------------------
describe('Webhook Pix — baixa automática sem operador', () => {
  it('assinatura inválida → 401; válida → conta e cobrança pagas; repetição é idempotente', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const cob = (await C.post('/cobrancas', {
      cliente_id: uuid(), competencia: '2026-10', descricao: 'Fatura', data_vencimento: '2026-10-10', forma_pagamento: 'pix',
      itens: [{ tipo: 'servico', descricao: 'Plano', quantidade: 1, valor_unitario: 89.9 }],
    })).body.data;
    const ap = (await C.post(`/cobrancas/${cob.id}/aprovar`)).body.data;

    const corpo = JSON.stringify({ pix: [{ endToEndId: 'E00000000202610091200abcdef12345', txid: ap.pix_txid, valor: '89.90', horario: '2026-10-09T15:00:00Z' }] });
    await ctx.http().post(`${BASE}/webhooks/pix`).set('content-type', 'application/json').set('x-pix-assinatura', 'sha256=00').send(corpo).expect(401);

    const ok = await ctx.http().post(`${BASE}/webhooks/pix`).set('content-type', 'application/json').set('x-pix-assinatura', assinarPix(corpo)).send(corpo).expect(200);
    expect(ok.body.data.resultados[0].resultado).toBe('baixado');

    const conta = (await C.get(`/contas-receber/${ap.conta_receber_id}`)).body.data;
    expect(conta).toMatchObject({ status: 'paga', valor_pago: 89.9, forma_pagamento: 'pix', data_pagamento: '2026-10-09' });
    expect((await C.get(`/cobrancas/${cob.id}`)).body.data.status).toBe('paga');

    // O mesmo Pix chega depois no extrato OFX: é vinculado ao título sem baixa em dobro.
    const ofx = `<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261009<TRNAMT>89.90<FITID>PX1<MEMO>PIX ${ap.pix_txid}</STMTTRN></OFX>`;
    const imp = (await C.post('/conciliacoes/importar', { conteudo: ofx }).expect(201)).body.data;
    expect(imp).toMatchObject({ conciliadas_automaticamente: 1, pendentes: 0 });
    const tr = (await C.get(`/conciliacoes/${imp.id}`)).body.data.transacoes[0];
    expect(tr).toMatchObject({ status: 'conciliada', criterio: 'txid_pix_ja_baixado', conta_receber_id: ap.conta_receber_id });
    expect((await C.get(`/contas-receber/${ap.conta_receber_id}`)).body.data.valor_pago).toBe(89.9);

    const de_novo = await ctx.http().post(`${BASE}/webhooks/pix`).set('content-type', 'application/json').set('x-pix-assinatura', assinarPix(corpo)).send(corpo).expect(200);
    expect(de_novo.body.data.resultados[0].resultado).toBe('duplicado');

    const tipos = (await C.get('/eventos?limit=100')).body.data.items.map((e: any) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(['cobranca.aprovada', 'conta_receber.paga', 'cobranca.paga']));
  });

  it('txid desconhecido não quebra o lote', async () => {
    const corpo = JSON.stringify({ pix: [{ endToEndId: 'E1', txid: 'naoexiste', valor: '1.00', horario: '2026-10-09T15:00:00Z' }] });
    const r = await ctx.http().post(`${BASE}/webhooks/pix`).set('content-type', 'application/json').set('x-pix-assinatura', assinarPix(corpo)).send(corpo).expect(200);
    expect(r.body.data.resultados[0].resultado).toBe('txid_desconhecido');
  });
});

// ------------------------------------------------------------------------------------------------
describe('Conciliação bancária OFX', () => {
  it('importa, concilia automaticamente o que é inequívoco e deixa ambíguos para revisão', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    ctx.clock.fixar('2026-10-01');

    // 1) cobrança Pix (txid no extrato)
    const cob = (await C.post('/cobrancas', {
      cliente_id: uuid(), competencia: '2026-10', descricao: 'Fatura', data_vencimento: '2026-10-10', forma_pagamento: 'pix',
      itens: [{ tipo: 'servico', descricao: 'Plano', quantidade: 1, valor_unitario: 250 }],
    })).body.data;
    const ap = (await C.post(`/cobrancas/${cob.id}/aprovar`)).body.data;
    // 2) valor único próximo do vencimento
    const unica = (await C.post('/contas-receber', novaConta({ valor: 437.15, data_vencimento: '2026-10-12' }))).body.data;
    // 3) duas contas idênticas (ambíguo)
    const amb1 = (await C.post('/contas-receber', novaConta({ valor: 99.9, data_vencimento: '2026-10-15' }))).body.data;
    const amb2 = (await C.post('/contas-receber', novaConta({ valor: 99.9, data_vencimento: '2026-10-15' }))).body.data;
    // 4) conta a pagar
    const pagar = (await C.post('/contas-pagar', {
      fornecedor_id: uuid(), centro_custo_id: uuid(), categoria_id: uuid(), descricao: 'Cloud',
      competencia: '2026-10', data_vencimento: '2026-10-20', valor: 1200,
    })).body.data;

    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
CHARSET:1252

<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><BANKID>0260<ACCTID>98765-4</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20261001<DTEND>20261031
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261009<TRNAMT>250.00<FITID>F1<MEMO>PIX REC ${ap.pix_txid}</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261011<TRNAMT>437,15<FITID>F2<MEMO>TED CLIENTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261015<TRNAMT>99.90<FITID>F3<MEMO>PIX RECEBIDO</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261016<TRNAMT>12.34<FITID>F4<MEMO>RENDIMENTO</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261020<TRNAMT>-1200.00<FITID>F5<MEMO>PAG FORNECEDOR</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

    const imp = (await ctx.http()
      .post(`${BASE}/conciliacoes/importar`)
      .set('Authorization', `Bearer ${token(T)}`)
      .attach('arquivo', Buffer.from(ofx, 'latin1'), 'extrato-outubro.ofx')
      .expect(201)).body.data;
    expect(imp).toMatchObject({ total_transacoes: 5, conciliadas_automaticamente: 3, pendentes: 2, ignoradas_duplicadas: 0, banco_id: '0260', taxa_automatica_percentual: 60 });

    expect((await C.get(`/contas-receber/${ap.conta_receber_id}`)).body.data.status).toBe('paga');
    expect((await C.get(`/cobrancas/${cob.id}`)).body.data.status).toBe('paga');
    expect((await C.get(`/contas-receber/${unica.id}`)).body.data).toMatchObject({ status: 'paga', data_pagamento: '2026-10-11' });
    expect((await C.get(`/contas-pagar/${pagar.id}`)).body.data.status).toBe('paga');
    expect((await C.get(`/contas-receber/${amb1.id}`)).body.data.status).toBe('em_aberto');

    const det = (await C.get(`/conciliacoes/${imp.id}`)).body.data;
    const crit = Object.fromEntries(det.transacoes.map((t: any) => [t.fitid, [t.status, t.criterio]]));
    expect(crit).toEqual({
      F1: ['conciliada', 'txid_pix'],
      F2: ['conciliada', 'valor_exato+data(1d)'],
      F3: ['pendente', null],
      F4: ['pendente', null],
      F5: ['conciliada', 'valor_exato+data(0d)'],
    });

    // Revisão humana do ambíguo com sugestões
    const f3 = det.transacoes.find((t: any) => t.fitid === 'F3');
    const sug = (await C.get(`/conciliacoes/${imp.id}/transacoes/${f3.id}/sugestoes`)).body.data;
    expect(sug.map((s: any) => s.id).sort()).toEqual([amb1.id, amb2.id].sort());
    await C.post(`/conciliacoes/${imp.id}/transacoes/${f3.id}/conciliar`, { conta_pagar_id: pagar.id }).expect(422);
    await C.post(`/conciliacoes/${imp.id}/transacoes/${f3.id}/conciliar`, { conta_receber_id: amb2.id }).expect(200);
    expect((await C.get(`/contas-receber/${amb2.id}`)).body.data.status).toBe('paga');
    const f4 = det.transacoes.find((t: any) => t.fitid === 'F4');
    await C.post(`/conciliacoes/${imp.id}/transacoes/${f4.id}/ignorar`).expect(200);
    expect((await C.get(`/conciliacoes/${imp.id}`)).body.data.pendentes).toBe(0);

    // Reimportar o mesmo extrato não duplica nada
    const re = (await ctx.http().post(`${BASE}/conciliacoes/importar`).set('Authorization', `Bearer ${token(T)}`)
      .attach('arquivo', Buffer.from(ofx, 'latin1'), 'extrato-outubro.ofx').expect(201)).body.data;
    expect(re).toMatchObject({ total_transacoes: 5, ignoradas_duplicadas: 5, conciliadas_automaticamente: 0 });
  });

  it('arquivo inválido → 422 e nada é gravado', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    const r = await C.post('/conciliacoes/importar', { nome_arquivo: 'x.csv', conteudo: 'data;valor\n2026-10-01;10' }).expect(422);
    expect(r.body.message).toMatch(/OFX inválido/);
    expect((await C.get('/conciliacoes')).body.data.meta.total).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe('Eventos M2M — entrega para outros módulos', () => {
  let srv: Server;
  let url: string;
  const recebidos: { headers: any; body: string }[] = [];
  let falhar = false;

  beforeAll(async () => {
    srv = createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        recebidos.push({ headers: req.headers, body: b });
        res.statusCode = falhar ? 500 : 204;
        res.end();
      });
    });
    await new Promise<void>((r) => srv.listen(0, r));
    url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/webhooks/financeiro`;
  });
  afterAll(() => new Promise((r) => srv.close(r)));

  it('assinante recebe o evento assinado (HMAC) e falhas entram em nova tentativa', async () => {
    const T = uuid();
    const C = cliente(ctx, T);
    await C.post('/eventos/assinaturas', { modulo: 'core', url: 'ftp://x', eventos: ['cobranca.paga'] }).expect(422);
    const ass = (await C.post('/eventos/assinaturas', { modulo: 'core', url, eventos: ['conta_receber.paga'] }).expect(201)).body.data;
    expect(ass.segredo).toHaveLength(48);
    expect((await C.get('/eventos/assinaturas')).body.data[0].segredo).toBeUndefined();

    // drena eventos de outros testes
    await ctx.eventos.despachar(1000);
    recebidos.length = 0;

    const c = (await C.post('/contas-receber', novaConta({ valor: 10 }))).body.data;
    await C.post(`/contas-receber/${c.id}/baixa`, { valor: 10, data_pagamento: '2026-10-01', forma_pagamento: 'dinheiro' }).expect(200);
    const r = await ctx.eventos.despachar();
    expect(r.entregues).toBe(1);
    expect(recebidos).toHaveLength(1);
    const { headers, body } = recebidos[0];
    expect(headers['x-financeiro-evento']).toBe('conta_receber.paga');
    expect(headers['x-financeiro-assinatura']).toBe('sha256=' + createHmac('sha256', ass.segredo).update(body).digest('hex'));
    expect(JSON.parse(body)).toMatchObject({ tipo: 'conta_receber.paga', tenant_id: T, conta_receber_id: c.id, valor_pago: 10, origem: 'manual' });

    // assinante fora do ar
    falhar = true;
    const c2 = (await C.post('/contas-receber', novaConta({ valor: 20 }))).body.data;
    await C.post(`/contas-receber/${c2.id}/baixa`, { valor: 20, data_pagamento: '2026-10-01', forma_pagamento: 'dinheiro' }).expect(200);
    const r2 = await ctx.eventos.despachar();
    expect(r2.falhas).toBe(1);
    const ev = await ctx.ds.getRepository(Evento).findOneBy({ agregado_id: c2.id, tipo: 'conta_receber.paga' });
    expect(ev).toMatchObject({ status: 'pendente', tentativas: 1 });
    expect(ev.ultimo_erro).toMatch(/HTTP 500/);
    falhar = false;
  });

  it('status da automação expõe últimas execuções', async () => {
    const s = (await A.get('/automacao/status').expect(200)).body.data;
    expect(s.jobs.recorrencias.ultima).not.toBeNull();
    await A.post('/automacao/executar/inexistente').expect(400);
    await cliente(ctx, TENANT_A, ['financeiro:escrita']).post('/automacao/executar/vencimentos').expect(403);
  });
});
