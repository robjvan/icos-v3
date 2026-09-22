import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Models: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-models-tab',
  imports: [TabPlaceholder],
  templateUrl: './models-tab.html',
  styleUrl: './models-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelsTab {}
