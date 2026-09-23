import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';

import type { HealthResponse } from '../models/health';
import {
  DEFAULT_HEALTH_POLL_SECONDS,
  HealthService,
  ramPercent,
} from './health.service';
import { CoreApiService } from './core-api.service';

const STUB_HEALTH: HealthResponse = {
  status: 'healthy',
  runtime: {
    core: { status: 'healthy', detail: 'uptime 12s' },
    sessions: { status: 'healthy', detail: 'sessions database ok' },
    memory: { status: 'healthy', detail: 'memory database ok' },
    llm: {
      status: 'unknown',
      detail: 'configured; reachability not probed',
      provider: 'ollama',
      model: 'test-model',
    },
  },
  host: {
    os: 'TestOS 1.0',
    arch: 'x86_64',
    uptimeSeconds: 12345,
    cpuCores: 16,
    cpuPercent: 6.2,
    loadAverage: [1.42, 1.31, 1.18],
    memoryUsedBytes: Math.round(10.35 * 1024 ** 3),
    memoryTotalBytes: 32 * 1024 ** 3,
    diskUsedBytes: null,
    diskTotalBytes: null,
    gpu: null,
  },
};

describe('HealthService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should populate health on success', async () => {
    const get = vi.fn().mockResolvedValue(STUB_HEALTH);

    await TestBed.configureTestingModule({
      providers: [HealthService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(HealthService);
    await service.refresh();
    expect(service.health()).toEqual(STUB_HEALTH);
    expect(service.error()).toBeNull();
    expect(get).toHaveBeenCalledWith('/core/health');
  });

  it('should keep last-known health and surface the error on failure', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(STUB_HEALTH)
      .mockRejectedValueOnce(new Error('offline'));

    await TestBed.configureTestingModule({
      providers: [HealthService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(HealthService);
    await service.refresh();
    await service.refresh();
    expect(service.health()).toEqual(STUB_HEALTH);
    expect(service.error()).toBe('offline');
  });

  it('should default the poll interval to 5s and clamp slider values', async () => {
    const get = vi.fn().mockResolvedValue(STUB_HEALTH);

    await TestBed.configureTestingModule({
      providers: [HealthService, { provide: CoreApiService, useValue: { get } }],
    }).compileComponents();

    const service = TestBed.inject(HealthService);
    expect(service.pollIntervalSeconds()).toBe(DEFAULT_HEALTH_POLL_SECONDS);

    service.setPollInterval(0);
    expect(service.pollIntervalSeconds()).toBe(1);
    service.setPollInterval(99);
    expect(service.pollIntervalSeconds()).toBe(30);
    service.setPollInterval(10);
    expect(service.pollIntervalSeconds()).toBe(10);
    expect(localStorage.getItem('icos-health-poll-seconds')).toBe('10');
  });

  it('should compute one-decimal RAM percent', () => {
    expect(ramPercent(STUB_HEALTH)).toBeCloseTo(32.3, 1);
  });
});
