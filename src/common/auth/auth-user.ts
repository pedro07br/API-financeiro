export type TipoPrincipal = 'usuario' | 'servico';

/** Identidade extraída do JWT. O tenant vem SEMPRE daqui, nunca do corpo/query da requisição. */
export interface AuthUser {
  sub: string;
  tenant_id: string;
  permissoes: string[];
  tipo: TipoPrincipal;
  nome?: string;
}

export const Permissao = {
  LEITURA: 'financeiro:leitura',
  ESCRITA: 'financeiro:escrita',
  ADMIN: 'financeiro:admin',
} as const;
