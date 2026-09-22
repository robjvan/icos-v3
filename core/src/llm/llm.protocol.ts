import type { ToolDescriptor, ToolName } from '../tools/tool-registry';
import { LlmError } from './llm.client';
import type { ChatMessage, StreamSink } from './llm.client';

export interface LlmToolCall {
  readonly id: string;
  readonly name: ToolName;
  readonly version: 1;
  readonly rawArguments: string;
  readonly args: Record<string, unknown>;
}

export type LlmMessage =
  | ChatMessage
  | {
      role: 'assistant';
      content: string | null;
      toolCalls: readonly LlmToolCall[];
    }
  | { role: 'tool'; callId: string; content: string };

export type LlmResult =
  | { kind: 'text'; content: string; model: string }
  | {
      kind: 'tool_calls';
      content: string | null;
      model: string;
      toolCalls: readonly LlmToolCall[];
    };

export interface LlmToolRequest {
  messages: readonly LlmMessage[];
  tools: readonly ToolDescriptor[];
  toolChoice?: 'auto' | 'none';
  sessionId?: string;
}

const ALIASES: Readonly<Record<ToolName, string>> = {
  'session.search': 'session_search',
  'session.rename': 'session_rename',
};
const MAX_CALLS = 8;
const MAX_ARGUMENT_BYTES = 64 * 1024;
const MAX_TOTAL_ARGUMENT_BYTES = 256 * 1024;
export const MAX_SSE_BUFFER_BYTES = 128 * 1024;
const MAX_METADATA_CHARS = 128;

export function protocolError(): LlmError {
  return new LlmError(
    502,
    'LLM endpoint returned an invalid completion',
    false,
  );
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw protocolError();
  return value as Record<string, unknown>;
}

function metadata(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > MAX_METADATA_CHARS
  )
    throw protocolError();
  return value;
}

export function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw protocolError();
  }
}

export class ToolOffer {
  private readonly aliases = new Map<string, { name: ToolName; version: 1 }>();
  readonly body: {
    tools: unknown[];
    tool_choice: 'auto' | 'none';
    messages: unknown[];
  };

  constructor(request: LlmToolRequest) {
    const tools = request.tools.map((tool) => {
      const alias = ALIASES[tool.name];
      if (!alias || tool.version !== 1 || this.aliases.has(alias))
        throw protocolError();
      this.aliases.set(alias, { name: tool.name, version: tool.version });
      return {
        type: 'function',
        function: {
          name: alias,
          description: tool.description,
          parameters: tool.argsSchema,
        },
      };
    });
    const toolChoice = request.toolChoice ?? 'auto';
    if (toolChoice !== 'auto' && toolChoice !== 'none') throw protocolError();
    this.body = {
      tools,
      tool_choice: toolChoice,
      messages: this.messages(request.messages),
    };
  }

  resolve(alias: string): { name: ToolName; version: 1 } {
    const descriptor = this.aliases.get(alias);
    if (!descriptor || this.body.tool_choice === 'none') throw protocolError();
    return descriptor;
  }

  private messages(messages: readonly LlmMessage[]): unknown[] {
    const pending = new Set<string>();
    const seen = new Set<string>();
    const result = messages.map((message) => {
      if (message.role === 'tool') {
        if (
          typeof message.content !== 'string' ||
          !pending.delete(message.callId)
        )
          throw protocolError();
        return {
          role: 'tool',
          tool_call_id: message.callId,
          content: message.content,
        };
      }
      if (pending.size) throw protocolError();
      if ('toolCalls' in message) {
        if (
          message.role !== 'assistant' ||
          (message.content !== null && typeof message.content !== 'string') ||
          !message.toolCalls.length ||
          message.toolCalls.length > MAX_CALLS
        )
          throw protocolError();
        let total = 0;
        const tool_calls = message.toolCalls.map((call) => {
          const id = metadata(call.id);
          const alias = ALIASES[call.name];
          if (
            !alias ||
            call.version !== 1 ||
            seen.has(id) ||
            typeof call.rawArguments !== 'string'
          )
            throw protocolError();
          const bytes = Buffer.byteLength(call.rawArguments);
          total += bytes;
          if (bytes > MAX_ARGUMENT_BYTES || total > MAX_TOTAL_ARGUMENT_BYTES)
            throw protocolError();
          record(parseJson(call.rawArguments));
          seen.add(id);
          pending.add(id);
          return {
            id,
            type: 'function',
            function: { name: alias, arguments: call.rawArguments },
          };
        });
        return { role: 'assistant', content: message.content, tool_calls };
      }
      if (typeof message.content !== 'string') throw protocolError();
      return { role: message.role, content: message.content };
    });
    if (pending.size) throw protocolError();
    return result;
  }
}

interface PendingCall {
  id?: string;
  type?: string;
  name?: string;
  rawArguments: string;
}

export class CompletionParser {
  private content: string | null = null;
  private readonly calls = new Map<number, PendingCall>();
  private finish: string | null = null;
  private done = false;

  constructor(
    private model: string,
    private readonly offer?: ToolOffer,
  ) {}

  response(value: unknown): LlmResult {
    const data = record(value);
    this.readModel(data);
    const choice = this.choice(data);
    if (!choice) throw protocolError();
    const message = record(choice.message);
    this.message(message, false);
    this.finishReason(choice.finish_reason);
    return this.result(false);
  }

