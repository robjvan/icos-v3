import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Sensors: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-sensors-tab',
  imports: [TabPlaceholder],
  templateUrl: './sensors-tab.html',
  styleUrl: './sensors-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SensorsTab {}
