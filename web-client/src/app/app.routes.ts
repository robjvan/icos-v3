import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/dashboard-page/dashboard-page').then((m) => m.DashboardPage),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./components/chat-ui-component/chat-ui-component').then(
            (m) => m.ChatUiComponent,
          ),
      },
      {
        path: 'agents',
        loadComponent: () =>
          import('./components/agents-tab/agents-tab').then((m) => m.AgentsTab),
      },
      {
        path: 'tools',
        loadComponent: () =>
          import('./components/tools-tab/tools-tab').then((m) => m.ToolsTab),
      },
      {
        path: 'skills',
        loadComponent: () =>
          import('./components/skills-tab/skills-tab').then((m) => m.SkillsTab),
      },
      {
        path: 'files',
        loadComponent: () =>
          import('./components/files-tab/files-tab').then((m) => m.FilesTab),
      },
      {
        path: 'memory',
        loadComponent: () =>
          import('./components/memory-tab/memory-tab').then((m) => m.MemoryTab),
      },
      {
        path: 'kb',
        loadComponent: () => import('./components/kb-tab/kb-tab').then((m) => m.KbTab),
      },
      {
        path: 'sensors',
        loadComponent: () =>
          import('./components/sensors-tab/sensors-tab').then((m) => m.SensorsTab),
      },
      {
        path: 'mcp',
        loadComponent: () => import('./components/mcp-tab/mcp-tab').then((m) => m.McpTab),
      },
      {
        path: 'models',
        loadComponent: () =>
          import('./components/models-tab/models-tab').then((m) => m.ModelsTab),
      },
      {
        path: 'cron',
        loadComponent: () => import('./components/cron-tab/cron-tab').then((m) => m.CronTab),
      },
      {
        path: 'metrics',
        loadComponent: () =>
          import('./components/metrics-tab/metrics-tab').then((m) => m.MetricsTab),
      },
      {
        path: 'client-settings',
        loadComponent: () =>
          import('./components/client-settings-tab/client-settings-tab').then(
            (m) => m.ClientSettingsTab,
          ),
      },
      {
        path: 'server-settings',
        loadComponent: () =>
          import('./components/server-settings-tab/server-settings-tab').then(
            (m) => m.ServerSettingsTab,
          ),
      },
      {
        path: 'comms',
        loadComponent: () =>
          import('./components/comms-tab/comms-tab').then((m) => m.CommsTab),
      },
      {
        path: 'identity',
        loadComponent: () =>
          import('./components/identity-tab/identity-tab').then((m) => m.IdentityTab),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
