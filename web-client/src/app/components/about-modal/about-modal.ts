import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-about-modal',
  imports: [],
  templateUrl: './about-modal.html',
  styleUrl: './about-modal.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AboutModal {}
