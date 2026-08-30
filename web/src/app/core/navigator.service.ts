import { Injectable } from '@angular/core';

/**
 * Full-page navigation, behind an injectable so the OIDC redirect can be
 * asserted in tests instead of actually unloading the karma page.
 */
@Injectable({ providedIn: 'root' })
export class BrowserNavigator {
  redirect(url: string): void {
    window.location.href = url;
  }

  currentPath(): string {
    return window.location.pathname + window.location.search;
  }
}
