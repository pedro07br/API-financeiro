/** Utilitários de data trabalhando com strings ISO 'YYYY-MM-DD' (coluna DATE do Postgres). */
const utc = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(a, m - 1, d);
};

export function addMeses(dataIso: string, meses: number, diaPreferido?: number): string {
  const [a, m, d] = dataIso.split('-').map(Number);
  const totalMes = m - 1 + meses;
  const ano = a + Math.floor(totalMes / 12);
  const mes = ((totalMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(diaPreferido ?? d, ultimoDia);
  return `${ano}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function addDias(dataIso: string, dias: number): string {
  return new Date(utc(dataIso) + dias * 86_400_000).toISOString().slice(0, 10);
}

/** Número de dias de `de` até `ate` (positivo se `ate` é posterior). */
export function diffDias(deIso: string, ateIso: string): number {
  return Math.round((utc(ateIso) - utc(deIso)) / 86_400_000);
}

export const competenciaDe = (dataIso: string) => dataIso.slice(0, 7);

export function comDia(competencia: string, dia: number): string {
  const [a, m] = competencia.split('-').map(Number);
  const ultimoDia = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return `${competencia}-${String(Math.min(dia, ultimoDia)).padStart(2, '0')}`;
}
