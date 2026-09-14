import { Controller, Get, Query } from '@nestjs/common';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import {
  ListCandidatesQueryDto,
  ListCandidatesResponseDto,
} from './dto/candidates.dto';

/**
 * Inspection endpoint for the memory-candidate evidence ledger.
 * Debug/observation surface — not a memory API and not cognition.
 */
@Controller('core/memory-candidates')
export class CandidatesController {
  constructor(private readonly candidates: MemoryCandidateRepository) {}

  @Get()
  async list(
    @Query() query: ListCandidatesQueryDto,
  ): Promise<ListCandidatesResponseDto> {
    const candidates = await this.candidates.listCandidates(query.sessionId, {
      limit: query.limit,
    });
    return { candidates };
  }
}
