# Módulo Financeiro — API v0.1

Implementação da API do módulo Financeiro do sistema integrado de gestão empresarial
(Projeto Integrador ADS — PUC Goiás), desenvolvida como parte prática do artigo
**"Automação de Pagamentos com Internet das Coisas"** (disciplina 2026.2-ADS1263/C01).

O módulo funciona como um nó autônomo da rede de serviços: tem identidade e endereço próprios
(`/api/financeiro`), valida identidade de forma descentralizada (JWT RS256) e troca dados com outros
módulos e com o banco **sem intervenção humana** — agendador de recorrências, webhook Pix, conciliação
OFX automática e eventos assinados para os demais módulos.

## Stack

NestJS 11 · TypeORM 0.3 · **PostgreSQL 13+ ou MySQL 8.0.16+** · Jest + Supertest · Swagger/OpenAPI

O banco é escolhido pela `DATABASE_URL` no `.env`:

| Banco | URL | Onde ficam as tabelas |
|---|---|---|
| PostgreSQL (padrão do Projeto Integrador) | `postgres://usuario:senha@localhost:5432/erp` | schema `financeiro` |
| MySQL | `mysql://usuario:senha@localhost:3306/financeiro` | database `financeiro` (criado sozinho) |

As diferenças de SQL entre os dois ficam todas em `src/common/dialeto.ts` e nas duas migrations
(`src/database/migrations/`); o restante do código é o mesmo.

## Como rodar

```bash
npm install
cp .env.example .env          # no Windows: copy .env.example .env  → depois ajuste a DATABASE_URL
npm run keys                  # DEV: gera par RSA simulando o módulo de Autenticação
npm run dev                   # cria o database/schema, aplica a migration e sobe em http://localhost:3008/api/financeiro
```

Sem banco instalado? `docker compose up -d mysql` ou `docker compose up -d postgres`.

- Documentação interativa: `http://localhost:3008/api/financeiro/docs`
- Token de desenvolvimento: `npm run token -- <tenant_uuid>` (use em `Authorization: Bearer …`)

## Scripts

| Comando | O que faz |
|---|---|
| `npm test` | 49 testes (19 unitários + 30 ponta a ponta) no banco do `.env`, com o sufixo `_test` no nome |
| `npm run test:cov` | Testes com relatório de cobertura |
| `npm run demo` | Demonstração narrada do fluxo M2M completo (para apresentação) |
| `npm run benchmark` | Mede recorrência, conciliação, webhook Pix e latência; grava `benchmark-resultados.json` |
| `npm run pix -- <chave> <valor> [nome] [cidade]` | Gera um QR Code Pix avulso (terminal + PNG) para testar com uma chave real, sem banco nem servidor |
| `npm run build` / `npm start` | Build de produção |

> `test`, `demo` e `benchmark` usam a `DATABASE_URL` do `.env` trocando o nome do banco por `<nome>_test`
> (ex.: `financeiro` → `financeiro_test`) e **apagam e recriam** esse banco de testes; o banco de trabalho não é tocado.
> Para usar outro banco nos testes, defina `TEST_DATABASE_URL`. Por segurança, no MySQL o script se recusa a apagar
> um database cujo nome não termine em `_test`.

## Rotas

Todas sob `/api/financeiro`, resposta padrão `{ success, data, message, errors }`.

