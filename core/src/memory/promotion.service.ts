import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApprovalService } from '../approvals/approval.service';
import { ApprovalRepository } from '../approvals/approval.repository';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { MemoryCandidate } from './memory-candidate';
import { categoryFromKind } from './claim';
import type { Claim } from './claim';
import { ClaimIndex } from './claim-index';
import { ClaimRepository } from './claim.repository';
import { MemoryCandidateRepository } from './memory-candidate.repository';
import type {
  JournalState,
  PromotionJournalEntry,
  PromotionOperation,
  SweepSummary,
} from './promotion';
import { EMPTY_SWEEP } from './promotion';
import { PromotionJournalRepository } from './promotion-journal.repository';

/**
 * Confidence rules (fixed, documented — auto-tuning is out of M10).
 * NEW/CONTRADICT adopt the observation; HITL approval is the trust
 * gate, not a discount. REINFORCE bumps boundedly; M12 owns the
 * compounding rule.
 */
const REINFORCE_STEP = 0.05;
const CONFIDENCE_CAP = 0.99;

/** Approval action for candidate → belief promotion. */
export const PROMOTE_ACTION = 'memory.promote';

export type EntryOutcome =
  'new' | 'reinforced' | 'contradicted' | 'denied' | 'failed' | 'skipped';

function describe(
  candidate: MemoryCandidate,
  intent: PromotionOperation,
): string {
  return (
    `[${intent}] Promote to belief: ${candidate.subject} ${candidate.predicate} ` +
    `"${candidate.object}" (origin ${candidate.source.role}, ` +
    `confidence ${candidate.confidence}, candidate ${candidate.id.slice(0, 8)})`
  );
}

/**
 * Flat entity inheritance: the subject plus any prefixed
 * (`person:Ada`-style) tokens in subject/object. No inference —
 * whatever the extractor didn't name doesn't exist here.
 */
function extractEntities(candidate: MemoryCandidate): string[] {
  const entities = new Set<string>([candidate.subject]);
  for (const text of [candidate.subject, candidate.object]) {
    for (const token of text.split(/\s+/)) {
      if (/^[A-Za-z][A-Za-z0-9_-]*:.+/.test(token)) entities.add(token);
    }
  }
  return [...entities];
}

/**
 * Promotion pipeline: candidates → beliefs with hybrid authority.
 * Proposals are fire-and-forget (chained off extraction); execution
 * is explicit (sweep endpoint) following the approvals pull pattern —
 * no hooks, no pushes. Execution always re-derives against current
 * claims, so concurrent or repeated promotions converge instead of
 * duplicating.
 */
@Injectable()
export class PromotionService implements OnModuleInit {
  private readonly logger = new Logger(PromotionService.name);

  constructor(
    @Inject(CORE_CONFIG) private readonly config: CoreConfig,
    private readonly candidates: MemoryCandidateRepository,
    private readonly claims: ClaimRepository,
    private readonly journal: PromotionJournalRepository,
    private readonly approvalService: ApprovalService,
    private readonly approvals: ApprovalRepository,
    private readonly index: ClaimIndex,
  ) {}

  /** Crash recovery: rows stranded mid-execution replay on next sweep. */
  async onModuleInit(): Promise<void> {
    const stranded = await this.journal.listByState(['promoting']);
    for (const row of stranded) {
      await this.journal.setState(row.id, 'proposed', {
        detail: 'recovery replay after restart',
      });
    }
    if (stranded.length > 0) {
      this.logger.log(`Requeued ${stranded.length} interrupted promotions`);
    }
  }

