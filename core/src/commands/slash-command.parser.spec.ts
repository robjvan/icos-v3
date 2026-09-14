import {
  MalformedSlashCommandError,
  isSlashCommandInput,
  parseSlashCommand,
} from './slash-command.parser';

describe('isSlashCommandInput', () => {
  it('detects leading-slash input', () => {
    expect(isSlashCommandInput('/status')).toBe(true);
    expect(isSlashCommandInput('/new extra args')).toBe(true);
    expect(isSlashCommandInput('  /health')).toBe(true);
  });

  it('leaves ordinary messages alone', () => {
    expect(isSlashCommandInput('hello')).toBe(false);
    expect(isSlashCommandInput('use /status for that')).toBe(false);
    expect(isSlashCommandInput('a/b testing')).toBe(false);
    expect(isSlashCommandInput('')).toBe(false);
  });
});

describe('parseSlashCommand', () => {
  it('parses bare commands', () => {
    expect(parseSlashCommand('/status')).toEqual({
      name: 'status',
      args: [],
      raw: '/status',
    });
  });

  it('splits arguments on whitespace', () => {
    const parsed = parseSlashCommand('/rename my session title');
    expect(parsed.name).toBe('rename');
    expect(parsed.args).toEqual(['my', 'session', 'title']);
  });

  it('groups double-quoted arguments', () => {
    const parsed = parseSlashCommand('/rename "my session title"');
    expect(parsed.args).toEqual(['my session title']);
  });

  it('normalizes command names to lowercase', () => {
    expect(parseSlashCommand('/STATUS').name).toBe('status');
    expect(parseSlashCommand('/Restart-Runtime').name).toBe('restart-runtime');
  });

  it('rejects bare slashes and garbage names', () => {
    for (const raw of ['/', '/ ', '/usr/bin', '/foo_bar', '/123']) {
      expect(() => parseSlashCommand(raw)).toThrow(MalformedSlashCommandError);
    }
  });

  it('rejects non-command input', () => {
    expect(() => parseSlashCommand('hello')).toThrow(
      MalformedSlashCommandError,
    );
  });
});