| Grupo | Rotas |
|---|---|
| Health (público) | `GET /health` |
| Contas a receber | `GET/POST /contas-receber`, `GET/PATCH/DELETE /contas-receber/:id`, `POST /:id/baixa`, `POST /:id/estorno` |
| Contas a pagar | `GET/POST /contas-pagar`, `GET/PATCH/DELETE /contas-pagar/:id`, `POST /:id/pagamento` |
| Cobranças | `GET/POST /cobrancas`, `GET/PATCH /cobrancas/:id`, `POST /:id/aprovar`, `POST /:id/cancelar`, `GET /:id/qrcode` (imagem PNG/SVG do Pix) |
| Recorrências | `GET/POST /recorrencias`, `GET/PATCH/DELETE /recorrencias/:id`, `GET /:id/previsao`, `POST /:id/pausar`, `/reativar`, `/gerar` |
| Inadimplência | `GET /inadimplencia`, `GET /inadimplencia/resumo`, `GET/POST /inadimplencia/promessas` |
| Conciliação | `POST /conciliacoes/importar` (OFX), `GET /conciliacoes`, `GET /:id`, `GET /:id/transacoes/:tid/sugestoes`, `POST …/conciliar`, `POST …/ignorar` |
| Webhook Pix | `POST /webhooks/pix` (assinatura HMAC, sem JWT) |
| Eventos | `GET /eventos`, `GET/POST /eventos/assinaturas`, `DELETE /eventos/assinaturas/:id` |
| Automação | `GET /automacao/status`, `POST /automacao/executar/:job` |

## Regras técnicas do projeto atendidas

| Regra | Onde |
|---|---|
| id, tenant e auditoria em toda tabela; soft delete | `src/common/entities/base.entity.ts`, migrations |
| snake_case e migrations versionadas | `src/database/migrations/` |
| Sem FK/join entre schemas — só UUID | migration (FKs apenas internas ao schema `financeiro`) |
| Tenant vem só do token | `src/common/auth/jwt.guard.ts` + `forbidNonWhitelisted` (enviar `tenant_id` → 422) |
| Paginação máx. 100 | `src/common/dto/paginacao.dto.ts` |
| JWT RS256, token fora do localStorage | `jwt.guard.ts` (Bearer ou cookie httpOnly `financeiro_token`) |
| Códigos 200/201/204/400/401/403/404/409/422 | filtro global `excecao.filter.ts` + pipe `validacao.pipe.ts` |

## Automações

| Job | Quando | O que faz |
|---|---|---|
| `recorrencias` | diário 00:05 | Emite e aprova as cobranças cujo ciclo chegou (N dias antes do vencimento), gera Pix e conta a receber; recupera ciclos perdidos; idempotente (UNIQUE recorrência+competência, `SKIP LOCKED`) |
| `vencimentos` | diário 00:15 | Marca títulos vencidos e publica `conta_receber.vencida` |
| `promessas` | diário 00:20 | Marca promessas de pagamento quebradas |
| `eventos` | a cada 15 s | Entrega eventos do outbox aos assinantes (POST com HMAC-SHA256, nova tentativa com backoff exponencial, até 8 tentativas) |

## Estrutura

```
src/
  common/            auth (guard JWT), http (resposta/erros/validação), datas, dinheiro, relógio, dialeto SQL
  database/          data source e migrations (PostgreSQL e MySQL)
  modules/
    contas-receber/  contas-pagar/  cobrancas/  recorrencias/  inadimplencia/
    conciliacoes/    (parser OFX + motor de conciliação)
    pix/             (BR Code + webhook)
    eventos/         (outbox + assinaturas + despachante)
    automacao/       (agendador)
    health/
test/                unit.spec.ts, financeiro.e2e-spec.ts
scripts/             gerar-chaves, emitir-token, demo, benchmark
```

## Limitações conhecidas (v0.1)

- O Pix "copia e cola" é gerado localmente (padrão EMV/BR Code com txid). A emissão de QR dinâmico em um PSP real e o mTLS do webhook ficam para a integração com o banco escolhido.
- Encargos de atraso (multa 2% + juros 1% a.m.) são calculados na consulta e não gravados no título.
- O isolamento multi-tenant é feito na aplicação (filtro por `tenant_id` em toda consulta); Row-Level Security no Postgres é uma camada extra recomendada (não há equivalente nativo no MySQL).
- Os números de desempenho do artigo foram medidos no PostgreSQL.
- A importação do OFX ainda é por upload; buscar o extrato via Open Finance tornaria esse passo também automático.
