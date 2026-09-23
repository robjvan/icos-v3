import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TOOL_DESCRIPTORS, ToolPrefsService } from '../../services/tool-prefs.service';
import type { ToolDescriptor } from '../../models/tool';

/**
 * Tools tab: static registry copy + frontend-only auto-approve toggles.
 * The server exposes no tool-list or auto-approve endpoint — prefs persist
 * to `localStorage` and are badged frontend-only until core implements them.
 */
@Component({
  selector: 'app-tools-tab',
  imports: [],
  templateUrl: './tools-tab.html',
  styleUrl: './tools-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsTab {
  private readonly prefs = inject(ToolPrefsService);

  readonly tools = TOOL_DESCRIPTORS;
  readonly prefsState = this.prefs.autoApprove;

  readonly autoApprovedCount = computed(
    () => TOOL_DESCRIPTORS.filter((tool) => this.prefsState()[tool.name] ?? false).length,
  );

  isChecked(tool: ToolDescriptor): boolean {
    return this.prefsState()[tool.name] ?? false;
  }

  toggle(tool: ToolDescriptor, checked: boolean): void {
    this.prefs.setAutoApprove(tool.name, checked);
  }

  approvalLabel(tool: ToolDescriptor): string {
    return tool.approval === 'required' ? 'approval required' : 'no approval';
  }
}
