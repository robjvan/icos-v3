import { Inject, Injectable } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  content: string;
  model: string;
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

@Injectable()
export class LlmClient {
  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  buildUrl(): string {
    return `${this.config.llmBaseUrl}/chat/completions`;
  }

  async chat(messages: ChatMessage[]): Promise<ChatResult> {
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
          headers: this.buildHeaders(),
          body: JSON.stringify({
            model: this.config.llmModel,
            messages,
            stream: false,
          }),
          signal: controller.signal,
        });
      } catch (err) {
        throw new LlmError(
          504,
          `LLM endpoint unreachable or timed out after ${this.config.llmTimeoutMs}ms`,
          true,
          err,
        );
      }
      if (!res.ok) {
        const snippet = await this.readBodySnippet(res);
        throw new LlmError(
          502,
          `LLM endpoint returned ${res.status}: ${snippet}`,
          res.status >= 500,
        );
      }
      const data = (await res.json()) as ChatCompletionsResponse;
      const content = data.choices?.[0]?.message?.content?.trim();
      if (!content) {
        throw new LlmError(
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

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.config.llmApiKey) {
      headers['Authorization'] = `Bearer ${this.config.llmApiKey}`;
    }
    return headers;
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
