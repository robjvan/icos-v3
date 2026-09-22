import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Server settings: read-only note — core exposes no settings endpoint. */
@Component({
  selector: 'app-server-settings-tab',
  imports: [TabPlaceholder],
  templateUrl: './server-settings-tab.html',
  styleUrl: './server-settings-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ServerSettingsTab {}
