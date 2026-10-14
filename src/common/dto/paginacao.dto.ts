import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const LIMITE_MAXIMO = 100;

export class PaginacaoDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: LIMITE_MAXIMO })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_MAXIMO, { message: `limit deve ser no máximo ${LIMITE_MAXIMO}` })
  limit: number = 20;
}

export interface Paginado<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; total_pages: number };
}

export function paginar<T>(items: T[], total: number, p: PaginacaoDto): Paginado<T> {
  return { items, meta: { page: p.page, limit: p.limit, total, total_pages: Math.ceil(total / p.limit) } };
}
