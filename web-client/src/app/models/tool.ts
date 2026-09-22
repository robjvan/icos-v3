/** Tool names known to core. Mirrors `ToolName` in `core/src/tools/tool-registry.ts`. */
export type ToolName = 'session.search' | 'session.rename';

export type ToolApprovalPolicy = 'none' | 'required';

/** Static registry copy. Mirrors core `ToolDescriptor` (description + approval). */
export interface ToolDescriptor {
  readonly name: ToolName;
  readonly description: string;
  readonly approval: ToolApprovalPolicy;
}

/** Frontend-only auto-approve prefs, persisted to `localStorage`. */
export type ToolAutoApprovePrefs = Partial<Record<ToolName, boolean>>;
