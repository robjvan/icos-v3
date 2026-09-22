import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-chat-ui-component',
  imports: [],
  templateUrl: './chat-ui-component.html',
  styleUrl: './chat-ui-component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatUiComponent {}
