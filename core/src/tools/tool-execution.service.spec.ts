import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { CoreConfig } from '../config';
import { SessionStore } from '../conversation/session.store';
import { ToolOffer } from '../llm/llm.protocol';
import type { LlmResult, LlmToolRequest } from '../llm/llm.protocol';
import { SessionDatabaseService } from '../session/session-database.service';
import { SqliteSessionRepository } from '../session/sqlite-session.repository';
import { ToolRegistry } from './tool-registry';
import { ToolExecutionRepository } from './tool-execution.repository';
import {
  ToolExecutionService,
  type ToolExecutionInput,
} from './tool-execution.service';

function input(): ToolExecutionInput {
  return {
    requestId: 'request-1',
    sessionId: 's1',
    context: [{ role: 'user', content: 'Find teal' }],
    allowedTools: ['session.search', 'session.rename'],
    proposal: {
      kind: 'tool_calls',
      model: 'test',
      content: null,
      toolCalls: [
        {
          id: 'model-id',
          name: 'session.search',
          version: 1,
          rawArguments: '{"query":"teal","limit":1}',
          args: { query: 'teal', limit: 1 },
        },
      ],
    },
  };
}

describe('ToolExecutionService SQLite', () => {
  let dir: string;
  const databases: SessionDatabaseService[] = [];
  const final = jest.fn<Promise<LlmResult>, [LlmToolRequest]>();

  function open() {
    const config = {
      sessionDbPath: join(dir, 'sessions.sqlite'),
      memoryDbPath: join(dir, 'unused.sqlite'),
      maxHistory: 50,
    } as CoreConfig;
    const database = new SessionDatabaseService(config);
    database.onModuleInit();
    databases.push(database);
    const sessions = new SqliteSessionRepository(database);
    const store = new SessionStore(sessions, config);
    const ledger = new ToolExecutionRepository(database);
    const registry = new ToolRegistry();
    const service = new ToolExecutionService(ledger, store, registry, {
      chatWithTools: final,
    });
    return { database, sessions, store, ledger, registry, service };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-tools-'));
    final.mockReset().mockResolvedValue({
      kind: 'text',
      content: 'Found teal',
      model: 'test',
    });
  });

  afterEach(() => {
    databases.splice(0).forEach((database) => database.onModuleDestroy());
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists scoped real search and final response, delivering each at most once', async () => {
    const { sessions, store, service, ledger } = open();
    await sessions.createSession('s1');
    await sessions.createSession('s2');
    await sessions.appendMessage('s1', { role: 'user', content: 'teal local' });
    await sessions.appendMessage('s2', {
      role: 'user',
      content: 'teal private',
    });
    const search = jest.spyOn(store, 'searchMessages');
    const first = await service.consume(input());
    expect(first.state).toBe('succeeded');
    expect(first.execution).toMatchObject({
      ok: true,
      matches: [{ sessionId: 's1', content: 'teal local' }],
    });
    expect(first.final).toEqual({
      state: 'succeeded',
      result: { kind: 'text', content: 'Found teal', model: 'test' },
    });
    expect(await service.consume(input())).toEqual(first);
    expect(ledger.get('request-1')).toEqual(first);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('teal', { sessionId: 's1', limit: 1 });
    expect(final).toHaveBeenCalledTimes(1);
    expect(await sessions.getMessages('s1')).toHaveLength(1);
  });

  it('competing connections cannot rerun an in-flight handler or final attempt', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    let releaseSearch!: (value: []) => void;
    const search = jest.spyOn(first.store, 'searchMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSearch = resolve;
        }),
    );
    const otherSearch = jest.spyOn(second.store, 'searchMessages');
    let releaseFinal!: (value: LlmResult) => void;
    final.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFinal = resolve;
        }),
    );
    const running = first.service.consume(input());
    expect((await second.service.consume(input())).state).toBe('executing');
    releaseSearch([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect((await second.service.consume(input())).final.state).toBe('claimed');
    releaseFinal({ kind: 'text', content: 'done', model: 'test' });
    const completed = await running;
    expect(await second.service.consume(input())).toEqual(completed);
    expect(search).toHaveBeenCalledTimes(1);
    expect(otherSearch).not.toHaveBeenCalled();
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each(['context', 'session', 'proposal', 'policy'] as const)(
    'conflicts on changed %s without replacement',
    async (change) => {
      const { service, sessions, ledger } = open();
      await sessions.createSession('s1');
      await sessions.createSession('s2');
      const prior = await service.consume(input());
      const changed = input();
      if (change === 'context')
        changed.context = [{ role: 'user', content: 'different' }];
      if (change === 'session') changed.sessionId = 's2';
      if (change === 'proposal')
        changed.proposal = {
          kind: 'text',
          content: 'different',
          model: 'test',
        };
      if (change === 'policy') changed.allowedTools = [];
      await expect(service.consume(changed)).rejects.toThrow(
        'request_conflict',
      );
      expect(ledger.get('request-1')).toEqual(prior);
      expect(final).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    'multi',
    'zero',
    'unknown',
    'disallowed',
    'args',
    'raw',
    'json',
    'version',
  ] as const)('durably rejects %s before effects', async (bad) => {
    const { service, sessions, store, database } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    const proposal = input();
    if (proposal.proposal.kind !== 'tool_calls') throw new Error('fixture');
    const call = proposal.proposal.toolCalls[0];
    if (bad === 'multi')
      proposal.proposal = {
        ...proposal.proposal,
        toolCalls: [call, { ...call, id: 'second' }],
      };
    if (bad === 'zero')
      proposal.proposal = { ...proposal.proposal, toolCalls: [] };
    if (bad === 'unknown') Object.assign(call, { name: 'session.delete' });
    if (bad === 'version') Object.assign(call, { version: 2 });
    if (bad === 'disallowed') proposal.allowedTools = [];
    if (bad === 'args')
      Object.assign(call, {
        args: { query: 'teal', sessionId: 's2' },
        rawArguments: '{"query":"teal","sessionId":"s2"}',
      });
    if (bad === 'raw')
      Object.assign(call, { rawArguments: '{"query":"different","limit":1}' });
    if (bad === 'json') Object.assign(call, { rawArguments: '{' });
    const result = await service.consume(proposal);
    expect(result.state).toBe('invalid');
    expect(result.validation.ok).toBe(false);
    if (result.validation.ok) throw new Error('expected invalid proposal');
    expect(typeof result.validation.failure.code).toBe('string');
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
    expect(
      database.connection.prepare('SELECT * FROM approvals').all(),
    ).toEqual([]);
  });

  it('returns completed duplicates without consulting changed validation code', async () => {
    const { service, sessions, registry } = open();
    await sessions.createSession('s1');
    const result = await service.consume(input());
    jest.spyOn(registry, 'validate').mockImplementation(() => {
      throw new Error('changed registry');
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { kind: 'tool_calls', model: 'test', content: null, toolCalls: null },
    { kind: 'tool_calls', model: 'test', content: null, toolCalls: {} },
  ])('durably rejects malformed completed proposals: %j', async (malformed) => {
    const { service, sessions, store, ledger } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    const proposal = {
      ...input(),
      proposal: malformed as unknown as LlmResult,
    };
    const result = await service.consume(proposal);
    expect(result.state).toBe('invalid');
    expect(ledger.get(proposal.requestId)).toEqual(result);
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it.each([
    { kind: 'text', content: '', model: 'test' },
    { kind: 'text', content: 'answer', model: null },
    { kind: 'tool_calls', content: 42 },
    { kind: 'tool_calls', model: '' },
  ])(
    'rejects malformed completion metadata before effects: %j',
    async (metadata) => {
      const { service, sessions, store } = open();
      await sessions.createSession('s1');
      const proposal = input();
      proposal.proposal = { ...proposal.proposal, ...metadata } as LlmResult;
      if (proposal.proposal.kind === 'text') {
        proposal.proposal = {
          kind: 'text',
          content: proposal.proposal.content,
          model: proposal.proposal.model,
        };
      }
      const search = jest.spyOn(store, 'searchMessages');
      const result = await service.consume(proposal);
      expect(result).toMatchObject({
        state: 'invalid',
        validation: { ok: false, failure: { code: 'invalid_proposal' } },
      });
      expect(await service.consume(proposal)).toEqual(result);
      expect(search).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
    },
  );

  it('persists invalid context without effects', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    const proposal = input();
    proposal.context = [{ role: 'tool', callId: 'unpaired', content: '{}' }];
    const search = jest.spyOn(store, 'searchMessages');
    const result = await service.consume(proposal);
    expect(result).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'invalid_context' } },
    });
    expect(await service.consume(proposal)).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it.each(['requestId', 'sessionId'] as const)(
    'requires trusted nonblank %s',
    async (field) => {
      const { service, database, store } = open();
      const search = jest.spyOn(store, 'searchMessages');
      await expect(
        service.consume({ ...input(), [field]: ' ' }),
      ).rejects.toThrow('invalid_request');
      expect(
        database.connection.prepare('SELECT * FROM tool_requests').all(),
      ).toEqual([]);
      expect(search).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
    },
  );

  it('closes text-only requests without another model call', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    const proposal = input();
    proposal.proposal = { kind: 'text', content: 'answer', model: 'test' };
    const result = await service.consume(proposal);
    expect(result).toMatchObject({
      state: 'closed',
      invocationId: null,
      final: { state: 'not_required', result: proposal.proposal },
    });
    expect(await service.consume(proposal)).toEqual(result);
    expect(final).not.toHaveBeenCalled();
  });

  it('blocks rename across restart without creating or consuming generic approvals', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    const proposal = input();
    if (proposal.proposal.kind !== 'tool_calls') throw new Error('fixture');
    Object.assign(proposal.proposal.toolCalls[0], {
      name: 'session.rename',
      args: { title: 'new title' },
      rawArguments: '{"title":"new title"}',
    });
    const result = await first.service.consume(proposal);
    expect(result).toMatchObject({
      state: 'awaiting_approval',
      execution: null,
      final: { state: 'not_required' },
    });
    expect(
      first.database.connection.prepare('SELECT * FROM approvals').all(),
    ).toEqual([]);
    first.database.connection
      .prepare(
        "INSERT INTO approvals (id, session_id, action, status, created_at, updated_at) VALUES ('generic', 's1', 'session.rename', 'approved', '', '')",
      )
      .run();
    first.database.onModuleDestroy();
    const second = open();
    expect(await second.service.consume(proposal)).toEqual(result);
    expect((await second.sessions.getSession('s1'))?.title).toBeUndefined();
    expect(final).not.toHaveBeenCalled();
  });

  it('keeps the execution result across reopen and failed final with no retries', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    await first.sessions.appendMessage('s1', {
      role: 'user',
      content: 'teal evidence',
    });
    final.mockRejectedValue(new Error('secret credential'));
    const result = await first.service.consume(input());
    expect(result).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'failed', failure: { code: 'llm_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret credential');
    first.database.onModuleDestroy();
    const second = open();
    const search = jest.spyOn(second.store, 'searchMessages');
    expect(await second.service.consume(input())).toEqual(result);
    expect(search).not.toHaveBeenCalled();
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('captures caller snapshots and pairs the durable invocation ID with tools disabled', async () => {
    const { service, sessions, ledger } = open();
    await sessions.createSession('s1');
    const proposal = input();
    const running = service.consume(proposal);
    proposal.context[0].content = 'mutated';
    if (proposal.proposal.kind === 'tool_calls')
      proposal.proposal.toolCalls[0].args.query = 'mutated';
    proposal.allowedTools = [];
    const result = await running;
    const request = final.mock.calls[0][0];
    expect(() => new ToolOffer(request)).not.toThrow();
    expect(request).toMatchObject({
      sessionId: 's1',
      tools: [],
      toolChoice: 'none',
    });
    expect(request.messages[0]).toEqual({ role: 'user', content: 'Find teal' });
    expect(request.messages[1]).toMatchObject({
      role: 'assistant',
      toolCalls: [
        { id: result.invocationId, args: { query: 'teal', limit: 1 } },
      ],
    });
    expect(request.messages[2]).toEqual({
      role: 'tool',
      callId: result.invocationId,
      content: JSON.stringify(ledger.get('request-1')?.execution),
    });
    expect(result.invocationId).not.toBe('model-id');
  });

  it('rejects tool calls returned by a final mock without executing them', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    final.mockResolvedValue(input().proposal);
    const result = await service.consume(input());
    expect(result.final).toMatchObject({
      state: 'failed',
      failure: { code: 'invalid_final' },
    });
    await service.consume(input());
    expect(search).toHaveBeenCalledTimes(1);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each([
    { kind: 'text', content: ' ', model: 'test' },
    { kind: 'text', content: 'answer' },
    { kind: 'text', content: 'answer', model: 'test', tool_calls: [] },
  ])('persists invalid final output without retries: %j', async (output) => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    final.mockResolvedValue(output as LlmResult);
    const result = await service.consume(input());
    expect(result.final).toEqual({
      state: 'failed',
      failure: { code: 'invalid_final' },
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('bounds final text independently of durable search results', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    final.mockResolvedValue({
      kind: 'text',
      content: 'x'.repeat(65536),
      model: 'test',
    });
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'failed', failure: { code: 'final_too_large' } },
    });
    expect(await service.consume(input())).toEqual(result);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('does not auto-create missing sessions', async () => {
    const { service, database } = open();
    await expect(service.consume(input())).rejects.toThrow('session_not_found');
    expect(database.connection.prepare('SELECT * FROM sessions').all()).toEqual(
      [],
    );
    expect(final).not.toHaveBeenCalled();
  });

  it('leaves execution claim ambiguous when durable result writing fails', async () => {
    const { service, sessions, database, ledger, store } = open();
    await sessions.createSession('s1');
    const search = jest.spyOn(store, 'searchMessages');
    database.connection.exec(
      "CREATE TRIGGER fail_result BEFORE UPDATE OF execution_json ON tool_requests WHEN NEW.execution_json IS NOT NULL BEGIN SELECT RAISE(ABORT, 'secret database error'); END",
    );
    await expect(service.consume(input())).rejects.toThrow(
      'ledger_unavailable',
    );
    expect(ledger.get('request-1')).toMatchObject({
      state: 'executing',
      execution: null,
    });
    database.connection.exec('DROP TRIGGER fail_result');
    database.onModuleDestroy();
    const reopened = open();
    expect(await reopened.service.consume(input())).toMatchObject({
      state: 'executing',
      execution: null,
    });
    expect(search).toHaveBeenCalledTimes(1);
    expect(final).not.toHaveBeenCalled();
  });

  it('leaves final claim pending on final result-write failure, never retries', async () => {
    const { service, sessions, database } = open();
    await sessions.createSession('s1');
    database.connection.exec(
      "CREATE TRIGGER fail_final BEFORE UPDATE OF final_json ON tool_requests WHEN NEW.final_state = 'succeeded' BEGIN SELECT RAISE(ABORT, 'secret'); END",
    );
    await expect(service.consume(input())).rejects.toThrow(
      'ledger_unavailable',
    );
    database.onModuleDestroy();
    expect(await open().service.consume(input())).toMatchObject({
      state: 'succeeded',
      execution: { ok: true },
      final: { state: 'claimed' },
    });
    expect(final).toHaveBeenCalledTimes(1);
  });

  it('bounds durable results with explicit failure, never false success', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    await sessions.appendMessage('s1', {
      role: 'user',
      content: `teal ${'x'.repeat(65536)}`,
    });
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'result_too_large' } },
    });
    expect(Buffer.byteLength(JSON.stringify(result.execution))).toBeLessThan(
      65536,
    );
  });

  it('revalidates registry policy in the atomic execution claim', async () => {
    const { service, sessions, registry, store } = open();
    await sessions.createSession('s1');
    const original = new ToolRegistry();
    jest
      .spyOn(registry, 'validate')
      .mockImplementationOnce((proposal, context) =>
        original.validate(proposal, context),
      )
      .mockReturnValue({
        ok: false,
        failure: { code: 'unpermitted_tool', message: 'secret' },
      });
    const search = jest.spyOn(store, 'searchMessages');
    expect(await service.consume(input())).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'unpermitted_tool' } },
    });
    expect(search).not.toHaveBeenCalled();
    expect(final).not.toHaveBeenCalled();
  });

  it('resumes only unclaimed final work from durable execution after restart', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    const claim = jest.spyOn(first.ledger, 'claimFinal').mockReturnValue(null);
    const saved = await first.service.consume(input());
    expect(saved.final.state).toBe('pending');
    expect(final).not.toHaveBeenCalled();
    claim.mockRestore();
    first.database.onModuleDestroy();
    const second = open();
    const search = jest.spyOn(second.store, 'searchMessages');
    final.mockRejectedValue(new Error('secret'));
    const resumed = await second.service.consume(input());
    expect(resumed.execution).toEqual(saved.execution);
    expect(resumed.invocationId).toBe(saved.invocationId);
    expect(resumed.final).toEqual({
      state: 'failed',
      failure: { code: 'llm_failed' },
    });
    expect(search).not.toHaveBeenCalled();
    expect(await second.service.consume(input())).toEqual(resumed);
    expect(final).toHaveBeenCalledTimes(1);
  });

  it.each(['success', 'failure'] as const)(
    'wait timeout leaves sole owner to persist eventual %s',
    async (outcome) => {
      const { ledger, store, registry, sessions } = open();
      await sessions.createSession('s1');
      let release!: (value: []) => void;
      let reject!: (error: Error) => void;
      const finish = jest.spyOn(ledger, 'finishSearch');
      const search = jest.spyOn(store, 'searchMessages').mockImplementation(
        () =>
          new Promise((resolve, fail) => {
            release = resolve;
            reject = fail;
          }),
      );
      const service = new ToolExecutionService(
        ledger,
        store,
        registry,
        { chatWithTools: final },
        { searchTimeoutMs: 5 },
      );
      const result = await service.consume(input());
      expect(result).toMatchObject({
        state: 'executing',
        execution: null,
        ownership: 'unconfirmed',
      });
      expect(await service.consume(input())).toEqual(result);
      expect(finish).not.toHaveBeenCalled();
      expect(final).not.toHaveBeenCalled();
      if (outcome === 'success') release([]);
      else reject(new Error('secret'));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(ledger.get('request-1')).toMatchObject({
        state: outcome === 'success' ? 'succeeded' : 'failed',
        execution:
          outcome === 'success'
            ? { ok: true, matches: [] }
            : { ok: false, failure: { code: 'search_failed' } },
        final: { state: 'pending' },
      });
      expect(final).not.toHaveBeenCalled();
      await service.consume(input());
      await service.consume(input());
      expect(finish).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1);
      expect(final).toHaveBeenCalledTimes(1);
    },
  );

  it('orphaned claim stays blocked; explicit release resolves unknown truthfully then completes', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    let release!: (value: []) => void;
    jest.spyOn(first.store, 'searchMessages').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let releaseFinal!: (value: LlmResult) => void;
    final.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseFinal = resolve;
        }),
    );
    const running = first.service
      .consume(input())
      .catch(() => 'ledger_unavailable');
    expect((await second.service.consume(input())).ownership).toBe(
      'unconfirmed',
    );
    expect(final).not.toHaveBeenCalled();
    first.database.onModuleDestroy();
    release([]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await second.service.consume(input())).toMatchObject({
      state: 'executing',
      execution: null,
      ownership: 'unconfirmed',
    });
    expect(final).not.toHaveBeenCalled();
    const released = second.ledger.releaseOwner(
      second.ledger.get('request-1')!.executionToken!,
    );
    expect(released).toBe(true);
    expect(second.ledger.releaseOwner('missing-token')).toBe(false);
    expect(second.ledger.resolveReleasedToUnknown('request-1')).toMatchObject({
      ok: false,
      failure: { code: 'unknown' },
    });
    expect(second.ledger.get('request-1')).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'unknown' } },
      final: { state: 'pending' },
    });
    const finalRunning = second.service.consume(input());
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(second.ledger.get('request-1')).toMatchObject({
      final: { state: 'claimed' },
    });
    expect(await second.service.consume(input())).toMatchObject({
      final: { state: 'claimed' },
    });
    releaseFinal({ kind: 'text', content: 'done', model: 'test' });
    const terminal = await finalRunning;
    expect(terminal.final).toEqual({
      state: 'succeeded',
      result: { kind: 'text', content: 'done', model: 'test' },
    });
    expect(await second.service.consume(input())).toEqual(terminal);
    await expect(running).resolves.toBe('ledger_unavailable');
  });

  it('keeps model call IDs independent of caller request identity', async () => {
    const { service, sessions } = open();
    await sessions.createSession('s1');
    const first = await service.consume(input());
    const second = await service.consume({
      ...input(),
      requestId: 'request-2',
    });
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(final).toHaveBeenCalledTimes(2);
  });

  it('conflicts when revalidation no longer equals the durable validation', async () => {
    const { ledger, sessions, database, registry, service } = open();
    await sessions.createSession('s1');
    const validation = {
      ok: true as const,
      request: {
        name: 'session.search' as const,
        version: 1 as const,
        sessionId: 's1',
        args: { query: 'teal', limit: 1 },
      },
    };
    ledger.register(JSON.stringify(input()), () => validation);
    jest.spyOn(registry, 'validate').mockReturnValue({
      ok: true,
      request: { ...validation.request, args: { query: 'teal', limit: 2 } },
    });
    expect(await service.consume(input())).toMatchObject({
      state: 'invalid',
      validation: { ok: false, failure: { code: 'unpermitted_tool' } },
    });
    expect(
      await database.connection
        .prepare('SELECT execution_json FROM tool_requests')
        .get(),
    ).toEqual({ execution_json: null });
    expect(final).not.toHaveBeenCalled();
  });

  it('contending registrars converge on one durable row without replacement', async () => {
    const first = open();
    const second = open();
    await first.sessions.createSession('s1');
    const results = await Promise.all([
      first.service.consume(input()).then((record) => record.requestId),
      second.service.consume(input()).then((record) => record.requestId),
    ]);
    expect(new Set(results).size).toBe(1);
    expect(
      first.database.connection
        .prepare('SELECT COUNT(*) AS count FROM tool_requests')
        .get(),
    ).toEqual({ count: 1 });
    expect(second.ledger.get('request-1')).not.toBeNull();
  });

  it('creates tool_requests and its immutability trigger on upgraded existing databases', async () => {
    const first = open();
    await first.sessions.createSession('s1');
    first.database.onModuleDestroy();
    const path = join(dir, 'sessions.sqlite');
    const raw = new Database(path);
    raw.exec('DROP TABLE tool_requests');
    raw.exec('DROP TRIGGER IF EXISTS tool_requests_identity_immutable');
    raw.close();
    const second = open();
    const record = second.ledger.register(
      JSON.stringify(input()),
      () =>
        ({
          ok: true,
          request: {
            name: 'session.search',
            version: 1,
            sessionId: 's1',
            args: { query: 'teal', limit: 1 },
          },
        }) as never,
    );
    expect(record.state).toBe('validated');
    expect(() =>
      second.database.connection
        .prepare(
          "UPDATE tool_requests SET input_json = '{}' WHERE request_id = ?",
        )
        .run(record.requestId),
    ).toThrow('immutable tool request');
  });

  it('checks owner tokens and immutable identity at the SQLite boundary', async () => {
    const { ledger, sessions, database } = open();
    await sessions.createSession('s1');
    const validation = {
      ok: true as const,
      request: {
        name: 'session.search' as const,
        version: 1 as const,
        sessionId: 's1',
        args: { query: 'teal', limit: 1 },
      },
    };
    const record = ledger.register(JSON.stringify(input()), () => validation);
    expect(() =>
      database.connection
        .prepare(
          "UPDATE tool_requests SET input_json = '{}' WHERE request_id = ?",
        )
        .run(record.requestId),
    ).toThrow('immutable tool request');
    const token = ledger.claimSearch(record.requestId, () => validation)!;
    expect(ledger.claimSearch(record.requestId, () => validation)).toBeNull();
    expect(() =>
      ledger.finishSearch(record.requestId, 'wrong', { ok: true, matches: [] }),
    ).toThrow('claim_lost');
    ledger.finishSearch(record.requestId, token, { ok: true, matches: [] });
    expect(() =>
      ledger.finishSearch(record.requestId, token, { ok: true, matches: [] }),
    ).toThrow('claim_lost');
    const finalToken = ledger.claimFinal(record.requestId)!;
    expect(ledger.claimFinal(record.requestId)).toBeNull();
    const outcome = {
      state: 'failed' as const,
      failure: { code: 'llm_failed' as const },
    };
    expect(() =>
      ledger.finishFinal(record.requestId, 'wrong', outcome),
    ).toThrow('claim_lost');
    ledger.finishFinal(record.requestId, finalToken, outcome);
    expect(() =>
      ledger.finishFinal(record.requestId, finalToken, outcome),
    ).toThrow('claim_lost');
  });

  it('persists sanitized handler failures before final response', async () => {
    const { service, sessions, store } = open();
    await sessions.createSession('s1');
    jest.spyOn(store, 'searchMessages').mockRejectedValue(new Error('secret'));
    const result = await service.consume(input());
    expect(result).toMatchObject({
      state: 'failed',
      execution: { ok: false, failure: { code: 'search_failed' } },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(final).toHaveBeenCalledTimes(1);
  });
});
