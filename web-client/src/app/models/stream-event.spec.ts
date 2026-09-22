import { parseStreamBlock, splitStreamBlocks } from './stream-event';

describe('parseStreamBlock', () => {
  it('should parse a token event', () => {
    const event = parseStreamBlock('event: token\ndata: {"type":"token","content":"hello"}');
    expect(event).toEqual({ type: 'token', content: 'hello' });
  });

  it('should parse a meta event', () => {
    const event = parseStreamBlock(
      'event: meta\ndata: {"type":"meta","sessionId":"s1","model":"m","requestId":"r1"}',
    );
    expect(event?.type).toBe('meta');
    if (event?.type === 'meta') {
      expect(event.sessionId).toBe('s1');
    }
  });

  it('should parse a done event with approval payload', () => {
    const event = parseStreamBlock(
      'event: done\ndata: {"type":"done","reply":"wait","model":"m","requestId":"r1","status":"approval_required","approval":{"approvalId":"a1","invocationId":"i1","tool":"t","args":{}}}',
    );
    expect(event?.type).toBe('done');
    if (event?.type === 'done') {
      expect(event.status).toBe('approval_required');
      expect(event.approval?.approvalId).toBe('a1');
    }
  });

  it('should return null for keep-alives and malformed frames', () => {
    expect(parseStreamBlock(': keep-alive')).toBeNull();
    expect(parseStreamBlock('event: token')).toBeNull();
    expect(parseStreamBlock('')).toBeNull();
  });
});

describe('splitStreamBlocks', () => {
  it('should split complete blocks and keep the remainder', () => {
    const { blocks, rest } = splitStreamBlocks(
      'event: token\ndata: {"a":1}\n\nevent: token\ndata: {"a":2}\n\npartial',
    );
    expect(blocks).toHaveLength(2);
    expect(rest).toBe('partial');
  });

  it('should handle split chunks across reads', () => {
    const first = splitStreamBlocks('event: token\ndata: {"a"');
    expect(first.blocks).toHaveLength(0);
    const second = splitStreamBlocks(`${first.rest}:1}\n\n`);
    expect(second.blocks).toHaveLength(1);
    expect(second.rest).toBe('');
  });
});
