import { isAbsolute, join, relative } from 'node:path';
import { promises as fs } from 'node:fs';
import type { Dirent } from 'node:fs';
import type { SkillDescriptor, SkillSkipped } from './skill.types';

/** Entry file per skill directory (case-sensitive). */
export const SKILL_FILE = 'SKILL.md';

/** Skill names are kebab-case, 1–64 chars, and must equal the directory. */
export const NAME_PATTERN = /^[a-z0-9-]{1,64}$/;

/** Frontmatter description cap: one-line capability summary. */
export const MAX_DESCRIPTION_CHARS = 500;

/** Frontmatter version cap: informational label only. */
export const MAX_VERSION_CHARS = 64;

/** Machine-readable validation failure. `reason` is the skip code
 * reported by `/skills` and the inspection endpoints. */
export class SkillParseError extends Error {
  constructor(
    readonly reason: string,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
    this.name = 'SkillParseError';
  }
}

export interface ParsedSkillFile {
  name: string;
  description: string;
  version: string;
  body: string;
}

const KNOWN_FRONTMATTER_KEYS = new Set(['name', 'description', 'version']);

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Minimal `---`-delimited frontmatter parser for the three known keys.
 * Fail-closed: unknown keys, duplicates, and malformed lines reject the
 * skill rather than being silently ignored.
 */
export function parseSkillFile(
  raw: string,
  opts: { maxBodyChars: number },
): ParsedSkillFile {
  const normalized = raw.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0]?.trim() !== '---') {
    throw new SkillParseError('bad-frontmatter', 'missing opening --- marker');
  }
  const closing = lines.findIndex(
    (line, index) => index > 0 && line.trim() === '---',
  );
  if (closing < 0) {
    throw new SkillParseError('bad-frontmatter', 'missing closing --- marker');
  }
  const seen = new Map<string, string>();
  for (const line of lines.slice(1, closing)) {
    if (!line.trim()) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      throw new SkillParseError(
        'bad-frontmatter',
        `malformed line: "${line.trim()}"`,
      );
    }
    const key = match[1];
    if (!KNOWN_FRONTMATTER_KEYS.has(key)) {
      throw new SkillParseError('bad-frontmatter', `unknown key "${key}"`);
    }
    if (seen.has(key)) {
      throw new SkillParseError('bad-frontmatter', `duplicate key "${key}"`);
    }
    seen.set(key, unquote(match[2].trim()));
  }
  const name = seen.get('name') ?? '';
  if (!NAME_PATTERN.test(name)) {
    throw new SkillParseError(
      'bad-name',
      `"${name}" must match ${String(NAME_PATTERN)}`,
    );
  }
  const description = seen.get('description') ?? '';
  if (!description) {
    throw new SkillParseError('missing-description', 'description is empty');
  }
  if (description.length > MAX_DESCRIPTION_CHARS) {
    throw new SkillParseError(
      'description-too-long',
      `${description.length} chars exceeds ${MAX_DESCRIPTION_CHARS}`,
    );
  }
  const version = seen.get('version') || '0.0.0';
  if (version.length > MAX_VERSION_CHARS) {
    throw new SkillParseError(
      'bad-frontmatter',
      `version exceeds ${MAX_VERSION_CHARS} chars`,
    );
  }
  const body = lines
    .slice(closing + 1)
    .join('\n')
    .trim();
  if (!body) {
    throw new SkillParseError('empty-body', 'skill body is empty');
  }
  if (body.length > opts.maxBodyChars) {
    throw new SkillParseError(
      'body-too-large',
      `${body.length} chars exceeds ${opts.maxBodyChars}`,
    );
  }
  return { name, description, version, body };
}

export interface SkillScanResult {
  dir: string;
  descriptors: SkillDescriptor[];
  skipped: SkillSkipped[];
}

/**
 * Scan a skills directory into validated descriptors. Reads each
 * `SKILL.md` once for fail-closed validation but retains descriptors only;
 * bodies are (re-)read on explicit `loadSkillBody()`. Missing directory is
 * a valid empty catalog. Never writes, never follows escaping symlinks.
 */
export async function scanSkillDir(
  dir: string,
  opts: { maxBodyChars: number },
): Promise<SkillScanResult> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { dir, descriptors: [], skipped: [] };
    }
    throw err;
  }
  const descriptors: SkillDescriptor[] = [];
  const skipped: SkillSkipped[] = [];
  const seen = new Set<string>();
  for (const entry of [...entries].sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    try {
      const stat = entry.isSymbolicLink()
        ? await fs.stat(await containedRealpath(dir, full))
        : await fs.stat(full);
      if (!stat.isDirectory()) continue;
    } catch (err) {
      skipped.push({
        name: entry.name,
        reason: err instanceof SkillParseError ? err.reason : 'unreadable',
      });
      continue;
    }
    let parsed: ParsedSkillFile;
    try {
      const raw = await fs.readFile(join(full, SKILL_FILE), 'utf8');
      parsed = parseSkillFile(raw, opts);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        skipped.push({ name: entry.name, reason: 'missing-file' });
      } else if (err instanceof SkillParseError) {
        skipped.push({ name: entry.name, reason: err.reason });
      } else {
        skipped.push({ name: entry.name, reason: 'unreadable' });
      }
      continue;
    }
    if (parsed.name !== entry.name) {
      skipped.push({ name: entry.name, reason: 'name-mismatch' });
      continue;
    }
    const key = parsed.name.toLowerCase();
    if (seen.has(key)) {
      skipped.push({ name: entry.name, reason: 'duplicate' });
      continue;
    }
    seen.add(key);
    descriptors.push({
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
    });
  }
  return { dir, descriptors, skipped };
}

/** Resolve a symlink target, rejecting escapes from the skills root. */
async function containedRealpath(root: string, path: string): Promise<string> {
  const real = await fs.realpath(path);
  const rel = relative(root, real);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new SkillParseError(
      'symlink-escape',
      `"${path}" escapes skills root`,
    );
  }
  return real;
}

/**
 * Read + validate one skill body from its canonical location. Explicit
 * operation — discovery and catalog listing never call this.
 */
export async function loadSkillBody(
  dir: string,
  entryName: string,
  opts: { maxBodyChars: number },
): Promise<ParsedSkillFile> {
  const raw = await fs.readFile(join(dir, entryName, SKILL_FILE), 'utf8');
  const parsed = parseSkillFile(raw, opts);
  if (parsed.name !== entryName) {
    throw new SkillParseError(
      'name-mismatch',
      `directory "${entryName}" declares name "${parsed.name}"`,
    );
  }
  return parsed;
}
