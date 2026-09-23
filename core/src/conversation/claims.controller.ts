import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { Claim } from '../memory/claim';
import {
  ClaimIndex,
  ClaimIndexUnavailableError,
  type SimilarClaim,
} from '../memory/claim-index';
import { ClaimRepository } from '../memory/claim.repository';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { PromotionJournalRepository } from '../memory/promotion-journal.repository';
import {
  ClaimDetailResponseDto,
  ListClaimsQueryDto,
  ListClaimsResponseDto,
  SearchClaimsQueryDto,
  SearchClaimsResponseDto,
} from './dto/claims.dto';

/**
 * Inspection API for the belief store. Read-only in every direction:
 * claims are born through promotion (M10c) and age through dynamics
 * (M12) — nothing here mutates. Debug/observation surface.
 */
@Controller('core/claims')
export class ClaimsController {
  constructor(
    private readonly claims: ClaimRepository,
    private readonly candidates: MemoryCandidateRepository,
    private readonly journal: PromotionJournalRepository,
    private readonly index: ClaimIndex,
  ) {}

  @Get()
  async list(
    @Query() query: ListClaimsQueryDto,
  ): Promise<ListClaimsResponseDto> {
    return {
      claims: await this.claims.listClaims({
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.category !== undefined ? { category: query.category } : {}),
        ...(query.origin !== undefined ? { origin: query.origin } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
      }),
    };
  }

  // Registered before ':id' — otherwise 'search' parses as a claim id.
  @Get('search')
  async search(
    @Query() query: SearchClaimsQueryDto,
  ): Promise<SearchClaimsResponseDto> {
    let hits: SimilarClaim[];
    try {
      hits = await this.index.searchSimilar(query.q, query.k ?? 5);
    } catch (err) {
      if (err instanceof ClaimIndexUnavailableError) {
        return { results: [], degraded: true, reason: err.message };
      }
      throw err;
    }
    const results: (Claim & { score: number })[] = [];
    for (const hit of hits) {
      const claim = await this.claims.getClaim(hit.claimId);
      if (claim) results.push({ ...claim, score: hit.score });
    }
    return { results, degraded: false };
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ClaimDetailResponseDto> {
    const claim = await this.claims.getClaim(id);
    if (!claim) throw new NotFoundException(`Unknown claim "${id}"`);
    const evidence: (MemoryCandidate | null)[] = [];
    for (const item of claim.evidence) {
      evidence.push(await this.candidates.getCandidate(item.candidateId));
    }
    return {
      claim,
      evidence,
      history: await this.journal.listByClaimId(id),
    };
  }
}
