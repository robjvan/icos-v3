import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import type { HealthResponse } from '../../models/health';
import { HealthService } from '../../services/health.service';
import { FooterComponent } from './footer-component';

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

describe('FooterComponent', () => {
  let component: FooterComponent;
  let fixture: ComponentFixture<FooterComponent>;
  let health: ReturnType<typeof signal<HealthResponse | null>>;
  let healthError: ReturnType<typeof signal<string | null>>;
  let refresh: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    health = signal<HealthResponse | null>({ ...STUB_HEALTH });
    healthError = signal<string | null>(null);
    refresh = vi.fn().mockResolvedValue(undefined);

    await TestBed.configureTestingModule({
      imports: [FooterComponent],
      providers: [
        {
          provide: HealthService,
          useValue: {
            health,
            error: healthError,
            pollIntervalSeconds: signal(5),
            refresh,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FooterComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should expose a theme toggle label matching the current theme', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    const button = compiled.querySelector('button[aria-label]');
    expect(button?.getAttribute('aria-label')).toContain('theme');
    expect(component.isDark()).toBe(true);
  });

  it('should render live CPU and RAM from the health service', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Online');
    expect(compiled.textContent).toContain('CPU: 6.2 %');
    expect(compiled.textContent).toContain('RAM: 32.3 %');
    expect(compiled.textContent).not.toContain('Context:');
  });

  it('should show Offline when health polling fails', () => {
    health.set(null);
    healthError.set('offline');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Offline');
    expect(component.serverStatus()).toBe('Offline');
  });

  it('should refresh health on init and clean up its timers on destroy', () => {
    fixture.detectChanges();
    expect(refresh).toHaveBeenCalled();
    const clearSpy = vi.spyOn(window, 'clearInterval');
    component.ngOnDestroy();
    // Clock timer + health poll timer.
    expect(clearSpy).toHaveBeenCalledTimes(2);
  });
});
