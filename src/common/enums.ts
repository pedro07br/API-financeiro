export enum StatusContaReceber {
  EM_ABERTO = 'em_aberto',
  AGENDADA = 'agendada',
  PAGA = 'paga',
  VENCIDA = 'vencida',
  CANCELADA = 'cancelada',
  ESTORNADA = 'estornada',
  PARCIALMENTE_PAGA = 'parcialmente_paga',
}

export enum StatusContaPagar {
  EM_ABERTO = 'em_aberto',
  AGENDADA = 'agendada',
  PAGA = 'paga',
  VENCIDA = 'vencida',
  CANCELADA = 'cancelada',
  PARCIALMENTE_PAGA = 'parcialmente_paga',
}

export enum StatusCobranca {
  RASCUNHO = 'rascunho',
  APROVADA = 'aprovada',
  PAGA = 'paga',
  CANCELADA = 'cancelada',
}

export enum FormaPagamento {
  PIX = 'pix',
  BOLETO = 'boleto',
  CARTAO_CREDITO = 'cartao_credito',
  CARTAO_DEBITO = 'cartao_debito',
  TRANSFERENCIA = 'transferencia',
  DINHEIRO = 'dinheiro',
}

export enum Periodicidade {
  MENSAL = 'mensal',
  TRIMESTRAL = 'trimestral',
  SEMESTRAL = 'semestral',
  ANUAL = 'anual',
}

export const MESES_POR_PERIODICIDADE: Record<Periodicidade, number> = {
  [Periodicidade.MENSAL]: 1,
  [Periodicidade.TRIMESTRAL]: 3,
  [Periodicidade.SEMESTRAL]: 6,
  [Periodicidade.ANUAL]: 12,
};

/** Status em que uma conta a receber ainda tem saldo a ser recebido. */
export const STATUS_RECEBER_EM_ABERTO = [
  StatusContaReceber.EM_ABERTO,
  StatusContaReceber.AGENDADA,
  StatusContaReceber.VENCIDA,
  StatusContaReceber.PARCIALMENTE_PAGA,
];

export const STATUS_PAGAR_EM_ABERTO = [
  StatusContaPagar.EM_ABERTO,
  StatusContaPagar.AGENDADA,
  StatusContaPagar.VENCIDA,
  StatusContaPagar.PARCIALMENTE_PAGA,
];
