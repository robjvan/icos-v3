import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { SERVER_URL } from '../../../constants';
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

  readonly theme = this.themeService.theme;
  readonly serverUrl = SERVER_URL;
  readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Dark (smoky granite)' : 'Light (lilac mist)',
  );

  setTheme(theme: 'dark' | 'light'): void {
    this.themeService.set(theme);
  }
}
