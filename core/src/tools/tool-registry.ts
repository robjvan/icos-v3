export type ToolName = 'session.search' | 'session.rename';

export type ApprovalPolicy = 'none' | 'required';

export interface ToolDescriptor {
  readonly name: ToolName;
  readonly version: 1;
  readonly description: string;
  readonly approval: ApprovalPolicy;
  readonly argsSchema: Readonly<{
    type: 'object';
    additionalProperties: false;
    required: readonly string[];
    properties: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  }>;
}

export interface SessionSearchArgs {
  readonly query: string;
  readonly limit: number;
}

export interface SessionRenameArgs {
  readonly title: string;
}

export type ValidatedToolArgs = SessionSearchArgs | SessionRenameArgs;

export type ValidatedToolRequest = {
  readonly version: 1;
  readonly sessionId: string;
} & (
  | { readonly name: 'session.search'; readonly args: SessionSearchArgs }
  | { readonly name: 'session.rename'; readonly args: SessionRenameArgs }
);

export interface ToolValidationContext {
  sessionId: string;
  allowedTools: readonly ToolName[];
}

export type ToolValidationFailureCode =
  | 'invalid_input'
  | 'unknown_tool'
  | 'unknown_version'
  | 'unpermitted_tool'
  | 'invalid_session'
  | 'invalid_args';

export interface ToolValidationFailure {
  readonly code: ToolValidationFailureCode;
  readonly message: string;
}

export type ToolValidationResult =
  | { ok: true; request: ValidatedToolRequest }
  | { ok: false; failure: ToolValidationFailure };

const DEFAULT_SEARCH_LIMIT = 20;
const MIN_SEARCH_LIMIT = 1;
const MAX_SEARCH_LIMIT = 100;
const MAX_QUERY_LENGTH = 500;
const MAX_TITLE_LENGTH = 200;

const NONBLANK_PATTERN = '\\S';

const NONBLANK_TEST = new RegExp(NONBLANK_PATTERN);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function deepFreeze<T>(value: T): T {
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
    return Object.freeze(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
    return Object.freeze(value);
  }
  return value;
}

const SEARCH_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['query'],
  properties: {
    query: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_QUERY_LENGTH,
    },
    limit: {
      type: 'integer',
      minimum: MIN_SEARCH_LIMIT,
      maximum: MAX_SEARCH_LIMIT,
      default: DEFAULT_SEARCH_LIMIT,
    },
  },
} as const);

const RENAME_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['title'],
  properties: {
    title: {
      type: 'string',
      pattern: NONBLANK_PATTERN,
      minLength: 1,
      maxLength: MAX_TITLE_LENGTH,
    },
  },
} as const);

const DESCRIPTORS: readonly ToolDescriptor[] = Object.freeze([
  Object.freeze({
    name: 'session.search',
    version: 1,
    description:
      'Search the current session transcript. Returns matching messages.',
    approval: 'none',
    argsSchema: SEARCH_SCHEMA,
  }),
  Object.freeze({
    name: 'session.rename',
    version: 1,
    description: 'Rename the current session.',
    approval: 'required',
    argsSchema: RENAME_SCHEMA,
  }),
]);

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
): string | undefined {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return `Unknown field: ${key}`;
    }
  }
  return undefined;
}

function validText(
  raw: unknown,
  label: string,
  maxLength: number,
): ParseResult<string> {
  if (typeof raw !== 'string') {
    return { ok: false, message: `${label} must be a string` };
  }
  if (!NONBLANK_TEST.test(raw)) {
    return { ok: false, message: `${label} must be nonblank` };
  }
  if (Array.from(raw).length > maxLength) {
    return {
      ok: false,
      message: `${label} must be at most ${maxLength} characters`,
    };
  }
  return { ok: true, value: raw.trim() };
}

function validateSearchArgs(
  args: Record<string, unknown>,
): ParseResult<SessionSearchArgs> {
  const unknownField = rejectUnknownFields(args, ['query', 'limit']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const query = validText(ownValue(args, 'query'), 'query', MAX_QUERY_LENGTH);
  if (!query.ok) {
    return query;
  }
  const limit = Object.hasOwn(args, 'limit')
    ? args.limit
    : DEFAULT_SEARCH_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < MIN_SEARCH_LIMIT ||
    limit > MAX_SEARCH_LIMIT
  ) {
    return {
      ok: false,
      message: `limit must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}`,
    };
  }
  return { ok: true, value: Object.freeze({ query: query.value, limit }) };
}

function validateRenameArgs(
  args: Record<string, unknown>,
): ParseResult<SessionRenameArgs> {
  const unknownField = rejectUnknownFields(args, ['title']);
  if (unknownField !== undefined) {
    return { ok: false, message: unknownField };
  }
  const title = validText(ownValue(args, 'title'), 'title', MAX_TITLE_LENGTH);
  if (!title.ok) {
    return title;
  }
  return { ok: true, value: Object.freeze({ title: title.value }) };
}

function fail(
  code: ToolValidationFailureCode,
  message: string,
): ToolValidationResult {
  return { ok: false, failure: { code, message } };
}

export class ToolRegistry {
  list(): readonly ToolDescriptor[] {
    return DESCRIPTORS;
  }

  lookup(name: string): ToolDescriptor | undefined {
    return DESCRIPTORS.find((d) => d.name === name);
  }

  validate(
    input: unknown,
    context: ToolValidationContext,
  ): ToolValidationResult {
    if (!isPlainObject(input)) {
      return fail('invalid_input', 'tool call must be a plain object');
    }
    const unknownField = rejectUnknownFields(input, [
      'name',
      'version',
      'args',
    ]);
    if (unknownField !== undefined) {
      return fail('invalid_input', unknownField);
    }
    const name = ownValue(input, 'name');
    if (typeof name !== 'string') {
      return fail('unknown_tool', 'tool name must be a string');
    }
    const descriptor = this.lookup(name);
    if (!descriptor) {
      return fail('unknown_tool', `Unknown tool: ${name}`);
    }
    if (ownValue(input, 'version') !== descriptor.version) {
      return fail('unknown_version', 'Unsupported tool version');
    }
    if (!context.allowedTools.includes(descriptor.name)) {
      return fail('unpermitted_tool', `Tool not permitted: ${name}`);
    }
    if (
      typeof context.sessionId !== 'string' ||
      context.sessionId.trim().length === 0
    ) {
      return fail('invalid_session', 'sessionId is required');
    }
    const args = ownValue(input, 'args');
    if (!isPlainObject(args)) {
      return fail('invalid_args', 'args must be a plain object');
    }
    const base = { version: descriptor.version, sessionId: context.sessionId };
    if (descriptor.name === 'session.search') {
      const result = validateSearchArgs(args);
      if (!result.ok) {
        return fail('invalid_args', result.message);
      }
      return {
        ok: true,
        request: Object.freeze({
          name: 'session.search',
          ...base,
          args: result.value,
        }),
      };
    }
    const result = validateRenameArgs(args);
    if (!result.ok) {
      return fail('invalid_args', result.message);
    }
    return {
      ok: true,
      request: Object.freeze({
        name: 'session.rename',
        ...base,
        args: result.value,
      }),
    };
  }
}
