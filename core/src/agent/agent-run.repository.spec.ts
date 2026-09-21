import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { SessionDatabaseService } from '../session/session-database.service';
import { AgentRunRepository } from './agent-run.repository';

describe('AgentRunRepository SQLite', () => {
  let dir: string;
  const databases: SessionDatabaseService[] = [];

  function open() {
    const config = {
      sessionDbPath: join(dir, 'sessions.sqlite'),
    } as CoreConfig;
    const database = new SessionDatabaseService(config);
    database.onModuleInit();
    databases.push(database);
    database.connection
      .prepare(
        `INSERT INTO sessions (id, created_at, updated_at)
         VALUES ('s1', 't', 't')`,
      )
      .run();
    return { database, runs: new AgentRunRepository(database) };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-runs-'));
  });

  afterEach(() => {
    databases.splice(0).forEach((database) => database.onModuleDestroy());
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a running run with empty steps and limits', () => {
    const { runs } = open();
    const run = runs.createRun({
      sessionId: 's1',
      goal: 'find teal',
      limits: { maxToolSteps: 5 },
    });
    expect(run).toMatchObject({
      sessionId: 's1',
      goal: 'find teal',
      state: 'created',
      requestIds: [],
      currentRequestId: null,
      iterationCount: 0,
      toolCallCount: 0,
      limits: { maxToolSteps: 5 },
      approvalId: null,
      termination: null,
    });
    expect(run.id).toEqual(expect.any(String));
  });

  it('appends step requests and bumps counters', () => {
    const { runs } = open();
    const created = runs.createRun({
      sessionId: 's1',
      goal: 'find teal',
      limits: { maxToolSteps: 5 },
    });
    const first = runs.recordStep(created.id, {
      requestId: 'req-1',
      toolCalls: 1,
    });
    expect(first.requestIds).toEqual(['req-1']);
    expect(first.currentRequestId).toBe('req-1');
    expect(first.iterationCount).toBe(1);
    expect(first.toolCallCount).toBe(1);
    const second = runs.recordStep(created.id, {
      requestId: 'req-2',
      toolCalls: 0,
    });
    expect(second.requestIds).toEqual(['req-1', 'req-2']);
    expect(second.currentRequestId).toBe('req-2');
    expect(second.iterationCount).toBe(2);
    expect(second.toolCallCount).toBe(1);
  });

  it('walks the lifecycle and terminates with new states', () => {
    const { runs } = open();
    const created = runs.createRun({
      sessionId: 's1',
      goal: 'find teal',
      limits: { maxToolSteps: 5 },
    });
    for (const state of [
      'reasoning',
      'action_proposed',
      'executing',
      'observing',
    ] as const) {
      expect(runs.transitionRun(created.id, state).state).toBe(state);
    }
    const parked = runs.markParked(created.id, 'appr-1');
    expect(parked.state).toBe('awaiting_approval');
    const cancelled = runs.markTerminal(created.id, 'cancelled', {
      reason: 'cancelled',
      toolSteps: 1,
    });
    expect(cancelled.state).toBe('cancelled');
    expect(cancelled.termination).toEqual({
      reason: 'cancelled',
      toolSteps: 1,
    });
    const budgeted = runs.markTerminal(created.id, 'budget_exhausted', {
      reason: 'step_bound',
      toolSteps: 5,
    });
    expect(budgeted.state).toBe('budget_exhausted');
  });

  it('parks with the approval pointer and terminates with a reason', () => {
    const { runs } = open();
    const created = runs.createRun({
      sessionId: 's1',
      goal: 'rename it',
      limits: { maxToolSteps: 5 },
    });
    runs.recordStep(created.id, { requestId: 'req-1', toolCalls: 1 });
    const parked = runs.markParked(created.id, 'appr-1');
    expect(parked.state).toBe('awaiting_approval');
    expect(parked.approvalId).toBe('appr-1');
    expect(parked.requestIds).toEqual(['req-1']);
    const done = runs.markTerminal(created.id, 'completed', {
      reason: 'final_answer',
      toolSteps: 0,
    });
    expect(done.state).toBe('completed');
    expect(done.termination).toEqual({
      reason: 'final_answer',
      toolSteps: 0,
    });
  });

  it('finds the run pointing at a step request', () => {
    const { runs } = open();
    const first = runs.createRun({
      sessionId: 's1',
      goal: 'one',
      limits: { maxToolSteps: 5 },
    });
    const second = runs.createRun({
      sessionId: 's1',
      goal: 'two',
      limits: { maxToolSteps: 5 },
    });
    runs.recordStep(first.id, { requestId: 'req-1', toolCalls: 1 });
    runs.recordStep(second.id, { requestId: 'req-2', toolCalls: 1 });
    expect(runs.findByRequest('s1', 'req-2')?.id).toBe(second.id);
    expect(runs.findByRequest('s1', 'req-1')?.id).toBe(first.id);
    expect(runs.findByRequest('s1', 'nope')).toBeUndefined();
    expect(runs.findByRequest('other', 'req-1')).toBeUndefined();
  });

  it('rejects unknown runs and cascades with the session', () => {
    const { database, runs } = open();
    expect(() =>
      runs.recordStep('missing', { requestId: 'r', toolCalls: 0 }),
    ).toThrow('agent_run_not_found');
    expect(() =>
      runs.markTerminal('missing', 'failed', {
        reason: 'turn_error',
        toolSteps: 0,
      }),
    ).toThrow('agent_run_not_found');
    expect(() => runs.get('missing')).toThrow('agent_run_not_found');
    const created = runs.createRun({
      sessionId: 's1',
      goal: 'gone',
      limits: { maxToolSteps: 5 },
    });
    database.connection.prepare(`DELETE FROM sessions WHERE id = 's1'`).run();
    expect(() => runs.get(created.id)).toThrow('agent_run_not_found');
  });

  it('derives observations from ledger rows in step order', () => {
    const { database, runs } = open();
    const insert = database.connection.prepare(
      `INSERT INTO tool_requests
        (request_id, session_id, input_json, invocation_id, state,
         validation_json, execution_json, final_state, final_json)
       VALUES (?, 's1', ?, ?, ?, ?, ?, 'not_required', ?)`,
    );
    const proposal = JSON.stringify({
      requestId: 'req-ok',
      sessionId: 's1',
      context: [],
      allowedTools: ['session.search'],
      proposal: { kind: 'tool_calls', model: 'm', content: null },
    });
    const validation = JSON.stringify({
      ok: true,
      request: {
        name: 'session.search',
        version: 1,
        sessionId: 's1',
        args: { query: 'teal', limit: 20 },
      },
    });
    insert.run(
      'req-ok',
      proposal,
      'inv-ok',
      'succeeded',
      validation,
      JSON.stringify({ ok: true, matches: [] }),
      '{"state":"not_required"}',
    );
    insert.run(
      'req-unknown',
      proposal,
      'inv-unknown',
      'failed',
      validation,
      JSON.stringify({ ok: false, failure: { code: 'unknown' } }),
      '{"state":"not_required"}',
    );
    insert.run(
      'req-invalid',
      proposal,
      'inv-bad',
      'invalid',
      JSON.stringify({ ok: false, failure: { code: 'unknown_tool' } }),
      null,
      '{"state":"not_required"}',
    );
    const created = runs.createRun({
      sessionId: 's1',
      goal: 'find teal',
      limits: { maxToolSteps: 5 },
    });
    runs.recordStep(created.id, { requestId: 'req-ok', toolCalls: 1 });
    runs.recordStep(created.id, { requestId: 'req-unknown', toolCalls: 1 });
    runs.recordStep(created.id, { requestId: 'req-invalid', toolCalls: 1 });
    runs.recordStep(created.id, { requestId: 'req-missing', toolCalls: 1 });

    const observations = runs.observations(created.id);

    // Only executed actions observe, in step order, linked by identity.
    expect(observations.map((o) => o.requestId)).toEqual([
      'req-ok',
      'req-unknown',
    ]);
    expect(observations[0]).toMatchObject({
      invocationId: 'inv-ok',
      tool: 'session.search',
      status: 'succeeded',
    });
    // Unknown stays unknown — never converted to failure.
    expect(observations[1]).toMatchObject({
      invocationId: 'inv-unknown',
      status: 'unknown',
    });
  });
});