  chunk(value: unknown, sink: StreamSink): void {
    const data = record(value);
    this.readModel(data);
    const choice = this.choice(data, true);
    if (!choice) return;
    if (this.finish !== null || this.done) {
      // Some gateways (OpenRouter) append a usage chunk that echoes the
      // terminal choice. Accept it only when it adds nothing new —
      // anything else after finish still contradicts the result.
      if (this.isTerminalEcho(choice)) return;
      throw protocolError();
    }
    const delta = record(choice.delta);
    this.message(delta, true);
    this.finishReason(choice.finish_reason);
    if (typeof delta.content === 'string' && delta.content)
      sink.onToken(delta.content);
  }

  markDone(): void {
    this.done = true;
  }

  /**
   * A post-finish choice echo adds no content, calls, or new finish —
   * e.g. OpenRouter's usage chunk repeating the terminal delta. Unknown
   * extra fields (reasoning traces, provider metadata) are ignored here
   * exactly as they are mid-stream; only new payload contradicts.
   */
  private isTerminalEcho(choice: Record<string, unknown>): boolean {
    const finish = choice.finish_reason;
    if (finish !== undefined && finish !== null && finish !== this.finish)
      return false;
    const delta = choice.delta;
    if (typeof delta !== 'object' || delta === null || Array.isArray(delta))
      return false;
    const record = delta as Record<string, unknown>;
    if (record.role !== undefined && record.role !== 'assistant') return false;
    if (
      record.content !== undefined &&
      record.content !== null &&
      record.content !== ''
    )
      return false;
    if (record.tool_calls !== undefined) return false;
    if (record.function_call !== undefined) return false;
    return true;
  }

  result(stream: boolean): LlmResult {
    if (this.calls.size) {
      if (!this.offer || this.finish !== 'tool_calls' || (stream && !this.done))
        throw protocolError();
      const ids = new Set<string>();
      const toolCalls = Array.from({ length: this.calls.size }, (_, index) => {
        const call = this.calls.get(index);
        if (!call || call.type !== 'function') throw protocolError();
        const id = metadata(call.id);
        const descriptor = this.offer!.resolve(metadata(call.name));
        if (ids.has(id)) throw protocolError();
        ids.add(id);
        const args = record(parseJson(call.rawArguments));
        return { id, ...descriptor, rawArguments: call.rawArguments, args };
      });
      return {
        kind: 'tool_calls',
        content: this.content,
        model: this.model,
        toolCalls,
      };
    }
    if (this.offer && this.finish !== 'stop') throw protocolError();
    const content = stream ? this.content : this.content?.trim();
    if (!content) throw protocolError();
    return { kind: 'text', content, model: this.model };
  }

  private readModel(data: Record<string, unknown>): void {
    if (data.model !== undefined) this.model = metadata(data.model);
    if (data.error !== undefined) throw protocolError();
  }

  private choice(
    data: Record<string, unknown>,
    stream = false,
  ): Record<string, unknown> | undefined {
    if (!Array.isArray(data.choices)) throw protocolError();
    if (stream && data.choices.length === 0 && data.usage !== undefined) {
      record(data.usage);
      return undefined;
    }
    if (data.choices.length !== 1) throw protocolError();
    const choice = record(data.choices[0]);
    if (choice.index !== undefined && choice.index !== 0) throw protocolError();
    return choice;
  }

  private finishReason(value: unknown): void {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') throw protocolError();
    if (this.offer && value !== 'stop' && value !== 'tool_calls')
      throw protocolError();
    if (!this.offer && value === 'tool_calls') throw protocolError();
    this.finish = value;
  }

  private message(message: Record<string, unknown>, stream: boolean): void {
    if (message.role !== undefined && message.role !== 'assistant')
      throw protocolError();
    if (message.function_call !== undefined) throw protocolError();
    if (
      message.content !== undefined &&
      message.content !== null &&
      typeof message.content !== 'string'
    )
      throw protocolError();
    if (!stream && this.offer && message.content === undefined)
      throw protocolError();
    if (message.tool_calls !== undefined) {
      if (
        !Array.isArray(message.tool_calls) ||
        message.tool_calls.length > MAX_CALLS ||
        (!this.offer && message.tool_calls.length > 0)
      )
        throw protocolError();
      message.tool_calls.forEach((value: unknown, index: number) =>
        this.addCall(value, stream ? undefined : index),
      );
    }
    if (typeof message.content === 'string')
      this.content = (this.content ?? '') + message.content;
  }

  private addCall(value: unknown, position?: number): void {
    const delta = record(value);
    const index = position ?? delta.index;
    if (
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= MAX_CALLS
    )
      throw protocolError();
    const call = this.calls.get(index) ?? { rawArguments: '' };
    if (delta.id !== undefined) {
      if (call.id !== undefined) throw protocolError();
      call.id = metadata(delta.id);
    }
    if (delta.type !== undefined) {
      if (call.type !== undefined || delta.type !== 'function')
        throw protocolError();
      call.type = delta.type;
    }
    if (delta.function !== undefined) {
      const fn = record(delta.function);
      if (fn.name !== undefined) {
        if (call.name !== undefined) throw protocolError();
        call.name = metadata(fn.name);
        this.offer!.resolve(call.name);
      }
      if (fn.arguments !== undefined) {
        if (typeof fn.arguments !== 'string') throw protocolError();
        call.rawArguments += fn.arguments;
      }
    }
    this.calls.set(index, call);
    let total = 0;
    for (const pending of this.calls.values()) {
      const bytes = Buffer.byteLength(pending.rawArguments);
      if (bytes > MAX_ARGUMENT_BYTES) throw protocolError();
      total += bytes;
    }
    if (total > MAX_TOTAL_ARGUMENT_BYTES) throw protocolError();
  }
}