  /**
   * Propose freshly saved candidates. Never throws — a proposal
   * failure is logged and the candidate simply stays unpromoted.
   */
  async proposeCandidates(
    saved: MemoryCandidate[],
  ): Promise<PromotionJournalEntry[]> {
    const entries: PromotionJournalEntry[] = [];
    for (const candidate of saved) {
      try {
        entries.push(await this.proposeOne(candidate));
      } catch (err) {
        this.logger.warn(
          `Promotion proposal failed for candidate ${candidate.id}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
      }
    }
    return entries;
  }

  private async proposeOne(
    candidate: MemoryCandidate,
  ): Promise<PromotionJournalEntry> {
    const existing = await this.journal.getByCandidate(candidate.id);
    if (existing) return existing;
    const intent = await this.deriveIntent(candidate);
    if (this.autoEligible(candidate, intent)) {
      const entry = await this.journal.recordProposal({
        candidateId: candidate.id,
        operation: intent,
        detail: 'automatic (config-admitted)',
      });
      await this.executeEntry(entry.id);
      return (await this.journal.getEntry(entry.id)) ?? entry;
    }
    const approval = await this.approvalService.create({
      sessionId: candidate.source.sessionId,
      action: PROMOTE_ACTION,
      description: describe(candidate, intent),
    });
    return this.journal.recordProposal({
      candidateId: candidate.id,
      operation: intent,
      approvalId: approval.id,
      detail: intent === 'NEW' ? '' : `intent:${intent}`,
    });
  }

  /**
   * Automatic path: NEW claims of config-admitted kinds with known
   * origin, opted in explicitly. Everything else — REINFORCE,
   * CONTRADICT, unknown origin, unlisted kinds — requires approval.
   */
  private autoEligible(
    candidate: MemoryCandidate,
    intent: PromotionOperation,
  ): boolean {
    return (
      this.config.memoryPromotionAuto &&
      intent === 'NEW' &&
      candidate.source.role !== 'unknown' &&
      this.config.memoryPromotionAutoKinds.includes(candidate.kind)
    );
  }

  /** Proposal-time intent; execution re-derives before applying. */
  private async deriveIntent(
    candidate: MemoryCandidate,
  ): Promise<PromotionOperation> {
    const exact = await this.claims.findByTriple(candidate);
    if (exact) return 'REINFORCE';
    const conflicts = await this.contestable(candidate);
    return conflicts.length > 0 ? 'CONTRADICT' : 'NEW';
  }

  private async contestable(candidate: MemoryCandidate): Promise<Claim[]> {
    const found = await this.claims.findBySubjectPredicate(
      candidate.subject,
      candidate.predicate,
    );
    return found.filter(
      (claim) => claim.status === 'candidate' || claim.status === 'active',
    );
  }

  /** Execute one journal row. Idempotent; safe to call repeatedly. */
  async executeEntry(id: string): Promise<{
    entry: PromotionJournalEntry | null;
    outcome: EntryOutcome;
  }> {
    const row = await this.journal.getEntry(id);
    if (
      !row ||
      row.state === 'committed' ||
      row.state === 'denied' ||
      row.state === 'failed'
    ) {
      return { entry: row, outcome: 'skipped' };
    }
    const candidate = await this.candidates.getCandidate(row.candidateId);
    if (!candidate) {
      return {
        entry: await this.mark(row, 'failed', 'missing_candidate'),
        outcome: 'failed',
      };
    }
    if (row.approvalId) {
      const approval = await this.approvals.getApproval(row.approvalId);
      if (!approval) {
        return {
          entry: await this.mark(row, 'failed', 'missing_approval'),
          outcome: 'failed',
        };
      }
      if (approval.status === 'pending')
        return { entry: row, outcome: 'skipped' };
      if (approval.status !== 'approved') {
        return {
          entry: await this.mark(row, 'denied', `approval:${approval.status}`),
          outcome: 'denied',
        };
      }
    }
    if (candidate.source.role === 'unknown') {
      // Origin is never defaulted. Legacy rows wait for an explicit
      // attribution rule (future slice), visibly parked — not silent.
      return {
        entry: await this.mark(row, 'failed', 'unknown_origin'),
        outcome: 'failed',
      };
    }
    const claimed = await this.journal.setState(row.id, 'promoting');
    if (!claimed) return { entry: row, outcome: 'skipped' };
    try {
      const { operation, claim, note } = await this.apply(candidate, row);
      const committed = await this.journal.setState(row.id, 'committed', {
        operation,
        claimId: claim.id,
        ...(note ? { detail: note } : {}),
      });
      // Indexing is best-effort recall acceleration: it never fails a
      // commit, and REINFORCE needs no re-index (claim text immutable).
      if (operation !== 'REINFORCE') {
        try {
          await this.index.indexClaim(claim);
        } catch (err) {
          this.logger.warn(
            `Claim index write failed for ${claim.id}: ${
              err instanceof Error ? err.message : 'unknown error'
            }`,
          );
        }
      }
      const outcome: EntryOutcome =
        operation === 'NEW'
          ? 'new'
          : operation === 'REINFORCE'
            ? 'reinforced'
            : 'contradicted';
      return { entry: committed, outcome };
    } catch (err) {
      return {
        entry: await this.mark(
          row,
          'failed',
          `error:${err instanceof Error ? err.message : 'unknown'}`,
        ),
        outcome: 'failed',
      };
    }
  }

  private async mark(
    row: PromotionJournalEntry,
    state: Extract<JournalState, 'failed' | 'denied'>,
    detail: string,
  ): Promise<PromotionJournalEntry | null> {
    return this.journal.setState(row.id, state, { detail });
  }

  /**
   * Re-derive against current claims and apply. The journal intent is
   * advisory — state may have moved since proposal, so a stale NEW
   * converges to REINFORCE rather than duplicating.
   */
  private async apply(
    candidate: MemoryCandidate,
    row: PromotionJournalEntry,
  ): Promise<{
    operation: PromotionOperation;
    claim: Claim;
    note?: string;
  }> {
    const role = candidate.source.role;
    if (role === 'unknown') throw new Error('unknown_origin');
    const evidence = [{ candidateId: candidate.id, role }] as const;
    const promotion = row.approvalId ? `approved:${row.approvalId}` : 'auto';

    const exact = await this.claims.findByTriple(candidate);
    if (exact) {
      const confidence = Math.min(
        CONFIDENCE_CAP,
        exact.confidence + REINFORCE_STEP,
      );
      const updated = await this.claims.appendEvidence(
        exact.id,
        [...evidence],
        confidence,
      );
      if (!updated) throw new Error('claim_vanished');
      if (updated.status === 'candidate') {
        await this.claims.setStatus(updated.id, 'active');
      }
      return {
        operation: 'REINFORCE',
        claim: updated,
        ...(row.operation !== 'REINFORCE'
          ? { note: `rederived:${row.operation}->REINFORCE` }
          : {}),
      };
    }

    const conflicts = await this.contestable(candidate);
    const contradicted = conflicts[0];
    if (contradicted) {
      if (contradicted.status === 'candidate') {
        // Never-active claim in the way: retire, don't contradict.
        await this.claims.setStatus(contradicted.id, 'retired');
      } else {
        await this.claims.setStatus(contradicted.id, 'contradicted');
      }
      const created = await this.createActive(candidate, promotion, role);
      return {
        operation: 'CONTRADICT',
        claim: created,
        note: `contradicts:${contradicted.id}`,
      };
    }

    const created = await this.createActive(candidate, promotion, role);
    return {
      operation: 'NEW',
      claim: created,
      ...(row.operation !== 'NEW'
        ? { note: `rederived:${row.operation}->NEW` }
        : {}),
    };
  }

  private async createActive(
    candidate: MemoryCandidate,
    promotion: string,
    role: 'user' | 'assistant',
  ): Promise<Claim> {
    const created = await this.claims.createClaim({
      subject: candidate.subject,
      predicate: candidate.predicate,
      object: candidate.object,
      category: categoryFromKind(candidate.kind),
      status: 'candidate',
      extractorConfidence: candidate.confidence,
      confidence: candidate.confidence,
      firstAssertedAt: candidate.id,
      lastSurfacedAt: candidate.id,
      origin: role === 'user' ? 'user' : 'agent',
      evidence: [{ candidateId: candidate.id, role }],
      entities: extractEntities(candidate),
      promotion,
    });
    return (await this.claims.setStatus(created.id, 'active')) ?? created;
  }

  /** Explicit execution path: manual trigger, post-approval driver, recovery. */
  async sweep(): Promise<SweepSummary> {
    const summary: SweepSummary = { ...EMPTY_SWEEP };
    const rows = await this.journal.listByState(['proposed', 'promoting']);
    for (const row of rows) {
      try {
        const { outcome } = await this.executeEntry(row.id);
        summary[outcome] += 1;
      } catch (err) {
        this.logger.warn(
          `Sweep failed on journal ${row.id}: ${
            err instanceof Error ? err.message : 'unknown error'
          }`,
        );
        summary.failed += 1;
      }
    }
    return summary;
  }

  /** Non-terminal rows with their approval state for inspection. */
  async listPending(): Promise<
    (PromotionJournalEntry & { approvalStatus: string | null })[]
  > {
    const rows = await this.journal.listByState(['proposed', 'promoting']);
    const pending: (PromotionJournalEntry & {
      approvalStatus: string | null;
    })[] = [];
    for (const row of rows) {
      let approvalStatus: string | null = null;
      if (row.approvalId) {
        const approval = await this.approvals.getApproval(row.approvalId);
        approvalStatus = approval ? approval.status : 'missing';
      }
      pending.push({ ...row, approvalStatus });
    }
    return pending;
  }
}
