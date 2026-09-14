import {
  HostHealthProvider,
  formatGib,
  formatUptime,
  percent,
} from './host-health';

describe('host health formatting', () => {
  it('formats GiB with one decimal', () => {
    expect(formatGib(12.4 * 1024 ** 3)).toBe('12.4');
    expect(formatGib(0)).toBe('0.0');
  });

  it('formats uptime compactly', () => {
    expect(formatUptime(45)).toBe('0m');
    expect(formatUptime(90)).toBe('1m');
    expect(formatUptime(3720)).toBe('1h 2m');
    expect(formatUptime(3 * 86400 + 7 * 3600 + 12 * 60)).toBe('3d 7h 12m');
  });

  it('computes whole percentages safely', () => {
    expect(percent(1, 4)).toBe(25);
    expect(percent(1, 0)).toBe(0);
  });
});

describe('HostHealthProvider', () => {
  it('collects a well-shaped snapshot without throwing', async () => {
    const provider = new HostHealthProvider();
    const host = await provider.collect();

    expect(typeof host.os).toBe('string');
    expect(host.os.length).toBeGreaterThan(0);
    expect(typeof host.arch).toBe('string');
    expect(host.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(host.cpuCores).toBeGreaterThan(0);
    expect(host.cpuPercent === null || typeof host.cpuPercent).toBeTruthy();
    if (host.cpuPercent !== null) {
      expect(host.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(host.cpuPercent).toBeLessThanOrEqual(100);
    }
    expect(host.loadAverage).toHaveLength(3);
    expect(host.memoryTotalBytes).toBeGreaterThan(0);
    expect(host.memoryUsedBytes).toBeGreaterThanOrEqual(0);
    if (host.gpu) {
      expect(typeof host.gpu.name).toBe('string');
      expect(host.gpu.memoryTotalBytes).toBeGreaterThan(0);
    }
  }, 15000);
});
