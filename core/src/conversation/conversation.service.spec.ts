import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  NotFoundException,
} from '@nestjs/common';
import type { CoreConfig } from '../config';
import { LlmClient, LlmError } from '../llm/llm.client';
import type { StreamSink } from '../llm/llm.client';
import type { LlmResult, LlmToolRequest } from '../llm/llm.protocol';
import { InvalidSearchQueryError } from '../session/session.repository';
import type { ValidatedCandidate } from '../memory/memory-candidate';
import type { NewMemoryCandidate } from '../memory/memory-candidate';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import type { MemoryExtractionInput } from '../memory/memory-candidate-extractor';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import type { MemoryCandidate } from '../memory/memory-candidate';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import { HostHealthProvider } from '../commands/host-health';
import { SkillService } from '../skills/skill.service';
import type {
  ToolExecutionInput,
  ToolExecutionRecord,
} from '../tools/tool-execution.repository';
import type { AgentRun } from '../agent/agent-run.repository';
import { ToolRegistry } from '../tools/tool-registry';
import { ConversationService } from './conversation.service';
import {
  MAX_ITERATIONS,
  MAX_TOOL_STEPS,
  MAX_TURN_DURATION_MS,
  TOOL_STEP_INSTRUCTION,
  turnDeadlineExceeded,
} from './conversation.service';
import { buildPlanningBlock } from '../agent/planning-context';
import type { ConversationStreamEvent } from './conversation.service';
import { FakeSessionRepository } from './fake-session.repository';
import { SessionStore } from './session.store';
import {
  closedTextRecord,
  executingRecord,
  invalidRecord,
  pendingRenameRecord,
  renameProposal,
  searchProposal,
  searchRecord,
  stubAgentRuns,
  stubToolExecution,
  stubToolLlm,
  textProposal,
} from './stub-tool-execution';

