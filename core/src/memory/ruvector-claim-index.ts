import { Inject, Injectable, Logger } from '@nestjs/common';
import { isWasm, OnnxEmbedder, VectorDB } from 'ruvector';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import type { Claim } from './claim';
import {
  ClaimIndex,
  ClaimIndexUnavailableError,
  type SimilarClaim,
} from './claim-index';

/** The text a claim is findable by: its whole triple, nothing else. */
export function buildIndexText(
  claim: Pick<Claim, 'subject' | 'predicate' | 'object'>,
): string {
  return `${claim.subject} ${claim.predicate} ${claim.object}`;
}

interface Backend {
  embedder: InstanceType<typeof OnnxEmbedder>;
  db: InstanceType<typeof VectorDB>;
}

/**
 * RuVector-backed semantic surface (embedded library, in-process).
 * Lazy init on first use; any failure — missing native binding
 * (alpine), model download failure, corrupt store — disables the
 * index loudly once and stays fail-closed. SQLite never notices.
 */
@Injectable()
export class RuvectorClaimIndex extends ClaimIndex {
  private readonly logger = new Logger(RuvectorClaimIndex.name);
  private backend: Promise<Backend | null> | null = null;
  private disabledReason: string | null = null;

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    super();
  }

  private ensure(): Promise<Backend | null> {
    if (!this.backend) {
      this.backend = this.init().catch((err: unknown) => {
        const reason = err instanceof Error ? err.message : 'unknown error';
        this.disabledReason = reason;
        this.logger.warn(`Claim index disabled: ${reason}`);
        return null;
      });
    }
    return this.backend;
  }

  private async init(): Promise<Backend> {
    // Throws fail-closed on platforms without a native binding.
    const embedder = new OnnxEmbedder();
    await embedder.init();
    const probe = await embedder.embedPassage('icos index probe');
    const db = new VectorDB({
      dimensions: probe.length,
      distanceMetric: 'cosine',
      storagePath: this.config.vectorDbPath,
    });
    await db.len();
    this.logger.log(
      `Claim index ready (${probe.length}d, native=${!isWasm()})`,
    );
    return { embedder, db };
  }

  async indexClaim(claim: Claim): Promise<void> {
    const backend = await this.ensure();
    if (!backend) return;
    try {
      const vector = await backend.embedder.embedPassage(buildIndexText(claim));
      await backend.db.insert({
        id: claim.id,
        vector,
        metadata: { claimId: claim.id, text: buildIndexText(claim) },
      });
    } catch (err) {
      this.logger.warn(
        `Claim index write failed for ${claim.id}: ${
          err instanceof Error ? err.message : 'unknown error'
        }`,
      );
    }
  }

  async searchSimilar(text: string, k: number): Promise<SimilarClaim[]> {
    const backend = await this.ensure();
    if (!backend) {
      throw new ClaimIndexUnavailableError(
        this.disabledReason ?? 'backend unavailable',
      );
    }
    const vector = await backend.embedder.embedQuery(text);
    const hits = await backend.db.search({ vector, k });
    const similar: SimilarClaim[] = [];
    for (const hit of hits) {
      const metadata = hit.metadata as { claimId?: unknown } | undefined;
      if (typeof metadata?.claimId === 'string') {
        similar.push({ claimId: metadata.claimId, score: hit.score });
      }
    }
    return similar;
  }

  async status(): Promise<{
    enabled: boolean;
    native?: boolean;
    count?: number;
    reason?: string;
  }> {
    const backend = await this.ensure();
    if (!backend)
      return { enabled: false, reason: this.disabledReason ?? 'unknown' };
    return { enabled: true, native: !isWasm(), count: await backend.db.len() };
  }
}
