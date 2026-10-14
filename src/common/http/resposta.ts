import { SetMetadata } from '@nestjs/common';

/** Formato padrão de resposta de todos os módulos: { success, data, message, errors }. */
export interface RespostaPadrao<T = unknown> {
  success: boolean;
  data: T | null;
  message: string | null;
  errors: { campo?: string; mensagem: string }[] | null;
}

export const MENSAGEM = 'mensagem_resposta';
export const Mensagem = (m: string) => SetMetadata(MENSAGEM, m);
