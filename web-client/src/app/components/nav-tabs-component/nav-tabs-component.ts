import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import {
  LucideActivity,
  LucideBookOpen,
  LucideBot,
  LucideBrain,
  LucideClock,
  LucideCpu,
  LucideFolder,
  LucideGauge,
  LucideInfo,
  LucideMail,
  LucideMessageSquare,
  LucidePlug,
  LucideRadio,
  LucideServer,
  LucideSettings,
  LucideSparkles,
  LucideUser,
  LucideWrench,
} from '@lucide/angular';

import { ThemeService } from '../../services/theme.service';
import { AboutModal } from '../about-modal/about-modal';

export type NavTabIcon =
  | 'chat'
  | 'agents'
  | 'tools'
  | 'skills'
  | 'files'
  | 'memory'
  | 'kb'
  | 'sensors'
  | 'mcp'
  | 'models'
  | 'cron'
  | 'metrics'
  | 'client-settings'
  | 'server-settings'
  | 'comms'
  | 'identity';

export interface NavTab {
  readonly path: string;
  readonly label: string;
  readonly icon: NavTabIcon;
  readonly exact: boolean;
}

const ALL_TABS: readonly NavTab[] = [
  { path: '', label: 'Chat', icon: 'chat', exact: true },
  { path: 'agents', label: 'Agents', icon: 'agents', exact: true },
  { path: 'tools', label: 'Tools', icon: 'tools', exact: true },
  { path: 'skills', label: 'Skills', icon: 'skills', exact: true },
  { path: 'files', label: 'Files', icon: 'files', exact: true },
  { path: 'memory', label: 'Memory', icon: 'memory', exact: true },
  { path: 'kb', label: 'KB', icon: 'kb', exact: true },
  { path: 'sensors', label: 'Sensors', icon: 'sensors', exact: true },
  { path: 'mcp', label: 'MCP', icon: 'mcp', exact: true },
  { path: 'models', label: 'Models', icon: 'models', exact: true },
  { path: 'cron', label: 'Cron', icon: 'cron', exact: true },
  { path: 'metrics', label: 'Metrics', icon: 'metrics', exact: true },
  { path: 'client-settings', label: 'Client', icon: 'client-settings', exact: true },
  { path: 'server-settings', label: 'Server', icon: 'server-settings', exact: true },
  { path: 'comms', label: 'Comms', icon: 'comms', exact: true },
  { path: 'identity', label: 'Identity', icon: 'identity', exact: true },
];

@Component({
  selector: 'app-nav-tabs-component',
  imports: [
    RouterLink,
    RouterLinkActive,
    AboutModal,
    LucideActivity,
    LucideBookOpen,
    LucideBot,
    LucideBrain,
    LucideClock,
    LucideCpu,
    LucideFolder,
    LucideGauge,
    LucideInfo,
    LucideMail,
    LucideMessageSquare,
    LucidePlug,
    LucideRadio,
    LucideServer,
    LucideSettings,
    LucideSparkles,
    LucideUser,
    LucideWrench,
  ],
  templateUrl: './nav-tabs-component.html',
  styleUrl: './nav-tabs-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavTabsComponent {
  private readonly themeService = inject(ThemeService);

  readonly tabs = ALL_TABS;
  readonly theme = this.themeService.theme;
  readonly aboutOpen = signal(false);
  readonly themeLabel = computed(() =>
    this.theme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
  );

  toggleTheme(): void {
    this.themeService.toggle();
  }

  openAbout(): void {
    this.aboutOpen.set(true);
  }

  closeAbout(): void {
    this.aboutOpen.set(false);
  }

  tabIcon(tab: NavTab): NavTabIcon {
    return tab.icon;
  }
}
