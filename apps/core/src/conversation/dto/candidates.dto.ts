import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { MemoryCandidate } from '../../memory/memory-candidate';

export class ListCandidatesQueryDto {
  @IsOptional()
  @IsUUID()
  sessionId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListCandidatesResponseDto {
  candidates!: MemoryCandidate[];
}
