import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SERVER_URL } from '../../../constants';
import { ThemeService } from '../../services/theme.service';

/**
 * Settings modal: quick client prefs (theme). Full client settings live on
 * the Client tab; server settings are read-only (no server endpoint).
 */
@Component({
  selector: 'app-settings-modal',
  imports: [],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsModal {
  private readonly themeService = inject(ThemeService);

  readonly theme = this.themeService.theme;
  readonly serverUrl = SERVER_URL;

  setTheme(theme: 'dark' | 'light'): void {
    this.themeService.set(theme);
  }
}
