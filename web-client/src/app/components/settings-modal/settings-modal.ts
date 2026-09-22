import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-settings-modal',
  imports: [],
  templateUrl: './settings-modal.html',
  styleUrl: './settings-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsModal {}
