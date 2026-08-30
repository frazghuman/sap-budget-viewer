import { bootstrapApplication } from '@angular/platform-browser';

import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';
import { registerFluentComponents } from './app/core/fluent';

registerFluentComponents();

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