function testConfig(overrides: Partial<CoreConfig> = {}): CoreConfig {
  return {
    port: 3000,
    provider: 'ollama',
    llmBaseUrl: 'http://localhost:11434/v1',
    llmModel: 'test-model',
    llmTimeoutMs: 1000,
    systemPrompt: 'test-system',
    maxHistory: 50,
    sessionDbPath: ':memory:',
    memoryDbPath: ':memory:',
    legacyDbPath: '/tmp/icos-test-legacy-missing.sqlite',
    memoryExtractionEnabled: true,
    memoryProvider: 'ollama',
    memoryLlmBaseUrl: 'http://localhost:11434/v1',
    memoryLlmModel: 'test-model',
    memoryLlmTimeoutMs: 1000,
    skillsDirPath: '/tmp/icos-test-skills-missing',
    skillsEnabled: true,
    skillsMaxBodyChars: 12000,
    skillsMaxCatalogItems: 50,
    skillsMaxActivePerSession: 5,
    skillsMaxAutoLoadedPerTurn: 2,
    skillsMaxContextChars: 8000,
    agentMaxIterations: MAX_ITERATIONS,
    agentMaxToolSteps: MAX_TOOL_STEPS,
    agentMaxTurnDurationMs: MAX_TURN_DURATION_MS,
    ...overrides,
  };
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const anyString = expect.any(String) as unknown as string;

function planningBlock(goal: string): string {
  return buildPlanningBlock({
    goal,
    tools: new ToolRegistry().list(),
    maxToolSteps: MAX_TOOL_STEPS,
    maxIterations: MAX_ITERATIONS,
  });
}

function setup(
  config: CoreConfig = testConfig(),
  proposeImpl?: (request: LlmToolRequest) => Promise<LlmResult>,
  proposeStreamImpl?: (
    request: LlmToolRequest,
    sink: StreamSink,
  ) => Promise<LlmResult>,
  extractImpl?: (input: MemoryExtractionInput) => Promise<ValidatedCandidate[]>,
  consumeImpl?: (
    input: ToolExecutionInput,
  ) => Promise<
    import('../tools/tool-execution.repository').ToolExecutionRecord
  >,
) {
  const repository = new FakeSessionRepository();
  const store = new SessionStore(repository, config);
  const { chatWithTools, chatStreamWithTools } = stubToolLlm();
  if (proposeImpl) chatWithTools.mockImplementation(proposeImpl);
  if (proposeStreamImpl)
    chatStreamWithTools.mockImplementation(proposeStreamImpl);
  const llm = { chatWithTools, chatStreamWithTools } as unknown as LlmClient;
  const extract = jest.fn<
    Promise<ValidatedCandidate[]>,
    [MemoryExtractionInput]
  >(extractImpl ?? (() => Promise.resolve([])));
  const extractor = { extract } as unknown as MemoryCandidateExtractor;
  const saveCandidates = jest.fn(
    (items: NewMemoryCandidate[]): Promise<MemoryCandidate[]> =>
      Promise.resolve(
        items.map((item, index) => ({
          ...item,
          id: `c${index}`,
          extractedAt: new Date(0).toISOString(),
        })),
      ),
  );
  const candidates = {
    saveCandidates,
    listCandidates: jest.fn(() => Promise.resolve([])),
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const prefs = new DisplayPreferenceStore();
  const host = {
    collect: jest.fn(() =>
      Promise.resolve({
        os: 'test-os',
        arch: 'x86_64',
        uptimeSeconds: 61,
        cpuCores: 4,
        cpuPercent: 12.5,
        loadAverage: [0.5, 0.4, 0.3],
        memoryUsedBytes: 1024 ** 3,
        memoryTotalBytes: 4 * 1024 ** 3,
        diskUsedBytes: 10 * 1024 ** 3,
        diskTotalBytes: 100 * 1024 ** 3,
        gpu: null,
      }),
    ),
  } as unknown as HostHealthProvider;
  const commands = new CommandDispatcher(
    store,
    candidates,
    prefs,
    host,
    new SkillService(config),
    config,
  );
  const skills = new SkillService(config);
  const tools = stubToolExecution();
  if (consumeImpl) tools.consume.mockImplementation(consumeImpl);
  const registry = new ToolRegistry();
  const agentRuns = stubAgentRuns();
  return {
    service: new ConversationService(
      store,
      llm,
      extractor,
      candidates,
      commands,
      skills,
      tools.service,
      registry,
      agentRuns.service,
      config,
    ),
    repository,
    chatWithTools,
    chatStreamWithTools,
    tools,
    agentRuns,
    extract,
    saveCandidates,
  };
}

describe('ConversationService', () => {
  it('creates a session, offers both tools, and stores history', async () => {
    const { service, repository, chatWithTools, tools } = setup();

    const result = await service.converse('hello');

    expect(result.sessionId).toBeDefined();
    expect(result.requestId).toBeDefined();
    expect(result.status).toBe('ok');
    expect(result.reply).toBe('hi back');
    expect(chatWithTools).toHaveBeenCalledTimes(1);
    const sent = chatWithTools.mock.calls[0][0];
    expect(sent.sessionId).toBe(result.sessionId);
    expect(sent.tools.map((tool) => tool.name).sort()).toEqual([
      'session.rename',
      'session.search',
    ]);
    expect(sent.messages[0]).toEqual({
      role: 'system',
      content: `test-system\n\n${TOOL_STEP_INSTRUCTION}\n\n${planningBlock('hello')}`,
    });
    expect(sent.messages[sent.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hello',
    });
    expect(tools.consume).toHaveBeenCalledTimes(1);
    const consumed = tools.consume.mock.calls[0][0];
    expect(consumed.sessionId).toBe(result.sessionId);
    expect(consumed.allowedTools).toEqual(['session.search', 'session.rename']);
    expect(await repository.getMessages(result.sessionId)).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi back' },
    ]);
  });

  it('frames each turn with goal, tool policies, and budget', async () => {
    const { service, chatWithTools } = setup();

    await service.converse('find teal');

    const sent = chatWithTools.mock.calls[0][0];
    const system = String(sent.messages[0].content);
    expect(system).toContain('Goal for this turn: find teal');
    expect(system).toContain('session.search (runs immediately)');
    expect(system).toContain(
      'session.rename (pauses for human approval and ends your turn)',
    );
    expect(system).toContain('at most 5 tool steps');
  });

  it('continues an existing session and includes prior history', async () => {
    const { service, chatWithTools } = setup();
    const first = await service.converse('first');
    await service.converse('second', first.sessionId);

    const secondCall = chatWithTools.mock.calls[1][0];
    expect(secondCall.sessionId).toBe(first.sessionId);
    expect(secondCall.messages.map((m) => m.content)).toEqual([
      `test-system\n\n${TOOL_STEP_INSTRUCTION}\n\n${planningBlock('second')}`,
      'first',
      'hi back',
      'second',
    ]);
  });

  it('bounds LLM context to maxHistory while persisting everything', async () => {
    const config = testConfig({ maxHistory: 5 });
    const { service, repository, chatWithTools } = setup(config);
    const { sessionId } = await service.converse('seed');
    for (let i = 0; i < 10; i++) {
      await repository.appendMessage(sessionId, {
        role: 'user',
        content: `stored-${i}`,
      });
    }

    await service.converse('latest', sessionId);

    const sent = chatWithTools.mock.calls[1][0];
    // system + last 5 stored + new input.
    expect(sent.messages.map((m) => m.content)).toEqual([
      `test-system\n\n${TOOL_STEP_INSTRUCTION}\n\n${planningBlock('latest')}`,
      'stored-5',
      'stored-6',
      'stored-7',
      'stored-8',
      'stored-9',
      'latest',
    ]);
    expect(await repository.getMessages(sessionId)).toHaveLength(14);
  });

  it('injects durable tool pairs after history with stable ids', async () => {
    const { service, chatWithTools, tools } = setup();
    tools.recentPairs.mockReturnValue([
      {
        invocationId: 'inv-old',
        proposalContent: null,
        name: 'session.search',
        version: 1,
        args: { query: 'teal', limit: 20 },
        result: { ok: true, matches: [] },
      },
    ]);

    await service.converse('again');

    const sent = chatWithTools.mock.calls[0][0];
    const tail = sent.messages.slice(-3);
    expect(tail[0]).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'inv-old', name: 'session.search' }],
    });
    expect(tail[1]).toMatchObject({ role: 'tool', callId: 'inv-old' });
    expect(tail[2]).toEqual({ role: 'user', content: 'again' });
  });

  it('maps LLM timeouts to 504 and other failures to 502', async () => {
    const timeout = setup(testConfig(), () =>
      Promise.reject(new LlmError(504, 'timed out', true)),
    );
    await expect(timeout.service.converse('hi')).rejects.toBeInstanceOf(
      GatewayTimeoutException,
    );

    const failure = setup(testConfig(), () =>
      Promise.reject(new LlmError(502, 'bad', false)),
    );
    await expect(failure.service.converse('hi')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('returns history and 404s unknown sessions', async () => {
    const { service } = setup();
    const { sessionId } = await service.converse('hello');
    expect((await service.history(sessionId)).messages).toHaveLength(2);
    await expect(
      service.history('00000000-0000-0000-0000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists sessions newest-first', async () => {
    const { service } = setup();
    await service.converse('first topic');
    const second = await service.converse('second topic');

    const sessions = await service.listSessions();
    expect(sessions.map((s) => s.sessionId)).toEqual([
      second.sessionId,
      sessions[1]?.sessionId,
    ]);
    expect(sessions[0]).toMatchObject({
      sessionId: second.sessionId,
      messageCount: 2,
      preview: 'second topic',
    });
  });

  it('searches transcripts and maps invalid queries to 400', async () => {
    const { service } = setup();
    const { sessionId } = await service.converse('I like teal');

    const results = await service.searchSessions('teal');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      sessionId,
      role: 'user',
      content: 'I like teal',
    });

    const failing = setup();
    jest
      .spyOn(failing.repository, 'searchMessages')
      .mockRejectedValue(new InvalidSearchQueryError('"'));
    await expect(failing.service.searchSessions('"')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  describe('tool turns', () => {
    it('chains a search step into a text answer with the durable pair', async () => {
      let proposals = 0;
      const { service, repository, extract, tools, chatWithTools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ === 0 ? searchProposal() : textProposal('teal found'),
          ),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );

      const result = await service.converse('find teal');

      expect(result.status).toBe('ok');
      expect(result.reply).toBe('teal found');
      expect(result.tool).toEqual({
        invocationId: 'inv-search-1',
        name: 'session.search',
      });
      // The second proposal saw the first step as an assistant/tool pair.
      expect(chatWithTools).toHaveBeenCalledTimes(2);
      const second = chatWithTools.mock.calls[1][0];
      const tail = second.messages.slice(-2);
      expect(tail[0]).toMatchObject({
        role: 'assistant',
        toolCalls: [{ id: 'inv-search-1', name: 'session.search' }],
      });
      expect(tail[1]).toMatchObject({ role: 'tool', callId: 'inv-search-1' });
      expect(await repository.getMessages(result.sessionId)).toEqual([
        { role: 'user', content: 'find teal' },
        { role: 'assistant', content: 'teal found' },
      ]);
      await flushMicrotasks();
      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract.mock.calls[0][0]).toMatchObject({
        assistantMessage: { role: 'assistant', content: 'teal found' },
      });
      expect(tools.claimTranscript).toHaveBeenCalledWith(result.requestId);
    });

    it('parks rename proposals as approval_required with no writes', async () => {
      const { service, repository, extract, tools } = setup(
        testConfig(),
        () => Promise.resolve(renameProposal()),
        undefined,
        undefined,
        (input) => Promise.resolve(pendingRenameRecord(input)),
      );

      const result = await service.converse('call it Ward');

      expect(result.status).toBe('approval_required');
      expect(result.reply).toContain('needs approval');
      expect(result.tool).toEqual({
        invocationId: 'inv-rename-1',
        name: 'session.rename',
      });
      expect(result.approval).toEqual({
        approvalId: 'appr-1',
        invocationId: 'inv-rename-1',
        tool: 'session.rename',
        args: { title: 'New title' },
      });
      expect(await repository.getMessages(result.sessionId)).toHaveLength(0);
      await flushMicrotasks();
      expect(extract).not.toHaveBeenCalled();
      expect(tools.claimTranscript).not.toHaveBeenCalled();
    });

    it('persists mirrored rejections as system notices without extraction', async () => {
      const { service, repository, extract, agentRuns } = setup(
        testConfig(),
        () => Promise.resolve(renameProposal()),
        undefined,
        undefined,
        (input) =>
          Promise.resolve({ ...pendingRenameRecord(input), state: 'rejected' }),
      );

      const result = await service.converse('call it Ward');

      expect(result.status).toBe('ok');
      expect(result.outcome).toBe('rejected');
      expect(result.reply).toContain('rejected');
      // Denied goals end delivered-but-blocked, not cleanly completed.
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'completed',
        {
          reason: 'approval_denied',
          toolSteps: 0,
        },
      );
      expect(await repository.getMessages(result.sessionId)).toEqual([
        { role: 'user', content: 'call it Ward' },
        { role: 'assistant', content: result.reply },
      ]);
      await flushMicrotasks();
      expect(extract).not.toHaveBeenCalled();
    });

    it('rejects invalid proposals with 502 and stores nothing', async () => {
      const { service, repository, extract } = setup(
        testConfig(),
        (request) => {
          const last = request.messages[request.messages.length - 1];
          if (last.role === 'user' && last.content === 'hello') {
            return Promise.resolve(textProposal());
          }
          return Promise.resolve(searchProposal());
        },
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : invalidRecord(input),
          ),
      );

      const pending = await service.converse('find teal').then(
        () => 'resolved',
        (err: unknown) => err,
      );
      expect(pending).toBeInstanceOf(BadGatewayException);
      const { sessionId } = await service.converse('hello');
      expect(await repository.getMessages(sessionId)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ]);
      await flushMicrotasks();
      expect(extract).toHaveBeenCalledTimes(1);
    });

    it('reports running tools as processing with a resumable id', async () => {
      const { service, repository } = setup(
        testConfig(),
        () => Promise.resolve(searchProposal()),
        undefined,
        undefined,
        (input) => Promise.resolve(executingRecord(input)),
      );

      const result = await service.converse('find teal');

      expect(result.status).toBe('processing');
      expect(result.requestId).toBeDefined();
      expect(await repository.getMessages(result.sessionId)).toHaveLength(0);
    });

    it('finalizes through resume when the step bound is exhausted', async () => {
      let lastInput: ToolExecutionInput | undefined;
      const { service, repository, extract, tools, chatWithTools, agentRuns } =
        setup(
          testConfig(),
          // The model keeps searching, so the bound forces finalization.
          () => Promise.resolve(searchProposal()),
          undefined,
          undefined,
          (input) => {
            lastInput = input;
            return Promise.resolve(searchRecord(input, 'teal found'));
          },
        );
      tools.resume.mockImplementation(() =>
        Promise.resolve({
          ...searchRecord(lastInput as ToolExecutionInput, ''),
          final: {
            state: 'failed' as const,
            failure: { code: 'llm_failed' as const },
          },
        }),
      );
      tools.claimTranscript.mockReturnValueOnce(true).mockReturnValue(false);

      const result = await service.converse('find teal');

      expect(chatWithTools).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1);
      const forced = chatWithTools.mock.calls[MAX_TOOL_STEPS][0];
      expect(forced.tools).toEqual([]);
      expect(forced.toolChoice).toBe('none');
      expect(tools.resume).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('ok');
      expect(result.reply).toContain('could not be completed');
      // The bound forced the answer: delivered, but budget_exhausted.
      // (The mock defies toolChoice:none with a sixth call, which the
      // loop executes once and finalizes; the real parser rejects calls
      // under toolChoice:none before consume ever sees them.)
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'budget_exhausted',
        {
          reason: 'step_bound',
          toolSteps: MAX_TOOL_STEPS + 1,
        },
      );
      expect(result.tool).toEqual({
        invocationId: 'inv-search-1',
        name: 'session.search',
      });
      expect(result.result).toEqual({ ok: true, matches: [] });
      expect(await repository.getMessages(result.sessionId)).toEqual([
        { role: 'user', content: 'find teal' },
        { role: 'assistant', content: result.reply },
      ]);
      const retry = await service.converse('find teal', result.sessionId);
      expect(retry.reply).toBe(result.reply);
      expect(await repository.getMessages(result.sessionId)).toHaveLength(2);
      await flushMicrotasks();
      expect(extract).not.toHaveBeenCalled();
    });

    it('never writes the transcript twice for a retried turn', async () => {
      let proposals = 0;
      const { service, repository, tools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ === 0 ? searchProposal() : textProposal('teal found'),
          ),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );
      tools.claimTranscript.mockReturnValueOnce(true).mockReturnValue(false);

      const first = await service.converse('find teal');
      await service.converse('find teal', first.sessionId);

      expect(await repository.getMessages(first.sessionId)).toEqual([
        { role: 'user', content: 'find teal' },
        { role: 'assistant', content: 'teal found' },
      ]);
    });
  });

  describe('multi-step turns', () => {
    function routeByKind(
      input: ToolExecutionInput,
    ): Promise<
      import('../tools/tool-execution.repository').ToolExecutionRecord
    > {
      if (input.proposal.kind === 'text') {
        return Promise.resolve(closedTextRecord(input));
      }
      if (
        input.proposal.kind === 'tool_calls' &&
        input.proposal.toolCalls[0]?.name === 'session.rename'
      ) {
        return Promise.resolve(pendingRenameRecord(input));
      }
      return Promise.resolve(searchRecord(input, 'teal found'));
    }

    it('parks a rename that follows a search with no writes', async () => {
      const seen: string[] = [];
      const { service, repository, chatWithTools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            seen.length === 0 ? searchProposal() : renameProposal(),
          ),
        undefined,
        undefined,
        (input) => {
          seen.push(input.proposal.kind);
          return routeByKind(input);
        },
      );

      const result = await service.converse('find teal then call it Ward');

      expect(chatWithTools).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('approval_required');
      expect(result.tool).toEqual({
        invocationId: 'inv-rename-1',
        name: 'session.rename',
      });
      expect(result.approval).toMatchObject({
        approvalId: 'appr-1',
        tool: 'session.rename',
      });
      expect(await repository.getMessages(result.sessionId)).toHaveLength(0);
    });

    it('chains after a failed search with the failure observable', async () => {
      let proposals = 0;
      const { service, chatWithTools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ === 0 ? searchProposal() : textProposal('gave up'),
          ),
        undefined,
        undefined,
        (input) => {
          if (input.proposal.kind === 'text') {
            return Promise.resolve(closedTextRecord(input));
          }
          return Promise.resolve({
            ...searchRecord(input, ''),
            state: 'failed' as const,
            execution: {
              ok: false as const,
              failure: { code: 'search_failed' as const },
            },
          });
        },
      );

      const result = await service.converse('find teal');

      // The failed execution still continued the loop instead of dying.
      expect(chatWithTools).toHaveBeenCalledTimes(2);
      const second = chatWithTools.mock.calls[1][0];
      const toolMessage = second.messages.find(
        (message) => message.role === 'tool',
      );
      expect(toolMessage).toMatchObject({ callId: 'inv-search-1' });
      expect(JSON.parse(toolMessage?.content ?? '{}')).toEqual({
        ok: false,
        failure: { code: 'search_failed' },
      });
      expect(result.status).toBe('ok');
      expect(result.reply).toBe('gave up');
    });

    it('forces a text answer and a time terminal past the deadline', async () => {
      const start = 1_000_000;
      let now = start;
      const dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
      try {
        let lastInput: ToolExecutionInput | undefined;
        const { service, agentRuns, tools } = setup(
          testConfig(),
          () => Promise.resolve(searchProposal()),
          undefined,
          undefined,
          (input) => {
            lastInput = input;
            // The clock jumps past the deadline after the first step.
            now = start + MAX_TURN_DURATION_MS + 1;
            return Promise.resolve(searchRecord(input, 'teal found'));
          },
        );
        tools.resume.mockImplementation(() =>
          Promise.resolve(
            searchRecord(lastInput as ToolExecutionInput, 'late answer'),
          ),
        );

        const result = await service.converse('find teal');

        expect(result.status).toBe('ok');
        expect(result.reply).toBe('late answer');
        expect(agentRuns.markTerminal).toHaveBeenCalledWith(
          'run-1',
          'budget_exhausted',
          {
            reason: 'time_budget',
            toolSteps: 2,
          },
        );
      } finally {
        dateSpy.mockRestore();
      }
    });

    it('enforces the iteration budget independently of tool count', async () => {
      let lastInput: ToolExecutionInput | undefined;
      const { service, agentRuns, tools, chatWithTools } = setup(
        testConfig({ agentMaxIterations: 2, agentMaxToolSteps: 5 }),
        () => Promise.resolve(searchProposal()),
        undefined,
        undefined,
        (input) => {
          lastInput = input;
          return Promise.resolve(searchRecord(input, 'teal found'));
        },
      );
      tools.resume.mockImplementation(() =>
        Promise.resolve(
          searchRecord(lastInput as ToolExecutionInput, 'forced done'),
        ),
      );

      const result = await service.converse('find teal');

      // Two normal rounds, then the iteration bound forces text.
      expect(chatWithTools).toHaveBeenCalledTimes(3);
      const forced = chatWithTools.mock.calls[2][0];
      expect(forced.tools).toEqual([]);
      expect(forced.toolChoice).toBe('none');
      expect(result.reply).toBe('forced done');
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'budget_exhausted',
        {
          reason: 'step_bound',
          toolSteps: 3,
        },
      );
    });

    it('enforces the tool-call budget independently of rounds', async () => {
      let lastInput: ToolExecutionInput | undefined;
      const { service, agentRuns, tools, chatWithTools } = setup(
        testConfig({ agentMaxIterations: 10, agentMaxToolSteps: 2 }),
        () => Promise.resolve(searchProposal()),
        undefined,
        undefined,
        (input) => {
          lastInput = input;
          return Promise.resolve(searchRecord(input, 'teal found'));
        },
      );
      tools.resume.mockImplementation(() =>
        Promise.resolve(
          searchRecord(lastInput as ToolExecutionInput, 'forced done'),
        ),
      );

      const result = await service.converse('find teal');

      // Two executions, then the tool budget forces text on round three.
      expect(chatWithTools).toHaveBeenCalledTimes(3);
      expect(result.reply).toBe('forced done');
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'budget_exhausted',
        {
          reason: 'step_bound',
          toolSteps: 3,
        },
      );
    });

    it('still rejects fan-out proposals without executing anything', async () => {
      const fanOut = {
        ...searchProposal(),
        toolCalls: [
          searchProposal().toolCalls[0],
          searchProposal().toolCalls[0],
        ],
      };
      const { service, extract, tools, chatWithTools } = setup(
        testConfig(),
        () => Promise.resolve(fanOut),
        undefined,
        undefined,
        (input) => Promise.resolve(invalidRecord(input)),
      );

      await expect(service.converse('find everything')).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      // Recovery retried every round up to the bound, then failed closed:
      // six proposals, six consumes, zero executions.
      expect(chatWithTools).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1);
      expect(tools.consume).toHaveBeenCalledTimes(MAX_TOOL_STEPS + 1);
      await flushMicrotasks();
      expect(extract).not.toHaveBeenCalled();
    });

    it('streams per-step tool events with a single terminal done', async () => {
      let proposals = 0;
      const { service } = setup(
        testConfig(),
        undefined,
        () =>
          Promise.resolve(
            proposals++ < 2 ? searchProposal() : textProposal('both found'),
          ),
        undefined,
        (input) => routeByKind(input),
      );
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('find both', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta' });
      // Two step-progress events plus the terminal emit for the last tool.
      expect(events.filter((event) => event.type === 'tool')).toHaveLength(3);
      expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        reply: 'both found',
        status: 'ok',
        tool: { invocationId: 'inv-search-1', name: 'session.search' },
      });
    });
  });

  describe('agent runs', () => {
    it('bounds turn duration with a pure deadline check', () => {
      const start = 1_000_000;
      expect(turnDeadlineExceeded(start, start)).toBe(false);
      expect(turnDeadlineExceeded(start, start + MAX_TURN_DURATION_MS)).toBe(
        false,
      );
      expect(
        turnDeadlineExceeded(start, start + MAX_TURN_DURATION_MS + 1),
      ).toBe(true);
    });
    it('records steps and terminal state for a text turn', async () => {
      const { service, agentRuns } = setup();

      const result = await service.converse('hello');

      expect(agentRuns.createRun).toHaveBeenCalledWith({
        sessionId: result.sessionId,
        goal: 'hello',
        limits: {
          maxIterations: MAX_ITERATIONS,
          maxToolSteps: MAX_TOOL_STEPS,
          maxTurnDurationMs: MAX_TURN_DURATION_MS,
        },
      });
      expect(agentRuns.transitionRun).toHaveBeenCalledWith(
        'run-1',
        'reasoning',
      );
      expect(agentRuns.recordStep).toHaveBeenCalledWith('run-1', {
        requestId: result.requestId,
        toolCalls: 0,
      });
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 0,
        },
      );
      expect(agentRuns.markParked).not.toHaveBeenCalled();
    });

    it('walks reasoning to observing across chained searches', async () => {
      let proposals = 0;
      const { service, agentRuns } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ < 2 ? searchProposal() : textProposal('both found'),
          ),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );

      const result = await service.converse('find both');

      expect(result.status).toBe('ok');
      expect(agentRuns.transitionRun.mock.calls.map((call) => call[1])).toEqual(
        [
          'reasoning',
          'action_proposed',
          'executing',
          'observing',
          'reasoning',
          'action_proposed',
          'executing',
          'observing',
          'reasoning',
        ],
      );
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 2,
        },
      );
    });

    it('records parked runs with the approval pointer', async () => {
      const { service, agentRuns } = setup(
        testConfig(),
        () => Promise.resolve(renameProposal()),
        undefined,
        undefined,
        (input) => Promise.resolve(pendingRenameRecord(input)),
      );

      const result = await service.converse('call it Ward');

      expect(result.status).toBe('approval_required');
      expect(agentRuns.markParked).toHaveBeenCalledWith('run-1', 'appr-1');
      expect(agentRuns.markTerminal).not.toHaveBeenCalled();
    });

    it('completes the parked run on resume', async () => {
      const { service, agentRuns, tools } = setup();
      agentRuns.findByRequest.mockReturnValue({ id: 'run-9' });
      tools.resume.mockImplementation((requestId: string) =>
        Promise.resolve(
          searchRecord(
            {
              requestId,
              sessionId: 's-1',
              context: [{ role: 'user', content: 'find teal' }],
              allowedTools: ['session.search'],
              proposal: searchProposal(),
            },
            'teal found',
          ),
        ),
      );

      const result = await service.resumeTurn('req-1', 's-1');

      expect(result.status).toBe('ok');
      expect(agentRuns.findByRequest).toHaveBeenCalledWith('s-1', 'req-1');
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-9',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 0,
        },
      );
    });

    it('marks failed runs without failing the turn outcome path', async () => {
      const { service, agentRuns } = setup(testConfig(), () =>
        Promise.reject(new Error('provider down')),
      );

      await expect(service.converse('hello')).rejects.toThrow('provider down');
      expect(agentRuns.markTerminal).toHaveBeenCalledWith('run-1', 'failed', {
        reason: 'turn_error',
        toolSteps: 0,
      });
    });

    it('tracking failures never fail the turn', async () => {
      const { service, repository, agentRuns } = setup();
      agentRuns.createRun.mockImplementationOnce(() => {
        throw new Error('store down');
      });

      const result = await service.converse('hello');

      expect(result.status).toBe('ok');
      expect(result.reply).toBe('hi back');
      expect(await repository.getMessages(result.sessionId)).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ]);
    });
  });

  describe('resume continuation', () => {
    function testRun(overrides: Partial<AgentRun> = {}): AgentRun {
      return {
        id: 'run-9',
        sessionId: 's-1',
        goal: 'rename it',
        state: 'awaiting_approval',
        requestIds: ['req-0'],
        currentRequestId: 'req-0',
        iterationCount: 1,
        toolCallCount: 1,
        limits: {
          maxIterations: MAX_ITERATIONS,
          maxToolSteps: MAX_TOOL_STEPS,
          maxTurnDurationMs: MAX_TURN_DURATION_MS,
        },
        approvalId: 'appr-1',
        termination: null,
        createdAt: 't',
        updatedAt: 't',
        ...overrides,
      };
    }

    function renameInput(requestId: string): ToolExecutionInput {
      return {
        requestId,
        sessionId: 's-1',
        context: [{ role: 'user', content: 'rename it' }],
        allowedTools: ['session.search', 'session.rename'],
        proposal: renameProposal(),
      };
    }

    function approvedRename(): ToolExecutionRecord {
      return {
        ...pendingRenameRecord(renameInput('req-1')),
        state: 'succeeded',
        execution: { ok: true, renamed: { sessionId: 's-1', title: 'Ward' } },
        final: { state: 'pending' },
      };
    }

    it('plans again after an approved rename instead of ending', async () => {
      const { service, repository, agentRuns, tools } = setup(
        testConfig(),
        () => Promise.resolve(textProposal('renamed and reported')),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );
      agentRuns.findByRequest.mockReturnValue(testRun());
      tools.resume.mockImplementation(() => Promise.resolve(approvedRename()));

      const result = await service.resumeTurn('req-1', 's-1');

      expect(result.status).toBe('ok');
      expect(result.reply).toBe('renamed and reported');
      // The continuation step was recorded on the same run.
      expect(agentRuns.recordStep).toHaveBeenCalledWith(
        'run-9',
        expect.objectContaining({ toolCalls: 0 }),
      );
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-9',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 1,
        },
      );
      expect(await repository.getMessages('s-1')).toEqual([
        { role: 'user', content: 'rename it' },
        { role: 'assistant', content: 'renamed and reported' },
      ]);
    });

    it('recovers from invalid proposals inside resume continuation', async () => {
      let proposals = 0;
      const { service, agentRuns, tools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ === 0
              ? {
                  ...searchProposal(),
                  toolCalls: [
                    {
                      ...searchProposal().toolCalls[0],
                      rawArguments: '{"query":"","limit":20}',
                      args: { query: '', limit: 20 },
                    },
                  ],
                }
              : textProposal('renamed and reported'),
          ),
        undefined,
        undefined,
        (input) => {
          if (input.proposal.kind === 'text') {
            return Promise.resolve(closedTextRecord(input));
          }
          const call = input.proposal.toolCalls[0];
          if (!call || (call.args as { query?: unknown }).query === '') {
            return Promise.resolve(invalidRecord(input, 'invalid_args'));
          }
          return Promise.resolve(searchRecord(input, 'teal found'));
        },
      );
      agentRuns.findByRequest.mockReturnValue(testRun());
      tools.resume.mockImplementation(() => Promise.resolve(approvedRename()));

      const result = await service.resumeTurn('req-1', 's-1');

      // Invalid step recovered, then the text answer completed the run.
      expect(result.status).toBe('ok');
      expect(result.reply).toBe('renamed and reported');
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-9',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 1,
        },
      );
    });

    it('reconsiders after a rejection instead of dying on the notice', async () => {
      const { service, repository, agentRuns, tools } = setup(
        testConfig(),
        () => Promise.resolve(textProposal('leaving the name as is')),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );
      agentRuns.findByRequest.mockReturnValue(testRun());
      tools.resume.mockImplementation(() =>
        Promise.resolve({
          ...pendingRenameRecord(renameInput('req-1')),
          state: 'rejected',
        }),
      );

      const result = await service.resumeTurn('req-1', 's-1');

      // The agent answers from the denial observation; no mirror text
      // is persisted as the turn.
      expect(result.status).toBe('ok');
      expect(result.outcome).toBeUndefined();
      expect(result.reply).toBe('leaving the name as is');
      expect(await repository.getMessages('s-1')).toEqual([
        { role: 'user', content: 'rename it' },
        { role: 'assistant', content: 'leaving the name as is' },
      ]);
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-9',
        'completed',
        {
          reason: 'final_answer',
          toolSteps: 1,
        },
      );
    });

    it('re-parks when the continuation proposes another mutation', async () => {
      const { service, repository, agentRuns, tools } = setup(
        testConfig(),
        () => Promise.resolve(renameProposal('Ward again')),
        undefined,
        undefined,
        (input) => Promise.resolve(pendingRenameRecord(input)),
      );
      agentRuns.findByRequest.mockReturnValue(testRun());
      tools.resume.mockImplementation(() => Promise.resolve(approvedRename()));

      const result = await service.resumeTurn('req-1', 's-1');

      // A new invocation needs a new authorization decision.
      expect(result.status).toBe('approval_required');
      expect(result.approval?.approvalId).toBe('appr-1');
      expect(agentRuns.markParked).toHaveBeenCalledWith('run-9', 'appr-1');
      expect(await repository.getMessages('s-1')).toHaveLength(0);
    });

    it('streams continuation steps with a single terminal done', async () => {
      let proposals = 0;
      const { service, agentRuns, tools } = setup(
        testConfig(),
        undefined,
        () =>
          Promise.resolve(
            proposals++ === 0
              ? searchProposal()
              : textProposal('searched after rename'),
          ),
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );
      agentRuns.findByRequest.mockReturnValue(testRun());
      tools.resume.mockImplementation(() => Promise.resolve(approvedRename()));
      const events: ConversationStreamEvent[] = [];

      await service.resumeStream('req-1', 's-1', (event) => events.push(event));

      expect(events[0]).toMatchObject({ type: 'meta' });
      expect(events.filter((event) => event.type === 'tool')).toHaveLength(2);
      expect(events.filter((event) => event.type === 'done')).toHaveLength(1);
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        reply: 'searched after rename',
        status: 'ok',
      });
    });
  });

  describe('invalid proposal recovery', () => {
    function badArgsProposal() {
      const call = searchProposal().toolCalls[0];
      return {
        ...searchProposal(),
        toolCalls: [
          {
            ...call,
            rawArguments: '{"query":"teal","limit":9999}',
            args: { query: 'teal', limit: 9999 },
          },
        ],
      };
    }

    it('recovers from a rejected call with corrected arguments', async () => {
      let proposals = 0;
      const { service, repository, chatWithTools } = setup(
        testConfig(),
        () =>
          Promise.resolve(
            proposals++ === 0 ? badArgsProposal() : textProposal('found it'),
          ),
        undefined,
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : invalidRecord(input, 'invalid_args'),
          ),
      );

      const result = await service.converse('find teal');

      expect(result.status).toBe('ok');
      expect(result.reply).toBe('found it');
      // The second proposal saw the validation failure as a tool error.
      expect(chatWithTools).toHaveBeenCalledTimes(2);
      const second = chatWithTools.mock.calls[1][0];
      const errors = second.messages.filter(
        (message) => message.role === 'tool',
      );
      expect(errors).toHaveLength(1);
      expect(JSON.parse(String(errors[0].content))).toMatchObject({
        ok: false,
        failure: { code: 'invalid_args' },
      });
      expect(await repository.getMessages(result.sessionId)).toEqual([
        { role: 'user', content: 'find teal' },
        { role: 'assistant', content: 'found it' },
      ]);
    });

    it('recovers from a fan-out with sequential single calls', async () => {
      const fanOut = {
        ...searchProposal(),
        toolCalls: [
          searchProposal().toolCalls[0],
          searchProposal().toolCalls[0],
        ],
      };
      const calls: string[] = [];
      const { service, chatWithTools } = setup(
        testConfig(),
        () => {
          calls.push('propose');
          if (calls.length === 1) return Promise.resolve(fanOut);
          if (calls.length === 2) return Promise.resolve(searchProposal());
          return Promise.resolve(textProposal('both searched'));
        },
        undefined,
        undefined,
        (input) => {
          if (input.proposal.kind === 'text') {
            return Promise.resolve(closedTextRecord(input));
          }
          const proposed = input.proposal.toolCalls;
          if (proposed.length !== 1) {
            return Promise.resolve(invalidRecord(input, 'invalid_call_count'));
          }
          return Promise.resolve(searchRecord(input, 'teal found'));
        },
      );

      const result = await service.converse('find everything');

      // Fan-out rejected, then a sequential search, then an answer —
      // the exact production incident, recovered instead of 502ing.
      expect(result.status).toBe('ok');
      expect(result.reply).toBe('both searched');
      expect(chatWithTools).toHaveBeenCalledTimes(3);
      const second = chatWithTools.mock.calls[1][0];
      const echoes = second.messages.filter(
        (message) => message.role === 'tool',
      );
      expect(echoes).toHaveLength(2);
    });
  });

  describe('resumeTurn', () => {
    function resumeInput(requestId: string): ToolExecutionInput {
      return {
        requestId,
        sessionId: 's-1',
        context: [{ role: 'user', content: 'find teal' }],
        allowedTools: ['session.search'],
        proposal: searchProposal(),
      };
    }

    it('returns the durable outcome and persists the turn once', async () => {
      const { service, repository, tools } = setup();
      tools.resume.mockImplementation((requestId: string) =>
        Promise.resolve(searchRecord(resumeInput(requestId), 'teal found')),
      );

      const result = await service.resumeTurn('req-1', 's-1');

      expect(result.status).toBe('ok');
      expect(result.reply).toBe('teal found');
      expect(result.tool?.invocationId).toBe('inv-search-1');
      expect(await repository.getMessages('s-1')).toEqual([
        { role: 'user', content: 'find teal' },
        { role: 'assistant', content: 'teal found' },
      ]);
    });

    it('maps unknown requests to 404 and foreign sessions to 400', async () => {
      const { service } = setup();
      await expect(service.resumeTurn('nope', 's-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      const foreign = setup();
      foreign.tools.resume.mockRejectedValue(new Error('invalid_session'));
      await expect(
        foreign.service.resumeTurn('req-1', 'other'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('converseStream', () => {
    it('emits meta, tokens, done in order and stores history', async () => {
      const { service, repository } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('hello', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta' });
      const sessionId =
        events[0].type === 'meta' ? events[0].sessionId : undefined;
      expect(events.slice(1, -1)).toEqual([
        { type: 'token', content: 'hi ' },
        { type: 'token', content: 'back' },
      ]);
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        reply: 'hi back',
        model: 'm',
        status: 'ok',
      });
      expect(sessionId).toBeDefined();
      expect(await repository.getMessages(sessionId ?? '')).toEqual([
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi back' },
      ]);
    });

    it('emits error and stores nothing when the LLM fails', async () => {
      const { service, repository } = setup(testConfig(), undefined, () =>
        Promise.reject(new LlmError(502, 'boom', false)),
      );
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('hello', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]?.type).toBe('meta');
      expect(events[1]).toMatchObject({ type: 'error', message: 'boom' });
      expect(events).toHaveLength(2);
      const sessionId = events[0].type === 'meta' ? events[0].sessionId : '';
      expect(await repository.getMessages(sessionId)).toHaveLength(0);
    });

    it('marks the run cancelled when the client disconnects', async () => {
      const { service, agentRuns } = setup(testConfig(), undefined, () =>
        Promise.reject(new Error('aborted')),
      );
      const controller = new AbortController();
      controller.abort();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream(
        'hello',
        undefined,
        (event) => events.push(event),
        controller.signal,
      );

      expect(events[events.length - 1]).toMatchObject({ type: 'error' });
      expect(agentRuns.markTerminal).toHaveBeenCalledWith(
        'run-1',
        'cancelled',
        {
          reason: 'cancelled',
          toolSteps: 0,
        },
      );
    });

    it('emits tool then done for executed searches', async () => {
      let proposals = 0;
      const { service } = setup(
        testConfig(),
        undefined,
        (_request, sink) => {
          sink.onToken('looking ');
          return Promise.resolve(
            proposals++ === 0 ? searchProposal() : textProposal('teal found'),
          );
        },
        undefined,
        (input) =>
          Promise.resolve(
            input.proposal.kind === 'text'
              ? closedTextRecord(input)
              : searchRecord(input, 'teal found'),
          ),
      );
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('find teal', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta' });
      expect(events).toContainEqual({ type: 'token', content: 'looking ' });
      expect(events).toContainEqual({
        type: 'tool',
        invocationId: 'inv-search-1',
        name: 'session.search',
        state: 'succeeded',
      });
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        reply: 'teal found',
        status: 'ok',
        tool: { invocationId: 'inv-search-1', name: 'session.search' },
      });
    });

    it('emits approval then done for parked renames', async () => {
      const { service, repository } = setup(
        testConfig(),
        () => Promise.resolve(renameProposal()),
        () => Promise.resolve(renameProposal()),
        undefined,
        (input) => Promise.resolve(pendingRenameRecord(input)),
      );
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('call it Ward', undefined, (event) =>
        events.push(event),
      );

      expect(events).toContainEqual({
        type: 'approval',
        approval: {
          approvalId: 'appr-1',
          invocationId: 'inv-rename-1',
          tool: 'session.rename',
          args: { title: 'New title' },
        },
        requestId: anyString,
      });
      expect(events[events.length - 1]).toMatchObject({
        type: 'done',
        status: 'approval_required',
        approval: { approvalId: 'appr-1' },
      });
      const sessionId = events[0].type === 'meta' ? events[0].sessionId : '';
      expect(await repository.getMessages(sessionId)).toHaveLength(0);
    });
  });

  describe('memory extraction', () => {
    const preference: ValidatedCandidate = {
      kind: 'preference',
      subject: 'user',
      predicate: 'prefers',
      object: 'TypeScript',
      confidence: 0.94,
      importance: 0.72,
      stability: 0.88,
    };

    it('persists validated candidates with provenance after a turn', async () => {
      const { service, extract, saveCandidates } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.resolve([preference]),
      );

      const { sessionId } = await service.converse('I prefer TypeScript');
      await flushMicrotasks();

      expect(extract).toHaveBeenCalledTimes(1);
      expect(extract.mock.calls[0][0]).toMatchObject({
        sessionId,
        userMessage: { role: 'user', content: 'I prefer TypeScript' },
        assistantMessage: { role: 'assistant', content: 'hi back' },
      });
      expect(saveCandidates).toHaveBeenCalledTimes(1);
      expect(saveCandidates.mock.calls[0][0]).toEqual([
        {
          ...preference,
          source: { sessionId, messageId: 1 },
          extractorModel: 'test-model',
          extractorVersion: 'memory-extraction-v1',
        },
      ]);
    });

    it('extracts after streamed turns too', async () => {
      const { service, extract } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.resolve([preference]),
      );

      await service.converseStream('hello', undefined, () => {});
      await flushMicrotasks();

      expect(extract).toHaveBeenCalledTimes(1);
    });

    it('lets the conversation succeed when extraction fails', async () => {
      const { service, extract, saveCandidates } = setup(
        testConfig(),
        undefined,
        undefined,
        () => Promise.reject(new Error('extractor down')),
      );

      const result = await service.converse('hello');
      await flushMicrotasks();

      expect(result.reply).toBe('hi back');
      expect(extract).toHaveBeenCalledTimes(1);
      expect(saveCandidates).not.toHaveBeenCalled();
    });

    it('skips extraction when disabled', async () => {
      const { service, extract } = setup(
        testConfig({ memoryExtractionEnabled: false }),
      );

      await service.converse('hello');
      await flushMicrotasks();

      expect(extract).not.toHaveBeenCalled();
    });
  });

  describe('slash commands', () => {
    it('answers commands without touching the LLM, transcript, or extraction', async () => {
      const { service, repository, chatWithTools, extract, saveCandidates } =
        setup();

      const result = await service.converse('/health');

      expect(result.model).toBe('core');
      expect(result.reply).toContain('Core: healthy');
      expect(result.reply).toContain('Host System');
      expect(result.reply).toContain('Status: healthy');
      expect(result.command).toMatchObject({ kind: 'data' });
      expect(chatWithTools).not.toHaveBeenCalled();
      expect(extract).not.toHaveBeenCalled();
      await flushMicrotasks();
      expect(saveCandidates).not.toHaveBeenCalled();
      // No session conjured into existence as a side effect.
      expect(await repository.listSessions()).toHaveLength(0);
    });

    it('switches sessions on /new without deleting history', async () => {
      const { service, repository, chatWithTools } = setup();
      const first = await service.converse('hello');

      const created = await service.converse('/new', first.sessionId);

      expect(created.sessionId).not.toBe(first.sessionId);
      expect(created.command).toMatchObject({ kind: 'session' });
      expect(chatWithTools).toHaveBeenCalledTimes(1);
      expect(await repository.getMessages(first.sessionId)).toHaveLength(2);
    });

    it('rejects unknown and malformed commands without LLM contact', async () => {
      const { service, chatWithTools } = setup();

      await expect(service.converse('/nope')).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.converse('/')).rejects.toThrow(BadRequestException);
      expect(chatWithTools).not.toHaveBeenCalled();
    });

    it('streams commands as meta then done with no tokens', async () => {
      const { service, chatStreamWithTools } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/health', undefined, (event) =>
        events.push(event),
      );

      expect(chatStreamWithTools).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'token')).toBe(false);
      const done = events[events.length - 1];
      expect(done.type).toBe('done');
      if (done.type === 'done') {
        expect(done.model).toBe('core');
        expect(done.reply).toContain('Core: healthy');
        expect(done.command).toMatchObject({ kind: 'data' });
      }
    });

    it('streams /new with a meta session switch', async () => {
      const { service } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/new', undefined, (event) =>
        events.push(event),
      );

      expect(events[0]).toMatchObject({ type: 'meta', model: 'core' });
      const switched =
        events[0].type === 'meta' ? events[0].sessionId : undefined;
      expect(switched).toBeDefined();
      expect(events[events.length - 1]).toMatchObject({ type: 'done' });
    });

    it('streams command errors as error events', async () => {
      const { service, chatStreamWithTools } = setup();
      const events: ConversationStreamEvent[] = [];

      await service.converseStream('/nope', undefined, (event) =>
        events.push(event),
      );

      expect(chatStreamWithTools).not.toHaveBeenCalled();
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'error' });
    });
  });
});
