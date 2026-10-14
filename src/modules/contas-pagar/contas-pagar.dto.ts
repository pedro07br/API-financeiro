import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsIn, IsNumber, IsOptional, IsPositive, IsString, IsUUID, Matches, MaxLength, Min } from 'class-validator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { FormaPagamento, StatusContaPagar } from '../../common/enums';

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const DINHEIRO = { maxDecimalPlaces: 2 };

export class CriarContaPagarDto {
  @ApiProperty() @IsUUID() fornecedor_id: string;
  @ApiProperty() @IsUUID() centro_custo_id: string;
  @ApiProperty() @IsUUID() categoria_id: string;
  @ApiProperty({ example: 'Hospedagem cloud' }) @IsString() @MaxLength(200) descricao: string;
  @ApiPropertyOptional({ example: 'NF 1234' }) @IsOptional() @IsString() @MaxLength(60) documento?: string;
  @ApiProperty({ example: '2026-10' }) @Matches(COMPETENCIA, { message: 'competencia deve estar no formato AAAA-MM' }) competencia: string;
  @ApiProperty({ example: '2026-10-15' }) @IsDateString({ strict: true }) data_vencimento: string;
  @ApiProperty({ example: 850 }) @IsNumber(DINHEIRO) @IsPositive() valor: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber(DINHEIRO) @Min(0) desconto?: number;
  @ApiPropertyOptional({ enum: FormaPagamento }) @IsOptional() @IsEnum(FormaPagamento) forma_pagamento?: FormaPagamento;
}

export class AtualizarContaPagarDto extends PartialType(
  PickType(CriarContaPagarDto, ['descricao', 'documento', 'data_vencimento', 'valor', 'desconto', 'forma_pagamento', 'centro_custo_id', 'categoria_id'] as const),
) {
  @ApiPropertyOptional({ enum: [StatusContaPagar.EM_ABERTO, StatusContaPagar.AGENDADA, StatusContaPagar.CANCELADA] })
  @IsOptional()
  @IsIn([StatusContaPagar.EM_ABERTO, StatusContaPagar.AGENDADA, StatusContaPagar.CANCELADA])
  status?: StatusContaPagar;
}

export class PagamentoDto {
  @ApiProperty() @IsNumber(DINHEIRO) @IsPositive() valor: number;
  @ApiProperty() @IsDateString({ strict: true }) data_pagamento: string;
  @ApiProperty({ enum: FormaPagamento }) @IsEnum(FormaPagamento) forma_pagamento: FormaPagamento;
}

export class FiltroContasPagarDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: StatusContaPagar }) @IsOptional() @IsEnum(StatusContaPagar) status?: StatusContaPagar;
  @ApiPropertyOptional() @IsOptional() @IsUUID() fornecedor_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() centro_custo_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoria_id?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(COMPETENCIA) competencia?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) vencimento_de?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) vencimento_ate?: string;
}
