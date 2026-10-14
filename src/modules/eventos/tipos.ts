export const TipoEvento = {
  COBRANCA_APROVADA: 'cobranca.aprovada',
  COBRANCA_CANCELADA: 'cobranca.cancelada',
  COBRANCA_PAGA: 'cobranca.paga',
  CONTA_RECEBER_PAGA: 'conta_receber.paga',
  CONTA_RECEBER_VENCIDA: 'conta_receber.vencida',
  CONTA_PAGAR_PAGA: 'conta_pagar.paga',
  RECORRENCIA_COBRANCA_GERADA: 'recorrencia.cobranca_gerada',
  CONCILIACAO_CONCLUIDA: 'conciliacao.concluida',
  PROMESSA_QUEBRADA: 'promessa_pagamento.quebrada',
} as const;

export const TODOS_EVENTOS = Object.values(TipoEvento) as string[];
