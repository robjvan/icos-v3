import type {
  ToolDescriptor,
  ToolName,
  ToolValidationContext,
  ToolValidationFailure,
  ToolValidationResult,
  ValidatedToolRequest,
} from './tool-registry';
import { ToolRegistry } from './tool-registry';

const SESSION_ID = 'session-1';

const ALL_TOOLS: readonly ToolName[] = ['session.search', 'session.rename'];

function contextWith(
  allowedTools: readonly ToolName[] = ALL_TOOLS,
  sessionId = SESSION_ID,
): ToolValidationContext {
  return { sessionId, allowedTools };
}

function expectOk(result: ToolValidationResult): ValidatedToolRequest {
  if (!result.ok) {
    throw new Error(
      `expected ok, got ${result.failure.code}: ${result.failure.message}`,
    );
  }
  return result.request;
}

function expectFailure(result: ToolValidationResult): ToolValidationFailure {
  if (result.ok) {
    throw new Error('expected validation failure');
  }
  return result.failure;
}

function searchCall(args: unknown): unknown {
  return { name: 'session.search', version: 1, args };
}

function renameCall(args: unknown): unknown {
  return { name: 'session.rename', version: 1, args };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('exposes exactly the two canonical session tools', () => {
    expect(registry.list().map((d) => d.name)).toEqual([
      'session.search',
      'session.rename',
    ]);
    for (const descriptor of registry.list()) {
      expect(descriptor.version).toBe(1);
      expect(descriptor.description.length).toBeGreaterThan(0);
    }
    expect(registry.lookup('session.search')?.approval).toBe('none');
    expect(registry.lookup('session.rename')?.approval).toBe('none');
  });

  it('freezes descriptor metadata against mutation', () => {
    for (const descriptor of registry.list()) {
      expect(Object.isFrozen(descriptor)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema.properties)).toBe(true);
      expect(Object.isFrozen(descriptor.argsSchema.required)).toBe(true);
      for (const schema of Object.values(descriptor.argsSchema.properties)) {
        expect(Object.isFrozen(schema)).toBe(true);
      }
    }
  });

  it('declares strict flat schemas matching trim and bounds', () => {
    const search = registry.lookup('session.search') as ToolDescriptor;
    expect(search.argsSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['query'],
    });
    expect(search.argsSchema.properties.query).toMatchObject({
      type: 'string',
      pattern: '\\S',
      minLength: 1,
      maxLength: 500,
    });
    expect(search.argsSchema.properties.limit).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
    const rename = registry.lookup('session.rename') as ToolDescriptor;
    expect(rename.argsSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['title'],
    });
    expect(rename.argsSchema.properties.title).toMatchObject({
      type: 'string',
      pattern: '\\S',
      minLength: 1,
      maxLength: 200,
    });
  });

  it('returns undefined for unknown tool lookup', () => {
    expect(registry.lookup('session.delete')).toBeUndefined();
    expect(registry.lookup('')).toBeUndefined();
  });

  describe('validate', () => {
    it('accepts a canonical search call, trimming query and defaulting limit', () => {
      const request = expectOk(
        registry.validate(
          {
            name: 'session.search',
            version: 1,
            args: { query: '  teal rings  ' },
          },
          contextWith(),
        ),
      );
      expect(request).toEqual({
        name: 'session.search',
        version: 1,
        sessionId: SESSION_ID,
        args: { query: 'teal rings', limit: 20 },
      });
    });

    it('accepts explicit limit bounds', () => {
      const upper = expectOk(
        registry.validate(
          searchCall({ query: 'q', limit: 100 }),
          contextWith(),
        ),
      );
      expect(upper.args).toEqual({ query: 'q', limit: 100 });
      const lower = expectOk(
        registry.validate(searchCall({ query: 'q', limit: 1 }), contextWith()),
      );
      expect(lower.args).toEqual({ query: 'q', limit: 1 });
    });

    it('accepts a canonical rename call, trimming the title', () => {
      const request = expectOk(
        registry.validate(
          {
            name: 'session.rename',
            version: 1,
            args: { title: '  Ward map  ' },
          },
          contextWith(),
        ),
      );
      expect(request).toEqual({
        name: 'session.rename',
        version: 1,
        sessionId: SESSION_ID,
        args: { title: 'Ward map' },
      });
    });

    it('accepts 500-char query and 200-char title boundaries', () => {
      const search = expectOk(
        registry.validate(
          searchCall({ query: 'a'.repeat(500) }),
          contextWith(),
        ),
      );
      expect(search.args).toEqual({ query: 'a'.repeat(500), limit: 20 });
      const rename = expectOk(
        registry.validate(
          renameCall({ title: 'b'.repeat(200) }),
          contextWith(),
        ),
      );
      expect(rename.args).toEqual({ title: 'b'.repeat(200) });
    });

    it.each([
      ['session.search', 'query', 500],
      ['session.rename', 'title', 200],
    ] as const)(
      'matches %s schema text constraints before trimming',
      (name, field, max) => {
        const schema = registry.lookup(name)!.argsSchema.properties[field];
        const pattern = new RegExp(schema.pattern as string);
        for (const raw of [
          '',
          ' ',
          '\t\n',
          '\u00a0',
          '\ufeff',
          'a',
          '\u200b',
          'a'.repeat(max),
          'a'.repeat(max + 1),
          ` ${'a'.repeat(max - 2)} `,
          ` ${'a'.repeat(max - 1)} `,
          '\u{1d400}'.repeat(max),
          '\u{1d400}'.repeat(max + 1),
        ]) {
          const length = Array.from(raw).length;
          const expected =
            pattern.test(raw) &&
            length >= (schema.minLength as number) &&
            length <= (schema.maxLength as number);
          const result = registry.validate(
            { name, version: 1, args: { [field]: raw } },
            contextWith(),
          );
          expect(result.ok).toBe(expected);
          if (result.ok) {
            expect(result.request.args).toEqual(
              name === 'session.search'
                ? { query: raw.trim(), limit: 20 }
                : { title: raw.trim() },
            );
          } else {
            expect(result.failure.code).toBe('invalid_args');
          }
        }
      },
    );

    it('rejects whitespace-only strings via pattern', () => {
      for (const blank of [
        '',
        ' ',
        '\t',
        '\n',
        '\u00a0',
        '\u2028',
        '\u3000',
        '\ufeff',
      ]) {
        expect(
          expectFailure(
            registry.validate(searchCall({ query: blank }), contextWith()),
          ).code,
        ).toBe('invalid_args');
        expect(
          expectFailure(
            registry.validate(renameCall({ title: blank }), contextWith()),
          ).code,
        ).toBe('invalid_args');
      }
    });

    it('returns frozen canonical copies decoupled from caller input', () => {
      const input: { args: { query: string } } = {
        args: { query: 'original' },
      };
      const call = { name: 'session.search', version: 1, args: input.args };
      const request = expectOk(registry.validate(call, contextWith()));
      input.args.query = 'MUTATED';
      expect(request.args).toEqual({ query: 'original', limit: 20 });
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.args)).toBe(true);
      expect('approved' in request).toBe(false);
    });

    it('fails unknown tools', () => {
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.delete', version: 1, args: {} },
            contextWith(),
          ),
        ).code,
      ).toBe('unknown_tool');
      expect(
        expectFailure(
          registry.validate({ name: 42, version: 1, args: {} }, contextWith()),
        ).code,
      ).toBe('unknown_tool');
    });

    it('fails tools outside the explicitly allowed names', () => {
      const failure = expectFailure(
        registry.validate(
          { name: 'session.rename', version: 1, args: { title: 'x' } },
          contextWith(['session.search']),
        ),
      );
      expect(failure.code).toBe('unpermitted_tool');
    });

    it('fails unknown or missing versions, including JSON-invalid values', () => {
      const badVersions: unknown[] = [
        2,
        0,
        -1,
        1.5,
        '1',
        'one',
        null,
        true,
        [1],
        { version: 1 },
        { toString: null },
        { toString: '1' },
        { toString: { value: 1 } },
      ];
      for (const version of badVersions) {
        expect(
          expectFailure(
            registry.validate(
              JSON.parse(
                JSON.stringify({
                  name: 'session.search',
                  version,
                  args: { query: 'q' },
                }),
              ),
              contextWith(),
            ),
          ),
        ).toEqual({
          code: 'unknown_version',
          message: 'Unsupported tool version',
        });
      }
      for (const version of [undefined, NaN, Infinity, -Infinity]) {
        expect(
          expectFailure(
            registry.validate(
              { name: 'session.search', version, args: { query: 'q' } },
              contextWith(),
            ),
          ).code,
        ).toBe('unknown_version');
      }
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.search', args: { query: 'q' } },
            contextWith(),
          ),
        ).code,
      ).toBe('unknown_version');
    });

    it('fails extra top-level fields, including smuggled session targets', () => {
      expect(
        expectFailure(
          registry.validate(
            {
              name: 'session.search',
              version: 1,
              args: { query: 'q' },
              sessionId: 'other-session',
            },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_input');
      expect(
        expectFailure(
          registry.validate(
            {
              name: 'session.search',
              version: 1,
              args: { query: 'q' },
              approved: true,
            },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_input');
    });

    it('fails non-object input and non-object args', () => {
      for (const bad of [null, 'x', 42, true, []]) {
        expect(expectFailure(registry.validate(bad, contextWith())).code).toBe(
          'invalid_input',
        );
      }
      for (const badArgs of [null, 'x', 42, []]) {
        expect(
          expectFailure(registry.validate(searchCall(badArgs), contextWith()))
            .code,
        ).toBe('invalid_args');
      }
      expect(
        expectFailure(
          registry.validate(
            { name: 'session.search', version: 1 },
            contextWith(),
          ),
        ).code,
      ).toBe('invalid_args');
    });

    it('narrows canonical argument types by tool name', () => {
      for (const input of [
        searchCall({ query: 'q' }),
        renameCall({ title: 't' }),
      ]) {
        const request = expectOk(registry.validate(input, contextWith()));
        if (request.name === 'session.search') {
          const query: string = request.args.query;
          const limit: number = request.args.limit;
          const hasTitle: 'title' extends keyof typeof request.args
            ? true
            : false = false;
          expect([query, limit, hasTitle]).toEqual(['q', 20, false]);
        } else {
          const title: string = request.args.title;
          const hasQuery: 'query' extends keyof typeof request.args
            ? true
            : false = false;
          expect([title, hasQuery]).toEqual(['t', false]);
        }
      }
    });

    it('fails inherited or non-plain objects for the tool call', () => {
      class Fake {
        name = 'session.search';
        version = 1;
        args = { query: 'q' };
      }
      expect(
        expectFailure(registry.validate(new Fake(), contextWith())).code,
      ).toBe('invalid_input');
      const canonical = {
        name: 'session.search',
        version: 1,
        args: { query: 'q' },
      };
      for (const key of ['name', 'version', 'args'] as const) {
        const inherited = Object.create({ [key]: canonical[key] }) as Record<
          string,
          unknown
        >;
        Object.assign(inherited, canonical);
        delete inherited[key];
        expect(
          expectFailure(registry.validate(inherited, contextWith())).code,
        ).toBe('invalid_input');
      }
      const inheritedExtra = Object.assign(
        Object.create({ extra: true }) as Record<string, unknown>,
        canonical,
      );
      expect(
        expectFailure(registry.validate(inheritedExtra, contextWith())).code,
      ).toBe('invalid_input');
    });

    it('rejects inherited arguments and non-plain argument containers', () => {
      class SearchArgs {
        query = 'q';
      }
      class RenameArgs {
        title = 't';
      }
      const inheritedLimit = Object.assign(
        Object.create({ limit: 99 }) as Record<string, unknown>,
        { query: 'q' },
      );
      for (const input of [
        searchCall(Object.create({ query: 'q' })),
        searchCall(inheritedLimit),
        renameCall(Object.create({ title: 't' })),
        searchCall(new SearchArgs()),
        renameCall(new RenameArgs()),
        searchCall(new Date()),
        renameCall(new Map()),
      ]) {
        expect(
          expectFailure(registry.validate(input, contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('accepts own fields on null-prototype records', () => {
      for (const args of [{ query: 'q' }, { title: 't' }]) {
        const input = Object.assign(
          Object.create(null) as Record<string, unknown>,
          {
            name: 'query' in args ? 'session.search' : 'session.rename',
            version: 1,
            args: Object.assign(
              Object.create(null) as Record<string, unknown>,
              args,
            ),
          },
        );
        expectOk(registry.validate(input, contextWith()));
      }
    });

    it('fails invalid search queries', () => {
      const cases: unknown[] = [
        {},
        { query: '   ' },
        { query: 42 },
        { query: null },
        { query: ['q'] },
        { query: { toString: () => 'q' } },
        { query: 'a'.repeat(501) },
        { query: 'q', sessionId: 'other' },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(searchCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails invalid search limits', () => {
      const cases: unknown[] = [
        { query: 'q', limit: 0 },
        { query: 'q', limit: 101 },
        { query: 'q', limit: 1.5 },
        { query: 'q', limit: '20' },
        { query: 'q', limit: null },
        { query: 'q', limit: true },
        { query: 'q', limit: undefined },
        { query: 'q', limit: Number.NaN },
        { query: 'q', limit: Number.POSITIVE_INFINITY },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(searchCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails invalid rename titles', () => {
      const cases: unknown[] = [
        {},
        { title: '   ' },
        { title: 7 },
        { title: ['t'] },
        { title: { toString: () => 't' } },
        { title: 'b'.repeat(201) },
        { title: 'x', approved: true },
        { title: 'x', limit: 5 },
      ];
      for (const bad of cases) {
        expect(
          expectFailure(registry.validate(renameCall(bad), contextWith())).code,
        ).toBe('invalid_args');
      }
    });

    it('fails when the trusted sessionId is missing or blank', () => {
      expect(
        expectFailure(
          registry.validate(
            searchCall({ query: 'q' }),
            contextWith(ALL_TOOLS, ''),
          ),
        ).code,
      ).toBe('invalid_session');
      expect(
        expectFailure(
          registry.validate(
            searchCall({ query: 'q' }),
            contextWith(ALL_TOOLS, '   '),
          ),
        ).code,
      ).toBe('invalid_session');
    });
  });
});
