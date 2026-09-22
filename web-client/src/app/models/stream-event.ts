export type TurnStatus = 'ok' | 'approval_required' | 'processing';

/** Structured command outcome. Mirrors core `CommandPayload`. */
export interface CommandPayload {
  readonly kind: string;
  readonly data?: Record<string, unknown>;
}

/** Finished-tool trace. Mirrors core `ToolSummary`. */
export interface ToolSummary {
  readonly invocationId: string;
  readonly name: string;
}

/** Parked-approval pointer. Mirrors core `ApprovalSummary`. */
export interface ApprovalSummary {
  readonly approvalId: string;
  readonly invocationId: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** SSE frames from `POST /core/conversation/stream` (+ `/resume-stream`). */
export type StreamEvent =
  | { readonly type: 'meta'; readonly sessionId: string; readonly model: string; readonly requestId: string }
  | { readonly type: 'token'; readonly content: string }
  | { readonly type: 'tool'; readonly invocationId: string; readonly name: string; readonly state: string }
  | { readonly type: 'approval'; readonly approval: ApprovalSummary; readonly requestId: string }
  | {
      readonly type: 'done';
      readonly reply: string;
      readonly model: string;
      readonly requestId: string;
      readonly status: TurnStatus;
      readonly command?: CommandPayload;
      readonly tool?: ToolSummary;
      readonly approval?: ApprovalSummary;
      readonly outcome?: 'rejected' | 'cancelled' | 'expired';
      readonly result?: unknown;
    }
  | { readonly type: 'error'; readonly message: string; readonly requestId?: string };

/** Durable request pointer for parked (`approval_required`) / running (`processing`) turns. */
export interface ParkedResume {
  readonly requestId: string;
  readonly sessionId: string;
}

/**
 * Parse one SSE `event:`/`data:` block into a `StreamEvent`.
 * Returns `null` for keep-alives / malformed frames (caller skips them).
 * Mirrors `test-client.html` `handleEvent` framing exactly.
 */
export function parseStreamBlock(raw: string): StreamEvent | null {
  let name = '';
  let data = '';

  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) {
      name = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data += line.slice(5).trim();
    }
  }

  if (!name || !data) {
    return null;
  }

  const payload = JSON.parse(data) as Record<string, unknown>;
  return { type: name, ...payload } as StreamEvent;
}

/**
 * Split an accumulated SSE text buffer into complete `\n\n`-delimited blocks,
 * returning the blocks plus the unprocessed remainder.
 */
export function splitStreamBlocks(buffer: string): { blocks: string[]; rest: string } {
  const blocks: string[] = [];
  let rest = buffer;
  let boundary = rest.indexOf('\n\n');
  while (boundary >= 0) {
    blocks.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf('\n\n');
  }
  return { blocks, rest };
}
