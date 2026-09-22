import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** Generated files: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-files-tab',
  imports: [TabPlaceholder],
  templateUrl: './files-tab.html',
  styleUrl: './files-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FilesTab {}
