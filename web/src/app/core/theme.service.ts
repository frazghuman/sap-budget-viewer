import { Injectable, signal } from '@angular/core';
import { webDarkTheme, webLightTheme } from '@fluentui/tokens';
import { setTheme } from '@fluentui/web-components/theme/set-theme.js';

export type ThemeName = 'dark' | 'light';

const STORAGE_KEY = 'bc.theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly themeSignal = signal<ThemeName>(this.initial());
  readonly theme = this.themeSignal.asReadonly();

  constructor() {
    this.apply(this.themeSignal());
  }

  toggle(): void {
    this.set(this.themeSignal() === 'dark' ? 'light' : 'dark');
  }

  set(theme: ThemeName): void {
    this.themeSignal.set(theme);
    this.apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* private mode — the in-memory signal is still correct */
    }
  }

  private apply(theme: ThemeName): void {
    document.documentElement.setAttribute('data-theme', theme);
    setTheme(theme === 'dark' ? webDarkTheme : webLightTheme);
  }

  private initial(): ThemeName {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      /* ignore */
    }
    return 'light';
  }
}
