import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SERVER_URL } from '../../../constants';
import {
  HealthService,
  MAX_HEALTH_POLL_SECONDS,
  MIN_HEALTH_POLL_SECONDS,
} from '../../services/health.service';
import { ThemeService } from '../../services/theme.service';

/** Client settings: frontend-only prefs (server URL display + theme). */
@Component({
  selector: 'app-client-settings-tab',
  imports: [],
  templateUrl: './client-settings-tab.html',
  styleUrl: './client-settings-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClientSettingsTab {
  private readonly themeService = inject(ThemeService);
  private readonly healthService = inject(HealthService);

  readonly theme = this.themeService.theme;
  readonly serverUrl = SERVER_URL;
  readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Dark (smoky granite)' : 'Light (lilac mist)',
  );

  readonly healthPollSeconds = this.healthService.pollIntervalSeconds;
  readonly minHealthPollSeconds = MIN_HEALTH_POLL_SECONDS;
  readonly maxHealthPollSeconds = MAX_HEALTH_POLL_SECONDS;

  setTheme(theme: 'dark' | 'light'): void {
    this.themeService.set(theme);
  }

  onHealthPollInput(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input === null) {
      return;
    }
    this.healthService.setPollInterval(input.valueAsNumber);
  }
}
