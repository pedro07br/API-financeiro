import { centavos } from '../../common/money';

/** Saldo devedor em centavos: valor − desconto + juros + multa − já pago. */
export function saldoCentavos(c: { valor: number; desconto: number; juros: number; multa: number; valor_pago: number }) {
  return centavos(c.valor) - centavos(c.desconto) + centavos(c.juros) + centavos(c.multa) - centavos(c.valor_pago);
}
