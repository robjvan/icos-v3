import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CoreConfig } from '../config';
import { CommandDispatcher } from '../commands/command-dispatcher';
import { DisplayPreferenceStore } from '../commands/display-preferences';
import type { HostHealthProvider } from '../commands/host-health';
import { LlmClient } from '../llm/llm.client';
import type { LlmResult, LlmToolRequest } from '../llm/llm.protocol';
import { MemoryCandidateExtractor } from '../memory/memory-candidate-extractor';
import type { MemoryExtractionInput } from '../memory/memory-candidate-extractor';
import type { ValidatedCandidate } from '../memory/memory-candidate';
import { MemoryCandidateRepository } from '../memory/memory-candidate.repository';
import { PromotionService } from '../memory/promotion.service';
import { SKILL_FILE } from '../skills/skill-loader';
import { SkillService } from '../skills/skill.service';
import { ToolRegistry } from '../tools/tool-registry';
import { ConversationService } from './conversation.service';
import {
  MAX_ITERATIONS,
  MAX_TOOL_STEPS,
  MAX_TURN_DURATION_MS,
  TOOL_STEP_INSTRUCTION,
} from './conversation.service';
import { buildPlanningBlock } from '../agent/planning-context';
import { FakeSessionRepository } from './fake-session.repository';
import { SessionStore } from './session.store';
import {
  stubAgentRuns,
  stubToolExecution,
  stubToolLlm,
} from './stub-tool-execution';

