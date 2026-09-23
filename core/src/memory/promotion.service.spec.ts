import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SqliteApprovalRepository } from '../approvals/sqlite-approval.repository';
import { ApprovalService } from '../approvals/approval.service';
import { SessionDatabaseService } from '../session/session-database.service';
import { DatabaseService } from '../session/database.service';
import { MemoryDatabaseService } from './memory-database.service';
import type { MemoryCandidate, NewMemoryCandidate } from './memory-candidate';
import { SqliteMemoryCandidateRepository } from './sqlite-memory-candidate.repository';
import { SqliteClaimRepository } from './sqlite-claim.repository';
import { SqlitePromotionJournalRepository } from './sqlite-promotion-journal.repository';
import { PromotionService } from './promotion.service';

function testConfig(
  memoryDbPath: string,
  dir: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'm',
    llmTimeoutMs: 1000,
    systemPrompt: 'sys',
    maxHistory: 50,
    sessionDbPath: join(dir, 'sessions-unused.sqlite'),
    memoryDbPath,
    legacyDbPath: join(dir, 'legacy-missing.sqlite'),
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'mem',
    memoryLlmTimeoutMs: 1000,
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: join(dir, 'claims-vector-test.db'),
    skillsDirPath: join(dir, 'skills-unused'),
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: 5,
    agentMaxToolSteps: 5,
    agentMaxTurnDurationMs: 900000,
    ...overrides,
  };
}

const candidate = (
  sessionId: string,
  object = 'TypeScript',
  overrides: Partial<NewMemoryCandidate> = {},
): NewMemoryCandidate => ({
  kind: 'preference',
  subject: 'user',
  predicate: 'prefers',
  object,
  confidence: 0.9,
  importance: 0.7,
  stability: 0.8,
  sourceRole: 'user',
  source: { sessionId, messageId: 1, role: 'user' },
  extractorModel: 'mem',
  extractorVersion: 'memory-extraction-v2',
  ...overrides,
});

