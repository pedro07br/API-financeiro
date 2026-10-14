/** Toda aritmética monetária é feita em centavos inteiros para evitar erro de ponto flutuante. */
export const centavos = (v: number | string | null | undefined): number => Math.round(Number(v ?? 0) * 100);
export const reais = (c: number): number => Math.round(c) / 100;

/** Transformer TypeORM: NUMERIC do Postgres chega como string; expomos como number. */
export const numericTransformer = {
  to: (v: number | null | undefined) => v,
  from: (v: string | null) => (v === null || v === undefined ? null : Number(v)),
};
