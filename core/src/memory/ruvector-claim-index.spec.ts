import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { CoreConfig } from '../config';
import type { Claim } from './claim';
import { buildIndexText, RuvectorClaimIndex } from './ruvector-claim-index';
import { ClaimIndexUnavailableError } from './claim-index';

jest.mock('ruvector', () => ({
  OnnxEmbedder: jest.fn().mockImplementation(() => ({
    init: () => Promise.reject(new Error('no native backend here')),
  })),
  VectorDB: jest.fn(),
  isWasm: () => true,
}));

const claim: Claim = {
  id: 'claim-1',
  subject: 'user',
  predicate: 'prefers',
  object: 'explicit provenance',
  category: 'preference',
  status: 'active',
  extractorConfidence: 0.9,
  confidence: 0.9,
  firstAssertedAt: 'cand-1',
  lastSurfacedAt: 'cand-1',
  origin: 'user',
  sourceType: null,
  summary: null,
  evidence: [{ candidateId: 'cand-1', role: 'user' }],
  related: [],
  entities: ['user'],
  timesObserved: 1,
  accessCount: 0,
  lastAccessedAt: null,
  activation: null,
  locked: false,
  emotional: null,
  promotion: 'approved:appr-1',
  createdAt: 't',
  updatedAt: 't',
};

describe('buildIndexText', () => {
  it('indexes the whole triple and nothing else', () => {
    expect(buildIndexText(claim)).toBe('user prefers explicit provenance');
  });
});

describe('RuvectorClaimIndex fail-closed', () => {
  let dir = '';

  const openIndex = (): RuvectorClaimIndex => {
    const config = {
      vectorDbPath: join(dir, 'claims-vector.db'),
    } as CoreConfig;
    return new RuvectorClaimIndex(config);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-idx-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('disables loudly once when the backend cannot init', async () => {
    const index = openIndex();

    expect(await index.status()).toMatchObject({ enabled: false });
    // Second call: same verdict, init attempted once.
    expect(await index.status()).toMatchObject({ enabled: false });
  });

  it('refuses search with a typed error, never empty-ok', async () => {
    const index = openIndex();

    await expect(index.searchSimilar('anything', 5)).rejects.toBeInstanceOf(
      ClaimIndexUnavailableError,
    );
  });

  it('absorbs index writes so promotion never fails on the index', async () => {
    const index = openIndex();

    await expect(index.indexClaim(claim)).resolves.toBeUndefined();
  });
});
