import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Agents: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-agents-tab',
  imports: [TabPlaceholder],
  templateUrl: './agents-tab.html',
  styleUrl: './agents-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentsTab {}
