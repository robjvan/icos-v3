import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Claim } from '../../memory/claim';
import type { MemoryCandidate } from '../../memory/memory-candidate';
import type { PromotionJournalEntry } from '../../memory/promotion';

export class ListClaimsQueryDto {
  @IsOptional()
  @IsIn(['candidate', 'active', 'contradicted', 'retired'])
  status?: 'candidate' | 'active' | 'contradicted' | 'retired';

  @IsOptional()
  @IsIn(['fact', 'preference', 'relationship', 'procedure'])
  category?: 'fact' | 'preference' | 'relationship' | 'procedure';

  @IsOptional()
  @IsIn(['user', 'agent'])
  origin?: 'user' | 'agent';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class ListClaimsResponseDto {
  claims!: Claim[];
}

export class ClaimDetailResponseDto {
  claim!: Claim;
  /** Resolved evidence rows; null only if the ledger lost a row. */
  evidence!: (MemoryCandidate | null)[];
  /** Journal rows that built or touched this claim, oldest first. */
  history!: PromotionJournalEntry[];
}

export class SearchClaimsQueryDto {
  @IsString()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  k?: number;
}

export class SearchClaimsResponseDto {
  results!: (Claim & { score: number })[];
  degraded!: boolean;
  reason?: string;
}
