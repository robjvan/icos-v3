import { Injectable, signal } from '@angular/core';
import type { ToolAutoApprovePrefs, ToolDescriptor, ToolName } from '../models/tool';

/**
 * Static registry copy. Mirrors core `DESCRIPTORS` in
 * `core/src/tools/tool-registry.ts` (name + description + approval only —
 * the args schemas stay server-side). Update when core adds tools.
 */
export const TOOL_DESCRIPTORS: readonly ToolDescriptor[] = [
  {
    name: 'session.search',
    description: 'Search the current session transcript. Returns matching messages.',
    approval: 'none',
  },
  {
    name: 'session.rename',
    description: 'Rename the current session.',
    approval: 'required',
  },
];

const TOOL_PREFS_STORAGE_KEY = 'icos-tool-auto-approve';

function readStoredPrefs(): ToolAutoApprovePrefs {
  try {
    const raw = localStorage.getItem(TOOL_PREFS_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: ToolAutoApprovePrefs = {};
    for (const descriptor of TOOL_DESCRIPTORS) {
      if (typeof parsed[descriptor.name] === 'boolean') {
        prefs[descriptor.name] = parsed[descriptor.name] as boolean;
      }
    }
    return prefs;
  } catch {
    return {};
  }
}

/**
 * Frontend-only per-tool auto-approve toggles, persisted to `localStorage`.
 * The server has no auto-approve endpoint — these prefs are aspirational
 * until core implements the policy; the tools tab badges them as such.
 */
@Injectable({ providedIn: 'root' })
export class ToolPrefsService {
  readonly autoApprove = signal<ToolAutoApprovePrefs>(readStoredPrefs());

  isAutoApproved(name: ToolName): boolean {
    return this.autoApprove()[name] ?? false;
  }

  setAutoApprove(name: ToolName, value: boolean): void {
    const next = { ...this.autoApprove(), [name]: value };
    this.autoApprove.set(next);
    try {
      localStorage.setItem(TOOL_PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable; prefs still apply in-memory.
    }
  }
}
