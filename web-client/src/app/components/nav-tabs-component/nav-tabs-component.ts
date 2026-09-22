import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LucideInfo, LucideMessageSquare, LucideSettings } from '@lucide/angular';

import { ThemeService } from '../../services/theme.service';

interface NavTab {
  readonly path: string;
  readonly label: string;
  readonly icon: 'chat' | 'settings' | 'info';
}

// Phase 0 shell: only the chat tab routes anywhere. Remaining blueprint tabs
// land as lazy placeholder routes in Phase 2.
const CHAT_TABS: readonly NavTab[] = [{ path: '', label: 'Chat', icon: 'chat' }];

@Component({
  selector: 'app-nav-tabs-component',
  imports: [RouterLink, RouterLinkActive, LucideInfo, LucideMessageSquare, LucideSettings],
  templateUrl: './nav-tabs-component.html',
  styleUrl: './nav-tabs-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavTabsComponent {
  private readonly themeService = inject(ThemeService);

  readonly tabs = CHAT_TABS;
  readonly theme = this.themeService.theme;
  readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );

  toggleTheme(): void {
    this.themeService.toggle();
  }

  tabIcon(tab: NavTab): 'chat' | 'settings' | 'info' {
    return tab.icon;
  }
}
