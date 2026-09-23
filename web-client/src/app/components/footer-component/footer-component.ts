import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { LucideMoon, LucideSun } from '@lucide/angular';

import { HealthService, ramPercent } from '../../services/health.service';
import { ThemeService } from '../../services/theme.service';

enum ServerStatus {
  ONLINE = 'Online',
  OFFLINE = 'Offline',
}

@Component({
  selector: 'app-footer-component',
  imports: [LucideMoon, LucideSun],
  templateUrl: './footer-component.html',
  styleUrl: './footer-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnInit, OnDestroy {
  private readonly themeService = inject(ThemeService);
  private readonly healthService = inject(HealthService);

  private readonly now = signal(new Date());
  private readonly clockTimer = setInterval(() => {
    this.now.set(new Date());
  }, 1000);
  private healthTimer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // Restart the poll when the settings slider changes the interval.
    // The effect body only manages the timer; the fetch runs async in
    // the timer callback, never as a synchronous signal write.
    effect(() => {
      this.restartHealthPoll(this.healthService.pollIntervalSeconds());
    });
  }

  readonly isDark = computed(() => this.themeService.theme() === 'dark');

  readonly currentDate = computed(() =>
    this.now().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }),
  );

  readonly currentTime = computed(() =>
    this.now().toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }),
  );

  readonly cpuUsage = computed(() => {
    const cpu = this.healthService.health()?.host.cpuPercent;
    return cpu === null || cpu === undefined ? 'n/a' : cpu;
  });

  readonly ramUsage = computed(() => {
    const health = this.healthService.health();
    return health === null ? 'n/a' : ramPercent(health);
  });

  readonly serverStatus = computed(() =>
    this.healthService.health()?.status === 'healthy' &&
    this.healthService.error() === null
      ? ServerStatus.ONLINE
      : ServerStatus.OFFLINE,
  );

  readonly serverStatusClass = computed(() =>
    // Badge-grade text colors: both pass 4.5:1 on either theme background.
    this.serverStatus() === ServerStatus.OFFLINE
      ? 'text-(--accent-red)'
      : 'text-(--badge-sage-text)',
  );

  readonly healthTitle = computed(() => {
    const error = this.healthService.error();
    if (error !== null) {
      return `Health unavailable: ${error}`;
    }
    const health = this.healthService.health();
    if (health === null) {
      return 'Loading system health…';
    }
    const { os, arch, cpuCores } = health.host;
    return `${os} · ${arch} · ${cpuCores} cores`;
  });

  ngOnInit(): void {
    void this.healthService.refresh();
    this.restartHealthPoll(this.healthService.pollIntervalSeconds());
  }

  ngOnDestroy(): void {
    clearInterval(this.clockTimer);
    clearInterval(this.healthTimer);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  private restartHealthPoll(intervalSeconds: number): void {
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => {
      void this.healthService.refresh();
    }, intervalSeconds * 1000);
  }
}
