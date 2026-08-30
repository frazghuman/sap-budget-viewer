import { Routes } from '@angular/router';

import { authGuard, settingsGuard, uploadGuard, viewGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    canActivate: [viewGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Budget Control — Funds Center Analysis',
  },
  {
    path: 'upload',
    canActivate: [uploadGuard],
    loadComponent: () =>
      import('./features/upload/upload.component').then((m) => m.UploadComponent),
    title: 'Upload budget export — Budget Control',
  },
  {
    path: 'datasets/:id',
    canActivate: [viewGuard],
    loadComponent: () =>
      import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
    title: 'Budget Control — Funds Center Analysis',
  },
  {
    path: 'settings',
    canActivate: [settingsGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
    title: 'Settings — Budget Control',
  },
  {
    path: 'no-access',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/no-access/no-access.component').then((m) => m.NoAccessComponent),
    title: 'No access — Budget Control',
  },
  { path: '**', redirectTo: '' },
];
