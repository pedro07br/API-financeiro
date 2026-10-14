import { randomUUID } from 'crypto';

/**
 * Geração do "Pix Copia e Cola" (BR Code, padrão EMV-MPM do Manual de Padrões para Iniciação do Pix — BCB).
 * Nesta versão o payload é gerado localmente (QR estático com txid); a integração com a API Pix de um PSP
 * para QR dinâmico fica como trabalho futuro.
 */
const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, '0')}${valor}`;

export function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function gerarTxid(): string {
  return randomUUID().replace(/-/g, ''); // 32 caracteres alfanuméricos (limite do Pix: 26 a 35)
}

const ascii = (s: string, max: number) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 ]/g, '').toUpperCase().slice(0, max);

export function gerarBrCode(p: { chave: string; valor: number; txid: string; nome?: string; cidade?: string }): string {
  const conta = campo('00', 'br.gov.bcb.pix') + campo('01', p.chave);
  const semCrc =
    campo('00', '01') +
    campo('26', conta) +
    campo('52', '0000') +
    campo('53', '986') +
    campo('54', p.valor.toFixed(2)) +
    campo('58', 'BR') +
    campo('59', ascii(p.nome ?? 'EMPRESA', 25)) +
    campo('60', ascii(p.cidade ?? 'GOIANIA', 15)) +
    campo('62', campo('05', p.txid.slice(0, 25))) +
    '6304';
  return semCrc + crc16(semCrc);
}
