import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  SessionSearchResult,
  SessionSummary,
} from '../../session/session.repository';

export class ListSessionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ListSessionsResponseDto {
  sessions!: SessionSummary[];
}

export class SearchSessionsQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  q!: string;

  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class SearchSessionsResponseDto {
  results!: SessionSearchResult[];
}
