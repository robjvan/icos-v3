import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Knowledge base: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-kb-tab',
  imports: [TabPlaceholder],
  templateUrl: './kb-tab.html',
  styleUrl: './kb-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KbTab {}
