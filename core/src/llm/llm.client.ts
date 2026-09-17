import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import { buildRequestHeaders } from './llm-provider';
import type { LlmChatRequest } from './llm-provider';
import {
  CompletionParser,
  MAX_SSE_BUFFER_BYTES,
  ToolOffer,
  parseJson,
  protocolError,
} from './llm.protocol';
import type { LlmResult, LlmToolRequest } from './llm.protocol';
export type {
  LlmMessage,
  LlmResult,
  LlmToolCall,
  LlmToolRequest,
} from './llm.protocol';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Narrow endpoint config. The client never sees roles, prompts, or
 * Core-wide settings — any model role (conversation, extraction,
 * sentinel) gets its own instance with its own values.
 *
 * `provider` is a plain label (ollama, llama.cpp, openrouter,
 * opencode, ...) with exactly one behavioral effect: the id
 * `opencode` opts into session-affinity headers. Everything else is
 * uniform OpenAI-compatible transport.
 */
export interface LlmEndpointConfig {
  provider: string;
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey?: string;
  headers?: Record<string, string>;
  userAgent?: string;
  llmTimeoutMs: number;
}

export interface ChatResult {
  content: string;
  model: string;
}

export interface StreamSink {
  onToken(content: string): void;
}

/**
 * Error thrown when the upstream LLM endpoint fails.
 * `httpStatus` is the status Core should report to its own caller:
 * 504 for timeouts/unreachable, 502 for everything else upstream.
 */
export class LlmError extends Error {
  constructor(
    public readonly httpStatus: 502 | 504,
    message: string,
    public readonly retryable: boolean,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

@Injectable()
export class LlmClient {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: LlmEndpointConfig,
  ) {}

  buildUrl(): string {
    const url = new URL(this.config.llmBaseUrl);
    const path = url.pathname.replace(/\/+$/, '');
    url.pathname = path.endsWith('/chat/completions')
      ? path
      : `${path}/chat/completions`;
    return url.toString();
  }

  async chat(request: LlmChatRequest): Promise<ChatResult> {
    return this.textResult(await this.complete(request));
  }

  /**
   * Stream a completion, forwarding each content delta to `sink`.
   * `clientSignal` aborts the upstream request (e.g. browser disconnected).
   */
  async chatStream(
    request: LlmChatRequest,
    sink: StreamSink,
    clientSignal?: AbortSignal,
  ): Promise<ChatResult> {
    return this.textResult(await this.complete(request, sink, clientSignal));
  }

  async chatWithTools(
    request: LlmToolRequest,
    clientSignal?: AbortSignal,
  ): Promise<LlmResult> {
    return this.complete(
      request,
      undefined,
      clientSignal,
      new ToolOffer(request),
    );
  }

  async chatStreamWithTools(
    request: LlmToolRequest,
    sink: StreamSink,
    clientSignal?: AbortSignal,
  ): Promise<LlmResult> {
    return this.complete(request, sink, clientSignal, new ToolOffer(request));
  }

  private textResult(result: LlmResult): ChatResult {
    if (result.kind !== 'text') throw protocolError();
    return { content: result.content, model: result.model };
  }

  private async complete(
    request: LlmChatRequest | LlmToolRequest,
    sink?: StreamSink,
    clientSignal?: AbortSignal,
    offer?: ToolOffer,
  ): Promise<LlmResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.llmTimeoutMs);
    const onClientAbort = (): void => controller.abort();
    clientSignal?.addEventListener('abort', onClientAbort, { once: true });
    if (clientSignal?.aborted) controller.abort();
    const signal = controller.signal;
    let res: Response | undefined;
    try {
      signal.throwIfAborted();
      try {
        res = await fetch(this.buildUrl(), {
          method: 'POST',
          headers: buildRequestHeaders(this.config, {
            sessionId: request.sessionId,
          }),
          body: JSON.stringify({
            model: this.config.llmModel,
            messages: request.messages,
            stream: sink !== undefined,
            ...offer?.body,
          }),
          signal,
        });
      } catch {
        throw this.providerError(
          504,
          'LLM endpoint unreachable or request aborted',
          true,
        );
      }
      signal.throwIfAborted();
      if (!res.ok) {
        throw this.providerError(
          502,
          'LLM endpoint returned an unsuccessful response',
          res.status >= 500,
        );
      }
      if (!res.body) throw protocolError();
      const parser = new CompletionParser(this.config.llmModel, offer);
      if (sink) {
        const result = await this.pumpStream(
          res.body,
          parser,
          sink,
          signal,
          offer !== undefined,
        );
        signal.throwIfAborted();
        return result;
      }
      const text = await this.readResponse(res.body, signal);
      signal.throwIfAborted();
      return parser.response(parseJson(text));
    } catch (err) {
      if (signal.aborted) {
        throw this.providerError(
          504,
          timedOut
            ? `LLM endpoint timed out after ${this.config.llmTimeoutMs}ms`
            : 'LLM request aborted',
          timedOut,
        );
      }
      if (err instanceof LlmError) throw err;
      throw protocolError();
    } finally {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onClientAbort);
      if (res?.body && !res.body.locked)
        await res.body.cancel().catch(() => undefined);
      controller.abort();
    }
  }

  /** Tag errors with the provider id. Never include credentials. */
  private providerError(
    httpStatus: 502 | 504,
    message: string,
    retryable: boolean,
    cause?: unknown,
  ): LlmError {
    return new LlmError(
      httpStatus,
      `[${this.config.provider}] ${message}`,
      retryable,
      cause,
    );
  }

  private async readResponse(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): Promise<string> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const cancel = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      let text = '';
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) return text + decoder.decode();
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async pumpStream(
    body: ReadableStream<Uint8Array>,
    parser: CompletionParser,
    sink: StreamSink,
    signal: AbortSignal,
    strict: boolean,
  ): Promise<LlmResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: strict });
    const cancel = (): void => {
      void reader.cancel().catch(() => undefined);
    };
    signal.addEventListener('abort', cancel, { once: true });
    let buffer = '';
    let bufferBytes = 0;
    const line = (raw: string): boolean => {
      signal.throwIfAborted();
      const trimmed = raw.trim();
      if (!trimmed.startsWith('data:')) return false;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') {
        parser.markDone();
        return true;
      }
      let value: unknown;
      try {
        value = parseJson(payload);
      } catch (err) {
        if (strict) throw err;
        return false;
      }
      parser.chunk(value, sink);
      signal.throwIfAborted();
      return false;
    };
    try {
      for (;;) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        signal.throwIfAborted();
        if (done) {
          buffer += decoder.decode();
          if (buffer) line(buffer);
          return parser.result(true);
        }
        for (let offset = 0; offset < value.length; offset += 4096) {
          const decoded = decoder.decode(
            value.subarray(offset, offset + 4096),
            { stream: true },
          );
          for (const character of decoded) {
            if (character === '\n') {
              if (line(buffer)) return parser.result(true);
              buffer = '';
              bufferBytes = 0;
            } else {
              bufferBytes += Buffer.byteLength(character);
              if (bufferBytes > MAX_SSE_BUFFER_BYTES) throw protocolError();
              buffer += character;
            }
          }
        }
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
