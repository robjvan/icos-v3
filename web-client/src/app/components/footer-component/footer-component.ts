import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { LucideMoon, LucideSun } from '@lucide/angular';

import { ThemeService } from '../../services/theme.service';

enum ServerStatus {
  ONLINE = 'Online',
  OFFLINE = 'Offline',
}

// TODO(core health endpoint): all values below are static placeholders. There
// is no HTTP /health endpoint — health today is only the `/health`
// slash-command text via the conversation API. Wire this footer to a real
// server endpoint once one lands; until then never present these as live data.
@Component({
  selector: 'app-footer-component',
  imports: [LucideMoon, LucideSun],
  templateUrl: './footer-component.html',
  styleUrl: './footer-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FooterComponent implements OnDestroy {
  private readonly themeService = inject(ThemeService);

  private readonly now = signal(new Date());
  private readonly timer = setInterval(() => {
    this.now.set(new Date());
  }, 1000);

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

  readonly serverStatusClass = computed(() =>
    this.serverStatus === ServerStatus.OFFLINE
      ? 'text-(--accent-red)'
      : 'text-(--accent-sage)',
  );

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  toggleTheme(): void {
    this.themeService.toggle();
  }

  get currentContext(): string {
    const ctx = 216000; // TODO: Replace with values from backend
    let maxCtx = 1000000; // TODO: Replace with values from backend

    const used = ctx / maxCtx;

    if (maxCtx > 999999) {
      maxCtx = maxCtx / 1000000;
    } else {
      maxCtx = maxCtx / 1000;
    }

    return maxCtx > 999999
      ? `${used * 100}% ${ctx / 1000}k of ${maxCtx}K`
      : `${used * 100}% ${ctx / 1000}k of ${maxCtx}M`;
  }

  get cpuUsage(): number {
    return 6.2;
  }

  get ramUsage(): number {
    return 32.3;
  }

  get serverStatus(): ServerStatus {
    return ServerStatus.ONLINE;
  }
}