function testConfig(
  skillsDirPath: string,
  overrides: Partial<CoreConfig> = {},
): CoreConfig {
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
    memoryPromotionAuto: false,
    memoryPromotionAutoKinds: [],
    vectorDbPath: '/tmp/icos-test-claims-vector.db',
    skillsDirPath,
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

function writeSkill(
  dir: string,
  entry: string,
  name: string,
  description: string,
  body: string,
): void {
  mkdirSync(join(dir, entry), { recursive: true });
  writeFileSync(
    join(dir, entry, SKILL_FILE),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

async function setup(
  dir: string,
  overrides: Partial<CoreConfig> = {},
  proposeImpl?: (request: LlmToolRequest) => Promise<LlmResult>,
) {
  const config = testConfig(dir, overrides);
  const repository = new FakeSessionRepository();
  const store = new SessionStore(repository, config);
  const { chatWithTools, chatStreamWithTools } = stubToolLlm();
  if (proposeImpl) chatWithTools.mockImplementation(proposeImpl);
  const chat = chatWithTools;
  const chatStream = chatStreamWithTools;
  const llm = { chatWithTools, chatStreamWithTools } as unknown as LlmClient;
  const extract = jest.fn<
    Promise<ValidatedCandidate[]>,
    [MemoryExtractionInput]
  >(() => Promise.resolve([]));
  const extractor = { extract } as unknown as MemoryCandidateExtractor;
  const candidates = {
    saveCandidates: jest.fn(() => Promise.resolve([])),
    ping: jest.fn(() => Promise.resolve()),
  } as unknown as MemoryCandidateRepository;
  const prefs = new DisplayPreferenceStore();
  const host = {
    collect: jest.fn(() => Promise.resolve({})),
  } as unknown as HostHealthProvider;
  const skills = new SkillService(config);
  await skills.onModuleInit();
  const commands = new CommandDispatcher(
    store,
    candidates,
    prefs,
    host,
    skills,
    config,
  );
  const service = new ConversationService(
    store,
    llm,
    extractor,
    candidates,
    commands,
    skills,
    stubToolExecution().service,
    new ToolRegistry(),
    stubAgentRuns().service,
    config,
    {
      proposeCandidates: () => Promise.resolve([]),
    } as unknown as PromotionService,
  );
  return {
    service,
    repository,
    store,
    chat,
    chatStream,
    extract,
    skills,
    config,
  };
}

describe('ConversationService skill injection (M7c)', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-conv-skills-'));
    writeSkill(
      dir,
      'daily-journal',
      'daily-journal',
      'Journal about the day.',
      'Ask one question at a time.',
    );
    writeSkill(
      dir,
      'capture-idea',
      'capture-idea',
      'Capture an idea.',
      'Restate the claim.',
    );
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function sentMessages(
    chat: jest.Mock<Promise<LlmResult>, [LlmToolRequest]>,
  ): { role: string; content: string }[] {
    return chat.mock.calls[0][0].messages as {
      role: string;
      content: string;
    }[];
  }

  it('injects the catalog block plus explicit bodies with scopes', async () => {
    const { service, chat, skills } = await setup(dir);
    const first = await service.converse('hello');
    skills.useSkill(first.sessionId, 'daily-journal');
    await service.converse('journal time', first.sessionId);

    const messages = chat.mock.calls[1][0].messages as {
      role: string;
      content: string;
    }[];
    expect(messages[0]?.content).toContain('<available_skills>');
    expect(messages[0]?.content).toContain('- daily-journal:');
    expect(messages[1]).toEqual({
      role: 'system',
      content:
        '<skill name="daily-journal" scope="explicit">\nAsk one question at a time.\n</skill>',
    });
    // "journal time" also discovers daily-journal, but it is already
    // included — no duplicate injection.
    expect(messages.filter((m) => m.content.includes('<skill '))).toHaveLength(
      1,
    );
  });

  it('auto-discovers contextual skills for matching turns only', async () => {
    const { service, chat, skills } = await setup(dir);
    const first = await service.converse('we need to capture this idea');
    const matched = sentMessages(chat);
    expect(
      matched.find((m) => m.content.includes('scope="contextual"')),
    ).toEqual({
      role: 'system',
      content:
        '<skill name="capture-idea" scope="contextual">\nRestate the claim.\n</skill>',
    });

    await service.converse('sourdough starter ratios', first.sessionId);
    const bread = chat.mock.calls[1][0].messages as {
      role: string;
      content: string;
    }[];
    expect(bread.some((m) => m.content.includes('<skill '))).toBe(false);
    // Turn-scoped means never pinned.
    expect(skills.getExplicitNames(first.sessionId)).toEqual([]);
    const last = skills.getLastTurn(first.sessionId);
    expect(last?.contextual).toEqual([]);
    expect(last?.considered).toEqual([]);
  });

  it('injects staged one-shots once with turn-explicit scope', async () => {
    const { service, chat, skills } = await setup(dir);
    const first = await service.converse('hello');
    await skills.stageOneShot(first.sessionId, 'daily-journal');
    await service.converse('anything at all', first.sessionId);
    const staged = chat.mock.calls[1][0].messages as {
      role: string;
      content: string;
    }[];
    expect(
      staged.find((m) => m.content.includes('scope="turn-explicit"')),
    ).toBeDefined();
    await service.converse('unrelated follow-up', first.sessionId);
    const after = chat.mock.calls[2][0].messages as {
      role: string;
      content: string;
    }[];
    expect(after.some((m) => m.content.includes('<skill '))).toBe(false);
    expect(skills.getExplicitNames(first.sessionId)).toEqual([]);
  });

  it('sends identical message arrays on streaming and non-streaming paths', async () => {
    const streamed = await setup(dir);
    const plain = await setup(dir);
    const streamFirst = await streamed.service.converse('hello');
    streamed.skills.useSkill(streamFirst.sessionId, 'daily-journal');
    const plainFirst = await plain.service.converse('hello');
    plain.skills.useSkill(plainFirst.sessionId, 'daily-journal');

    await streamed.service.converseStream(
      'journal time',
      streamFirst.sessionId,
      () => undefined,
    );
    await plain.service.converse('journal time', plainFirst.sessionId);

    const viaStream = streamed.chatStream.mock.calls[0][0]
      .messages as unknown[];
    const viaChat = plain.chat.mock.calls[1][0].messages as unknown[];
    expect(viaStream).toEqual(viaChat);
  });

  it('keeps skill content out of the transcript and extractor input', async () => {
    const { service, repository, extract, skills } = await setup(dir);
    const first = await service.converse('capture this idea now');
    const stored = await repository.getMessages(first.sessionId);
    expect(JSON.stringify(stored)).not.toContain('<skill');
    expect(JSON.stringify(stored)).not.toContain('Restate the claim.');
    expect(extract).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(extract.mock.calls[0][0])).not.toContain('<skill');
    expect(skills.getLastTurn(first.sessionId)?.contextual).toEqual([
      'capture-idea',
    ]);
  });

  it('records no report and stores nothing when the turn fails', async () => {
    const failing = await setup(dir, {}, () =>
      Promise.reject(new Error('upstream down')),
    );
    const { id } = await failing.store.resolve(undefined);
    await expect(
      failing.service.converse('journal time', id),
    ).rejects.toThrow();
    expect(failing.skills.getLastTurn(id)).toBeNull();
    expect(await failing.repository.getMessages(id)).toEqual([]);
  });

  it('disabled mode injects no skill content', async () => {
    const { service, chat } = await setup(dir, { skillsEnabled: false });
    await service.converse('hello');
    expect(sentMessages(chat)).toEqual([
      {
        role: 'system',
        content: `test-system\n\n${TOOL_STEP_INSTRUCTION}\n\n${buildPlanningBlock(
          {
            goal: 'hello',
            tools: new ToolRegistry().list(),
            maxToolSteps: MAX_TOOL_STEPS,
            maxIterations: MAX_ITERATIONS,
            progress: { stepsUsed: 0, toolCallsUsed: 0, priorActions: [] },
          },
        )}`,
      },
      { role: 'user', content: 'hello' },
    ]);
  });
});
