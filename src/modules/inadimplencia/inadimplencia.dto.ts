import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginacaoDto } from '../../common/dto/paginacao.dto';

export class FiltroInadimplenciaDto extends PaginacaoDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() cliente_id?: string;
  @ApiPropertyOptional({ description: 'Dias mínimos de atraso', example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) dias_min?: number;
}

export class CriarPromessaDto {
  @ApiProperty() @IsUUID() conta_receber_id: string;
  @ApiProperty({ example: '2026-10-20' }) @IsDateString({ strict: true }) data_prometida: string;
  @ApiProperty({ example: 199.9 }) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() valor: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) observacao?: string;
}

export class FiltroPromessasDto extends PaginacaoDto {
  @ApiPropertyOptional({ enum: ['pendente', 'cumprida', 'quebrada'] }) @IsOptional() @IsIn(['pendente', 'cumprida', 'quebrada']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conta_receber_id?: string;
}
