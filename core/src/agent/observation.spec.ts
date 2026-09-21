import type { ToolExecutionRecord } from '../tools/tool-execution.repository';
import { observationFromRecord, observationStatus } from './observation';

function record(
  overrides: Partial<ToolExecutionRecord> = {},
): ToolExecutionRecord {
  return {
    requestId: 'req-1',
    sessionId: 's1',
    input: {
      requestId: 'req-1',
      sessionId: 's1',
      context: [],
      allowedTools: ['session.search'],
      proposal: {
        kind: 'tool_calls',
        model: 'm',
        content: null,
        toolCalls: [
          {
            id: 'model-call-1',
            name: 'session.search',
            version: 1,
            rawArguments: '{"query":"teal","limit":20}',
            args: { query: 'teal', limit: 20 },
          },
        ],
      },
    },
    invocationId: 'inv-1',
    approvalId: null,
    state: 'succeeded',
    validation: {
      ok: true,
      request: {
        name: 'session.search',
        version: 1,
        sessionId: 's1',
        args: { query: 'teal', limit: 20 },
      },
    },
    execution: { ok: true, matches: [] },
    final: { state: 'not_required' },
    executionToken: null,
    ownership: 'none',
    ...overrides,
  };
}

describe('observationFromRecord', () => {
  it('links successful results to their invocation', () => {
    expect(observationFromRecord(record())).toEqual({
      requestId: 'req-1',
      invocationId: 'inv-1',
      tool: 'session.search',
      args: { query: 'teal', limit: 20 },
      status: 'succeeded',
      result: { ok: true, matches: [] },
    });
  });

  it('keeps failures as failures with the actual payload', () => {
    const observation = observationFromRecord(
      record({
        state: 'failed',
        execution: { ok: false, failure: { code: 'search_failed' } },
      }),
    );
    expect(observation).toMatchObject({
      status: 'failed',
      result: { ok: false, failure: { code: 'search_failed' } },
    });
  });

  it('keeps unknown outcomes unknown, never converts them', () => {
    expect(observationStatus({ ok: false, failure: { code: 'unknown' } })).toBe(
      'unknown',
    );
    const observation = observationFromRecord(
      record({
        state: 'failed',
        execution: { ok: false, failure: { code: 'unknown' } },
      }),
    );
    expect(observation?.status).toBe('unknown');
  });

  it('yields nothing without a durable execution', () => {
    expect(
      observationFromRecord(record({ state: 'invalid', execution: null })),
    ).toBeUndefined();
    expect(
      observationFromRecord(
        record({ state: 'awaiting_approval', execution: null }),
      ),
    ).toBeUndefined();
    expect(
      observationFromRecord(record({ invocationId: null })),
    ).toBeUndefined();
  });
});
