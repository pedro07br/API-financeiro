import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { FormaPagamento, StatusContaReceber } from '../../common/enums';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const DINHEIRO = { maxDecimalPlaces: 2 };

export class CriarContaReceberDto {
  @ApiProperty({ description: 'UUID do cliente (módulo Core/CRM)' }) @IsUUID() cliente_id: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contrato_id?: string;
  @ApiProperty({ example: 'Mensalidade plano Pro' }) @IsString() @MaxLength(200) descricao: string;
  @ApiProperty({ example: '2026-10' }) @Matches(COMPETENCIA, { message: 'competencia deve estar no formato AAAA-MM' }) competencia: string;
  @ApiProperty({ example: '2026-10-10' }) @IsDateString({ strict: true }) data_vencimento: string;
  @ApiProperty({ example: 199.9 }) @IsNumber(DINHEIRO) @IsPositive() valor: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsNumber(DINHEIRO) @Min(0) desconto?: number;
  @ApiPropertyOptional({ enum: FormaPagamento }) @IsOptional() @IsEnum(FormaPagamento) forma_pagamento?: FormaPagamento;
}

export class AtualizarContaReceberDto extends PartialType(
  PickType(CriarContaReceberDto, ['descricao', 'data_vencimento', 'valor', 'desconto', 'forma_pagamento'] as const),
) {
  @ApiPropertyOptional({ enum: [StatusContaReceber.EM_ABERTO, StatusContaReceber.AGENDADA, StatusContaReceber.CANCELADA] })
  @IsOptional()
  @IsIn([StatusContaReceber.EM_ABERTO, StatusContaReceber.AGENDADA, StatusContaReceber.CANCELADA])
  status?: StatusContaReceber;
}

export class BaixaDto {
  @ApiProperty({ example: 199.9 }) @IsNumber(DINHEIRO) @IsPositive() valor: number;
  @ApiProperty({ example: '2026-10-09' }) @IsDateString({ strict: true }) data_pagamento: string;
  @ApiProperty({ enum: FormaPagamento }) @IsEnum(FormaPagamento) forma_pagamento: FormaPagamento;
}

export class FiltroContasReceberDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: StatusContaReceber }) @IsOptional() @IsEnum(StatusContaReceber) status?: StatusContaReceber;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cliente_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contrato_id?: string;
  @ApiPropertyOptional({ example: '2026-10' }) @IsOptional() @Matches(COMPETENCIA) competencia?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) vencimento_de?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) vencimento_ate?: string;
}
