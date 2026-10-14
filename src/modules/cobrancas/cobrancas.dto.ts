import { ApiProperty, ApiPropertyOptional, PartialType, PickType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsDateString, IsEnum, IsIn, IsInt, IsNumber, Max, Min, IsOptional, IsPositive, IsString, IsUUID,
  Matches, MaxLength, MinLength, ValidateNested,
} from 'class-validator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';
import { FormaPagamento, StatusCobranca } from '../../common/enums';

export class ItemCobrancaDto {
  @ApiProperty({ enum: ['servico', 'consumo', 'extra'] }) @IsIn(['servico', 'consumo', 'extra']) tipo: 'servico' | 'consumo' | 'extra';
  @ApiPropertyOptional({ description: 'UUID do serviço no catálogo (outro módulo)' }) @IsOptional() @IsUUID() servico_id?: string;
  @ApiProperty({ example: 'Licença plano Pro' }) @IsString() @MaxLength(200) descricao: string;
  @ApiProperty({ example: 1 }) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() quantidade: number;
  @ApiProperty({ example: 199.9 }) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() valor_unitario: number;
}

export class CriarCobrancaDto {
  @ApiProperty() @IsUUID() cliente_id: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contrato_id?: string;
  @ApiProperty({ example: '2026-10' }) @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'competencia deve estar no formato AAAA-MM' }) competencia: string;
  @ApiProperty({ example: 'Fatura outubro/2026' }) @IsString() @MaxLength(200) descricao: string;
  @ApiProperty({ type: [ItemCobrancaDto] })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ItemCobrancaDto)
  itens: ItemCobrancaDto[];
  @ApiProperty({ example: '2026-10-10' }) @IsDateString({ strict: true }) data_vencimento: string;
  @ApiProperty({ enum: FormaPagamento, default: FormaPagamento.PIX }) @IsEnum(FormaPagamento) forma_pagamento: FormaPagamento;
}

export class AtualizarCobrancaDto extends PartialType(
  PickType(CriarCobrancaDto, ['descricao', 'itens', 'data_vencimento', 'forma_pagamento'] as const),
) {}

export class QrCodeDto {
  @ApiPropertyOptional({ enum: ['png', 'svg'], default: 'png' }) @IsOptional() @IsIn(['png', 'svg']) formato: 'png' | 'svg' = 'png';
  @ApiPropertyOptional({ default: 320, minimum: 128, maximum: 1024, description: 'Largura em pixels (PNG)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(128) @Max(1024) tamanho: number = 320;
}

export class CancelarCobrancaDto {
  @ApiProperty({ example: 'Cliente cancelou o contrato' }) @IsString() @MinLength(3) @MaxLength(300) motivo: string;
}

export class FiltroCobrancasDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: StatusCobranca }) @IsOptional() @IsEnum(StatusCobranca) status?: StatusCobranca;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cliente_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() contrato_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() recorrencia_id?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) competencia?: string;
}
