import { Injectable, signal } from '@angular/core';

export type Theme = 'dark' | 'light';

const THEME_STORAGE_KEY = 'icos-theme';

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme);
}

/** Client-side theme preference. Frontend-only; no server backing. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(readStoredTheme());

  toggle(): void {
    this.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.theme.set(theme);
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode, SSR); theme still applies in-memory.
    }
  }

  /** Apply the stored theme before Angular boots to avoid a theme flash. */
  static initFromStorage(): void {
    applyTheme(readStoredTheme());
  }
}
