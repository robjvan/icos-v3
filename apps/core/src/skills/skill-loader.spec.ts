import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SKILL_FILE,
  SkillParseError,
  loadSkillBody,
  parseSkillFile,
  scanSkillDir,
} from './skill-loader';
import { discoverSkills } from './skill-discovery';

const OPTS = { maxBodyChars: 12000 };

function skillFile(
  name: string,
  description = 'A test skill.',
  version?: string,
  body = 'Do the thing.',
): string {
  const versionLine = version === undefined ? '' : `version: ${version}\n`;
  return `---\nname: ${name}\ndescription: ${description}\n${versionLine}---\n\n${body}\n`;
}

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(SkillParseError);
    return (err as SkillParseError).reason;
  }
  throw new Error('expected SkillParseError');
}

describe('parseSkillFile', () => {
  it('parses a valid skill file', () => {
    expect(
      parseSkillFile(
        skillFile('daily-journal', 'Capture the day.', '0.1.0', 'Ask away.'),
        OPTS,
      ),
    ).toEqual({
      name: 'daily-journal',
      description: 'Capture the day.',
      version: '0.1.0',
      body: 'Ask away.',
    });
  });

  it('defaults a missing version to 0.0.0', () => {
    expect(parseSkillFile(skillFile('a', 'Desc.'), OPTS).version).toBe('0.0.0');
  });

  it('unquotes quoted scalar values', () => {
    const parsed = parseSkillFile(
      '---\nname: a\ndescription: "Quoted desc."\n---\n\nBody.\n',
      OPTS,
    );
    expect(parsed.description).toBe('Quoted desc.');
  });

  it('tolerates CRLF line endings', () => {
    const parsed = parseSkillFile(
      '---\r\nname: a\r\ndescription: Desc.\r\n---\r\n\r\nBody.\r\n',
      OPTS,
    );
    expect(parsed.name).toBe('a');
  });

  it.each([
    [
      'missing opening marker',
      'name: a\ndescription: d\n---\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'missing closing marker',
      '---\nname: a\ndescription: d\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'unknown key',
      '---\nname: a\ndescription: d\nexec: x\n---\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'executable key',
      '---\nname: a\ndescription: d\ntools: [x]\n---\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'duplicate key',
      '---\nname: a\nname: b\ndescription: d\n---\n\nB\n',
      'bad-frontmatter',
    ],
    [
      'malformed line',
      '---\nname: a\njust some words\ndescription: d\n---\n\nB\n',
      'bad-frontmatter',
    ],
    ['uppercase name', skillFile('Bad', 'd'), 'bad-name'],
    ['empty name', skillFile('', 'd'), 'bad-name'],
    ['missing description', '---\nname: a\n---\n\nB\n', 'missing-description'],
    [
      'long description',
      skillFile('a', 'x'.repeat(501)),
      'description-too-long',
    ],
    ['empty body', '---\nname: a\ndescription: d\n---\n', 'empty-body'],
  ])('rejects %s', (_label, raw, reason) => {
    expect(reasonOf(() => parseSkillFile(raw, OPTS))).toBe(reason);
  });

  it('rejects oversize bodies', () => {
    expect(
      reasonOf(() =>
        parseSkillFile(skillFile('a', 'd', undefined, 'x'.repeat(101)), {
          maxBodyChars: 100,
        }),
      ),
    ).toBe('body-too-large');
  });
});

describe('scanSkillDir / loadSkillBody', () => {
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'icos-skills-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeSkill(entry: string, contents: string): void {
    mkdirSync(join(dir, entry), { recursive: true });
    writeFileSync(join(dir, entry, SKILL_FILE), contents);
  }

  it('loads valid skills sorted, skipping invalid entries with reasons', async () => {
    writeSkill(
      'daily-journal',
      skillFile('daily-journal', 'Journal.', '0.2.0', 'Ask.'),
    );
    writeSkill('capture-idea', skillFile('capture-idea', 'Capture.'));
    writeSkill('bad-dir', skillFile('other-name', 'Mismatch.'));
    writeSkill('empty-dir', 'not frontmatter at all');
    mkdirSync(join(dir, 'no-file'));
    mkdirSync(join(dir, '.hidden'));
    writeFileSync(
      join(dir, '.hidden', SKILL_FILE),
      skillFile('.hidden', 'Hidden.'),
    );
    writeFileSync(join(dir, 'stray.txt'), 'ignored');

    const result = await scanSkillDir(dir, OPTS);
    expect(result.dir).toBe(dir);
    expect(result.descriptors).toEqual([
      { name: 'capture-idea', description: 'Capture.', version: '0.0.0' },
      { name: 'daily-journal', description: 'Journal.', version: '0.2.0' },
    ]);
    expect(result.skipped).toEqual([
      { name: 'bad-dir', reason: 'name-mismatch' },
      { name: 'empty-dir', reason: 'bad-frontmatter' },
      { name: 'no-file', reason: 'missing-file' },
    ]);
  });

  it('returns an empty catalog for a missing directory', async () => {
    const result = await scanSkillDir(join(dir, 'does-not-exist'), OPTS);
    expect(result).toEqual({
      dir: join(dir, 'does-not-exist'),
      descriptors: [],
      skipped: [],
    });
  });

  it('refuses symlinks escaping the skills root', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'icos-skills-outside-'));
    try {
      mkdirSync(join(outside, 'evil'), { recursive: true });
      writeFileSync(
        join(outside, 'evil', SKILL_FILE),
        skillFile('evil', 'Escape.'),
      );
      symlinkSync(join(outside, 'evil'), join(dir, 'evil'));
      const result = await scanSkillDir(dir, OPTS);
      expect(result.descriptors).toEqual([]);
      expect(result.skipped).toEqual([
        { name: 'evil', reason: 'symlink-escape' },
      ]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('loads a body from its canonical location', async () => {
    writeSkill(
      'daily-journal',
      skillFile('daily-journal', 'Journal.', '0.2.0', 'Ask.'),
    );
    const parsed = await loadSkillBody(dir, 'daily-journal', OPTS);
    expect(parsed.body).toBe('Ask.');
  });

  it('rejects bodies whose directory name mismatches', async () => {
    writeSkill('bad-dir', skillFile('other-name', 'Mismatch.'));
    await expect(loadSkillBody(dir, 'bad-dir', OPTS)).rejects.toMatchObject({
      name: 'SkillParseError',
    });
  });

  it.each([
    'icos-v3-stack',
    'persona-anchor',
    'daily-journal',
    'comments-pass',
    'capture-idea',
  ])('ship seed %s parses clean under the validator', (name) => {
    const raw = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'docs',
        'skills',
        name,
        SKILL_FILE,
      ),
      'utf8',
    );
    const parsed = parseSkillFile(raw, OPTS);
    expect(parsed.name).toBe(name);
    expect(parsed.body.length).toBeLessThanOrEqual(2000);
  });

  it('anchors discovery on the real icos-v3-stack seed', () => {
    const seeds = join(__dirname, '..', '..', '..', '..', 'docs', 'skills');
    const descriptors = (
      ['icos-v3-stack', 'daily-journal', 'comments-pass'] as const
    ).map((name) => {
      const parsed = parseSkillFile(
        readFileSync(join(seeds, name, SKILL_FILE), 'utf8'),
        OPTS,
      );
      return {
        name: parsed.name,
        description: parsed.description,
        version: parsed.version,
      };
    });
    const matches = discoverSkills(descriptors, 'working on the ICOS v3 stack');
    expect(matches[0]?.skill.name).toBe('icos-v3-stack');
  });
});
