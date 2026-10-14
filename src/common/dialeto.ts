import { ColumnType } from 'typeorm';
import { config } from '../config';

/**
 * Diferenças entre PostgreSQL e MySQL concentradas em um único lugar.
 * O resto do código usa o TypeORM de forma neutra; só estes trechos mudam conforme o banco.
 */
const mysql = () => config.banco === 'mysql';

/** Tipos de coluna (lidos na carga das entidades). */
export const TIPO = {
  get dataHora(): ColumnType {
    return mysql() ? 'datetime' : 'timestamptz';
  },
  get json(): ColumnType {
    return mysql() ? 'json' : 'jsonb';
  },
  /** Lista de textos: text[] no Postgres, JSON no MySQL. */
  get lista(): { type: ColumnType; array?: boolean } {
    return mysql() ? { type: 'json' } : { type: 'text', array: true };
  },
  /** Precisão em microssegundos no MySQL (o Postgres já tem por padrão). */
  get precisao(): number | undefined {
    return mysql() ? 6 : undefined;
  },
};

export const sql = {
  /** :param contém o valor da coluna (sem diferenciar maiúsculas). */
  textoContemColuna(param: string, coluna: string) {
    return mysql()
      ? `LOWER(:${param}) LIKE CONCAT('%', LOWER(${coluna}), '%')`
      : `:${param} ILIKE '%' || ${coluna} || '%'`;
  },

  /** Coluna de lista (text[] no Postgres, JSON no MySQL) contém o valor de :param. */
  listaContem(coluna: string, param: string) {
    return mysql() ? `JSON_CONTAINS(${coluna}, JSON_QUOTE(:${param}))` : `:${param} = ANY(${coluna})`;
  },

  /** Data do 1º dia da competência ('AAAA-MM') menos N dias (coluna). */
  inicioCompetenciaMenosDias(colCompetencia: string, colDias: string) {
    return mysql()
      ? `DATE_SUB(STR_TO_DATE(CONCAT(${colCompetencia}, '-01'), '%Y-%m-%d'), INTERVAL ${colDias} DAY)`
      : `(to_date(${colCompetencia}, 'YYYY-MM') - ${colDias})`;
  },
};
