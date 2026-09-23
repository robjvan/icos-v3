import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TabPlaceholder } from '../tab-placeholder/tab-placeholder';

/** MCP servers: placeholder — no server backing (see milestone pointer). */
@Component({
  selector: 'app-mcp-tab',
  imports: [TabPlaceholder],
  templateUrl: './mcp-tab.html',
  styleUrl: './mcp-tab.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class McpTab {}
