import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
  ValidateNested,
} from 'class-validator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { FormaPagamento, Periodicidade } from '../../common/enums';
import { ItemCobrancaDto } from '../cobrancas/cobrancas.dto';

export class CriarRecorrenciaDto {
  @ApiProperty() @IsUUID() cliente_id: string;
  @ApiProperty() @IsUUID() contrato_id: string;
  @ApiProperty({ example: 'Assinatura plano Pro' }) @IsString() @MaxLength(200) descricao: string;
  @ApiProperty({ enum: Periodicidade, default: Periodicidade.MENSAL }) @IsEnum(Periodicidade) periodicidade: Periodicidade;
  @ApiProperty({ example: 10, minimum: 1, maximum: 31 }) @IsInt() @Min(1) @Max(31) dia_vencimento: number;
  @ApiPropertyOptional({ example: 10, description: 'Quantos dias antes do vencimento a cobrança é gerada' })
  @IsOptional() @IsInt() @Min(0) @Max(60) dias_antecedencia?: number;
  @ApiProperty({ example: '2026-10-01' }) @IsDateString({ strict: true }) data_inicio: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString({ strict: true }) data_fim?: string;
  @ApiProperty({ enum: FormaPagamento }) @IsEnum(FormaPagamento) forma_pagamento: FormaPagamento;
  @ApiPropertyOptional({ default: true, description: 'Se verdadeiro, a cobrança gerada já é aprovada/emitida sem intervenção humana' })
  @IsOptional() @IsBoolean() aprovacao_automatica?: boolean;
  @ApiProperty({ type: [ItemCobrancaDto], description: 'Serviços, consumo e itens extras do contrato' })
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ItemCobrancaDto)
  itens: ItemCobrancaDto[];
}

export class AtualizarRecorrenciaDto extends PartialType(
  PickType(CriarRecorrenciaDto, ['descricao', 'dia_vencimento', 'dias_antecedencia', 'data_fim', 'forma_pagamento', 'aprovacao_automatica', 'itens'] as const),
) {}

export class FiltroRecorrenciasDto extends PaginacaoDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cliente_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contrato_id?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() ativa?: boolean;
}

export class PrevisaoDto {
  @ApiPropertyOptional({ default: 6, maximum: 24 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24) ciclos: number = 6;
}
