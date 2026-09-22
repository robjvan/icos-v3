import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Metrics: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-metrics-tab',
  imports: [TabPlaceholder],
  templateUrl: './metrics-tab.html',
  styleUrl: './metrics-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MetricsTab {}