describe('PromotionService', () => {
  let dir = '';
  const services: DatabaseService[] = [];

  const setup = (overrides: Partial<CoreConfig> = {}) => {
    const config = testConfig(join(dir, 'memories.sqlite'), dir, overrides);
    const service = new MemoryDatabaseService(config);
    service.onModuleInit();
    services.push(service);
    const sessionService = new SessionDatabaseService(config);
    sessionService.onModuleInit();
    services.push(sessionService);
    const candidates = new SqliteMemoryCandidateRepository(service);
    const claims = new SqliteClaimRepository(service);
    const journal = new SqlitePromotionJournalRepository(service);
    const approvals = new SqliteApprovalRepository(sessionService);
    // ApprovalService.create binds sessions; the unit approval path
    // delegates straight to the real repository (e2e covers binding).
    const approvalService = {
      create: (input: {
        sessionId: string;
        action: string;
        description?: string;
      }) => approvals.createApproval(input),
    } as unknown as ApprovalService;
    const promotion = new PromotionService(
      config,
      candidates,
      claims,
      journal,
      approvalService,
      approvals,
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
    );
    // Approvals bind sessions by FK; the turn's session exists at runtime.
    sessionService.connection
      .prepare(
        'INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)',
      )
      .run('s1', 't', 't');
    return { promotion, candidates, claims, journal, approvals, db: service };
  };

  const save = async (
    setupResult: ReturnType<typeof setup>,
    items: NewMemoryCandidate[],
  ): Promise<MemoryCandidate[]> => setupResult.candidates.saveCandidates(items);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-promo-'));
  });

  afterEach(() => {
    for (const service of services.splice(0)) {
      service.onModuleDestroy();
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('proposes NEW candidates with a memory.promote approval, HITL by default', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.operation).toBe('NEW');
    expect(entry?.state).toBe('proposed');
    expect(entry?.approvalId).toBeDefined();

    const approval = await s.approvals.getApproval(entry.approvalId!);
    expect(approval?.action).toBe('memory.promote');
    expect(approval?.status).toBe('pending');
    expect(approval?.description).toContain('TypeScript');

    // Sweep before approval: skipped, nothing created.
    expect(await s.promotion.sweep()).toMatchObject({ skipped: 1, new: 0 });
    expect(await s.claims.listClaims()).toHaveLength(0);
  });

  it('proposes each candidate exactly once', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);

    const [first] = await s.promotion.proposeCandidates([saved]);
    const [second] = await s.promotion.proposeCandidates([saved]);
    expect(second?.id).toBe(first?.id);
    expect(await s.approvals.listApprovals()).toHaveLength(1);
  });

  it('commits on approval via sweep with provenance intact', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({ new: 1 });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      status: 'active',
      origin: 'user',
      confidence: 0.9,
      evidence: [{ candidateId: saved.id, role: 'user' }],
      promotion: `approved:${entry.approvalId}`,
    });
    const done = await s.journal.getEntry(entry.id);
    expect(done?.state).toBe('committed');
    expect(done?.claimId).toBe(claims[0].id);
  });

  it('auto-commits admitted NEW kinds without approval when opted in', async () => {
    const s = setup({
      memoryPromotionAuto: true,
      memoryPromotionAutoKinds: ['fact'],
    });
    const [saved] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.state).toBe('committed');
    expect(entry?.approvalId).toBeNull();

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.promotion).toBe('auto');
    expect(await s.approvals.listApprovals()).toHaveLength(0);
  });

  it('keeps auto off the table by default even for admitted-looking kinds', async () => {
    const s = setup();
    const [saved] = await save(s, [
      candidate('s1', 'teal', {
        kind: 'fact',
        subject: 'user',
        predicate: 'likes',
      }),
    ]);

    const [entry] = await s.promotion.proposeCandidates([saved]);
    expect(entry?.state).toBe('proposed');
    expect(entry?.approvalId).toBeDefined();
  });

  it('converges a repeated triple to REINFORCE, never a second claim', async () => {
    const s = setup();
    const [first] = await save(s, [candidate('s1')]);
    const [second] = await save(s, [candidate('s1')]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    // Intent is advisory: no claim exists yet at proposal time, so the
    // second proposal reads NEW; convergence happens at execution.
    expect(e2?.operation).toBe('NEW');

    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      new: 1,
      reinforced: 1,
    });

    const claims = await s.claims.listClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0]?.evidence).toHaveLength(2);
    expect(claims[0]?.confidence).toBeCloseTo(0.95, 5);
    expect(claims[0]?.timesObserved).toBe(2);
    expect(claims[0]?.firstAssertedAt).toBe(first.id);
    expect((await s.journal.getEntry(e2.id))?.detail).toContain(
      'rederived:NEW->REINFORCE',
    );
  });

  it('contradicts on same subject+predicate with a new object', async () => {
    const s = setup();
    const [first] = await save(s, [candidate('s1', 'TypeScript')]);
    const [second] = await save(s, [candidate('s1', 'Rust')]);

    const [e1] = await s.promotion.proposeCandidates([first]);
    const [e2] = await s.promotion.proposeCandidates([second]);
    // Same advisory-intent rule as REINFORCE: conflict is detected
    // at execution, when the first claim exists.
    expect(e2?.operation).toBe('NEW');

    await s.approvals.resolveApproval(e1.approvalId!, 'approved');
    await s.approvals.resolveApproval(e2.approvalId!, 'approved');
    expect(await s.promotion.sweep()).toMatchObject({
      new: 1,
      contradicted: 1,
    });

    const active = await s.claims.listClaims({ status: 'active' });
    const contradicted = await s.claims.listClaims({ status: 'contradicted' });
    expect(active).toHaveLength(1);
    expect(active[0]?.object).toBe('Rust');
    expect(contradicted).toHaveLength(1);
    expect(contradicted[0]?.object).toBe('TypeScript');
    expect(contradicted[0]?.evidence).toHaveLength(1);
    const done = await s.journal.getEntry(e2.id);
    expect(done?.detail).toContain(`contradicts:${contradicted[0].id}`);
  });

  it('denies cleanly: no claim, no retry', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    await s.approvals.resolveApproval(entry.approvalId!, 'rejected');
    expect(await s.promotion.sweep()).toMatchObject({ denied: 1 });
    expect(await s.claims.listClaims()).toHaveLength(0);
    // Second sweep: terminal, untouched.
    expect(await s.promotion.sweep()).toMatchObject({ denied: 0 });
  });

  it('executes exactly once across repeated calls', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);
    await s.approvals.resolveApproval(entry.approvalId!, 'approved');

    const first = await s.promotion.executeEntry(entry.id);
    const second = await s.promotion.executeEntry(entry.id);
    expect(first.outcome).toBe('new');
    expect(second.outcome).toBe('skipped');
    expect(await s.claims.listClaims()).toHaveLength(1);
  });

  it('fails visibly on missing candidates and unknown origin', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);

    // Candidate deleted out from under the proposal: abort, never invent.
    s.db.connection
      .prepare('DELETE FROM memory_candidates WHERE id = ?')
      .run(saved.id);
    await s.approvals.resolveApproval(entry.approvalId!, 'approved');
    const missing = await s.promotion.executeEntry(entry.id);
    expect(missing.outcome).toBe('failed');
    expect(missing.entry?.detail).toContain('missing_candidate');

    const [legacy] = await save(s, [
      candidate('s1', 'teal', {
        sourceRole: 'unknown',
        source: { sessionId: 's1', messageId: 1, role: 'unknown' },
      }),
    ]);
    const [legacyEntry] = await s.promotion.proposeCandidates([legacy]);
    await s.approvals.resolveApproval(legacyEntry.approvalId!, 'approved');
    const parked = await s.promotion.executeEntry(legacyEntry.id);
    expect(parked.outcome).toBe('failed');
    expect(parked.entry?.detail).toContain('unknown_origin');
    expect(await s.claims.listClaims()).toHaveLength(0);
  });

  it('replays interrupted rows on startup', async () => {
    const s = setup();
    const [saved] = await save(s, [candidate('s1')]);
    const [entry] = await s.promotion.proposeCandidates([saved]);
    await s.journal.setState(entry.id, 'promoting');

    await s.promotion.onModuleInit();
    expect((await s.journal.getEntry(entry.id))?.state).toBe('proposed');
  });

  it('never throws from proposal; a failing approval path logs and skips', async () => {
    const s = setup();
    const failing = {
      create: () => Promise.reject(new Error('sessions down')),
    } as unknown as ApprovalService;
    const promotion = new PromotionService(
      testConfig(join(dir, 'memories.sqlite'), dir),
      s.candidates,
      s.claims,
      s.journal,
      failing,
      s.approvals,
      {
        indexClaim: jest.fn(() => Promise.resolve()),
        searchSimilar: jest.fn(() => Promise.resolve([])),
        status: jest.fn(() => Promise.resolve({ enabled: false })),
      },
    );
    const [saved] = await save(s, [candidate('s1')]);
    await expect(promotion.proposeCandidates([saved])).resolves.toHaveLength(0);
  });
});
