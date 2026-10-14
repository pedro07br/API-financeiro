/**
 * Gera um QR Code Pix (estático, com valor) para uma chave e valor quaisquer — útil para testar com a sua chave.
 * Não usa banco nem servidor.
 *
 * Uso:
 *   npm run pix -- <chave> <valor> [nome] [cidade]
 *
 * Exemplos:
 *   npm run pix -- meuemail@gmail.com 10,50
 *   npm run pix -- 123.456.789-09 25 "Pedro Santos" Goiania
 *   npm run pix -- +5562999998888 1
 *
 * Telefone deve vir com +55 e DDD (11 dígitos soltos são tratados como CPF).
 */
import '../src/config';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import * as QRCode from 'qrcode';
import { config } from '../src/config';
import { crc16, gerarBrCode } from '../src/modules/pix/brcode';

function normalizarChave(bruta: string): { chave: string; tipo: string } {
  const c = bruta.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { chave: c.toLowerCase(), tipo: 'e-mail' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(c)) return { chave: c.toLowerCase(), tipo: 'chave aleatória' };
  if (c.startsWith('+')) {
    const tel = '+' + c.replace(/\D/g, '');
    if (!/^\+55\d{10,11}$/.test(tel)) throw new Error('Telefone deve estar no formato +55 + DDD + número (ex.: +5562999998888)');
    return { chave: tel, tipo: 'telefone' };
  }
  const dig = c.replace(/\D/g, '');
  if (dig.length === 11 && /^[\d.\-\s]+$/.test(c)) return { chave: dig, tipo: 'CPF' };
  if (dig.length === 14 && /^[\d.\-/\s]+$/.test(c)) return { chave: dig, tipo: 'CNPJ' };
  throw new Error(`Não reconheci "${bruta}" como chave Pix (e-mail, CPF, CNPJ, +55telefone ou chave aleatória)`);
}

function normalizarValor(bruto: string): number {
  const v = Number(bruto.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Valor inválido: "${bruto}"`);
  if (Math.round(v * 100) !== v * 100 && Math.abs(Math.round(v * 100) - v * 100) > 1e-6) throw new Error('Use no máximo 2 casas decimais');
  if (v > 1_000_000) throw new Error('Valor alto demais para um teste');
  return Math.round(v * 100) / 100;
}

async function main() {
  const [chaveArg, valorArg, nomeArg, cidadeArg] = process.argv.slice(2);
  if (!chaveArg || !valorArg) {
    console.log('Uso: npm run pix -- <chave> <valor> [nome] [cidade]\nEx.: npm run pix -- meuemail@gmail.com 10,50');
    process.exit(1);
  }
  const { chave, tipo } = normalizarChave(chaveArg);
  const valor = normalizarValor(valorArg);
  const nome = nomeArg ?? config.pix.nomeRecebedor;
  const cidade = cidadeArg ?? config.pix.cidadeRecebedor;
  // txid curto e alfanumérico: aceito por todos os bancos em QR estático
  const txid = 'TESTE' + randomBytes(8).toString('hex').toUpperCase().slice(0, 15);

  const copiaCola = gerarBrCode({ chave, valor, txid, nome, cidade });
  if (crc16(copiaCola.slice(0, -4)) !== copiaCola.slice(-4)) throw new Error('Falha no CRC do código gerado');

  const arquivo = `pix-${valor.toFixed(2).replace('.', '_')}.png`;
  writeFileSync(arquivo, await QRCode.toBuffer(copiaCola, { width: 400, margin: 2, errorCorrectionLevel: 'M' }));

  console.log('');
  console.log(await QRCode.toString(copiaCola, { type: 'terminal', small: true, errorCorrectionLevel: 'M' }));
  console.log(`Chave (${tipo}): ${chave}`);
  console.log(`Valor:          ${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`);
  console.log(`Recebedor:      ${nome} — ${cidade}`);
  console.log(`Identificador:  ${txid}`);
  console.log(`\nPix copia e cola:\n${copiaCola}\n`);
  console.log(`Imagem salva em: ${arquivo}`);
  console.log('Atenção: o QR é real. Ao ler no app do banco, confira os dados; só confirme se quiser mesmo transferir.\n');
}

main().catch((e) => {
  console.error(`Erro: ${e.message}`);
  process.exit(1);
});
