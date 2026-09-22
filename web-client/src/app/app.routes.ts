import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./components/dashboard-page/dashboard-page').then((m) => m.DashboardPage),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./components/chat-ui-component/chat-ui-component').then(
            (m) => m.ChatUiComponent,
          ),
      },
    ],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
