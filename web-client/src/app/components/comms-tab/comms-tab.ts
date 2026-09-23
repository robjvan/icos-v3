import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** SMS / Email / Discord: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-comms-tab',
  imports: [TabPlaceholder],
  templateUrl: './comms-tab.html',
  styleUrl: './comms-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommsTab {}
