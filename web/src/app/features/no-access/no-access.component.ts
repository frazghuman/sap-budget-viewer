import { CUSTOM_ELEMENTS_SCHEMA, Component, inject } from '@angular/core';

import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-no-access',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <div class="stage">
      <div class="state-block" role="alert">
        <h2>No access to budget data</h2>
        <p>
          You are signed in as <strong>{{ auth.displayName() }}</strong
          >, but your role does not include the <code>budget:view</code> permission. Ask a CAAS One
          administrator to grant it.
        </p>
        <fluent-button appearance="outline" (click)="auth.logout()">Sign out</fluent-button>
      </div>
    </div>
  `,
})
export class NoAccessComponent {
  readonly auth = inject(AuthService);
}
