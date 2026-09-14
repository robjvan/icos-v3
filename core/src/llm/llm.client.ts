import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import { buildRequestHeaders } from './llm-provider';
import type { LlmChatRequest } from './llm-provider';

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

interface ChatCompletionsResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
  }>;
}

interface ChatCompletionsChunk {
  model?: string;
  choices?: Array<{
    delta?: { content?: string | null };
  }>;
}

@Injectable()
export class LlmClient {
  constructor(
    @Inject(CORE_CONFIG) private readonly config: LlmEndpointConfig,
  ) {}

  buildUrl(): string {
    if (this.config.llmModel.includes('muse')) {
      return `${this.config.llmBaseUrl}/responses`;
    } else {
      return `${this.config.llmBaseUrl}/chat/completions`;
    }
  }

  async chat(request: LlmChatRequest): Promise<ChatResult> {
    const { messages } = request;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.llmTimeoutMs,
    );
    try {
      let res: Response;
      try {
        res = await fetch(this.buildUrl(), {
          method: 'POST',
          headers: buildRequestHeaders(this.config, {
            sessionId: request.sessionId,
          }),
          body: JSON.stringify({
            model: this.config.llmModel,
            messages,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        throw this.providerError(
          504,
          `LLM endpoint unreachable or timed out after ${this.config.llmTimeoutMs}ms`,
          true,
          err,
        );
      }
      if (!res.ok) {
        const snippet = await this.readBodySnippet(res);
        throw this.providerError(
          502,
          `LLM endpoint returned ${res.status}: ${snippet}`,
          res.status >= 500,
        );
      }
      const data = (await res.json()) as ChatCompletionsResponse;
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw this.providerError(
          502,
          'LLM endpoint returned no content (empty choices)',
          false,
        );
      }
      return { content, model: data.model ?? this.config.llmModel };
    } finally {
      clearTimeout(timer);
    }
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
    const { messages } = request;
    const timeout = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      timeout.abort();
    }, this.config.llmTimeoutMs);
    const onClientAbort = (): void => timeout.abort();
    clientSignal?.addEventListener('abort', onClientAbort, { once: true });
    try {
      let res: Response;
      try {
        res = await fetch(this.buildUrl(), {
          method: 'POST',
          headers: buildRequestHeaders(this.config, {
            sessionId: request.sessionId,
          }),
          body: JSON.stringify({
            model: this.config.llmModel,
            messages,
            stream: true,
          }),
          signal: timeout.signal,
        });
      } catch (err) {
        throw this.abortError(err, timedOut);
      }
      if (!res.ok) {
        const snippet = await this.readBodySnippet(res);
        throw this.providerError(
          502,
          `LLM endpoint returned ${res.status}: ${snippet}`,
          res.status >= 500,
        );
      }
      try {
        if (!res.body) {
          throw this.providerError(
            502,
            'LLM endpoint returned an empty body',
            true,
          );
        }
        return await this.pumpStream(res.body, sink);
      } catch (err) {
        if (err instanceof LlmError) throw err;
        throw this.abortError(err, timedOut);
      }
    } finally {
      clearTimeout(timer);
      clientSignal?.removeEventListener('abort', onClientAbort);
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

  private abortError(cause: unknown, timedOut: boolean): LlmError {
    if (timedOut) {
      return this.providerError(
        504,
        `LLM endpoint timed out after ${this.config.llmTimeoutMs}ms`,
        true,
        cause,
      );
    }
    return this.providerError(504, 'LLM request aborted', false, cause);
  }

  private async pumpStream(
    body: ReadableStream<Uint8Array>,
    sink: StreamSink,
  ): Promise<ChatResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const state = { content: '', model: this.config.llmModel };
    try {
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          this.applyPayloadLine(line, state, sink);
        }
      }
      const tail = (buffer + decoder.decode()).trim();
      if (tail) this.applyPayloadLine(tail, state, sink);
    } finally {
      reader.releaseLock();
    }
    if (!state.content) {
      throw this.providerError(
        502,
        'LLM endpoint returned an empty stream',
        false,
      );
    }
    return { content: state.content, model: state.model };
  }

  private applyPayloadLine(
    line: string,
    state: { content: string; model: string },
    sink: StreamSink,
  ): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk: ChatCompletionsChunk;
    try {
      chunk = JSON.parse(payload) as ChatCompletionsChunk;
    } catch {
      return;
    }
    if (chunk.model) state.model = chunk.model;
    const delta = chunk.choices?.[0]?.delta?.content;
    if (delta) {
      state.content += delta;
      sink.onToken(delta);
    }
  }

  private async readBodySnippet(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.slice(0, 300) || '<empty body>';
    } catch {
      return '<unreadable body>';
    }
  }
}
