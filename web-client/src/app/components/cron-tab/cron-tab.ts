import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Cron jobs: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-cron-tab',
  imports: [TabPlaceholder],
  templateUrl: './cron-tab.html',
  styleUrl: './cron-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CronTab {}
