import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Honest placeholder card for tabs without server backing. No fake data —
 * only the badge, the milestone pointer, and a short description.
 */
@Component({
  selector: 'app-tab-placeholder',
  imports: [],
  templateUrl: './tab-placeholder.html',
  styleUrl: './tab-placeholder.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabPlaceholder {
  readonly title = input.required<string>();
  readonly description = input.required<string>();
  readonly milestone = input.required<string>();
}
