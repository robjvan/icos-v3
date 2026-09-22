import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Identity: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-identity-tab',
  imports: [TabPlaceholder],
  templateUrl: './identity-tab.html',
  styleUrl: './identity-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdentityTab {}
