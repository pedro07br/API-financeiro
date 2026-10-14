import { config } from '../../config';
import { reais } from '../../common/money';

/**
 * Encargos por atraso calculados dinamicamente (não persistidos): multa única + juros simples pro rata die.
 * Padrões: multa 2% (teto do CDC, art. 52 §1º) e juros de mora de 1% ao mês — configuráveis por ambiente.
 */
export function calcularEncargos(saldoCent: number, diasAtraso: number) {
  if (diasAtraso <= 0 || saldoCent <= 0) return { multa: 0, juros: 0, valor_atualizado: reais(saldoCent) };
  const multa = Math.round((saldoCent * config.encargos.multaPercentual) / 100);
  const juros = Math.round((saldoCent * (config.encargos.jurosMensalPercentual / 100) * diasAtraso) / 30);
  return { multa: reais(multa), juros: reais(juros), valor_atualizado: reais(saldoCent + multa + juros) };
}

export const FAIXAS_AGING = [
  { faixa: 'a_vencer', min: -Infinity, max: 0 },
  { faixa: '1_30', min: 1, max: 30 },
  { faixa: '31_60', min: 31, max: 60 },
  { faixa: '61_90', min: 61, max: 90 },
  { faixa: 'acima_90', min: 91, max: Infinity },
] as const;

export const faixaDe = (dias: number) => FAIXAS_AGING.find((f) => dias >= f.min && dias <= f.max)!.faixa;
