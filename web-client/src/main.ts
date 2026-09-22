import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { ThemeService } from './app/services/theme.service';

ThemeService.initFromStorage();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
