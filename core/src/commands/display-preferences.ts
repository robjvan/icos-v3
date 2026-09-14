import { Injectable } from '@nestjs/common';

export interface DisplayPreferences {
  showThinking: boolean;
  showTimestamps: boolean;
}

const DEFAULTS: DisplayPreferences = {
  showThinking: true,
  showTimestamps: false,
};

/**
 * Per-session presentation toggles (`/thinking`, `/timestamps`).
 * Ephemeral by design: these describe how a client renders, not what
 * happened — a future dedicated client owns its own display state and
 * restarts reset these to defaults. Stored timestamps are never touched.
 */
@Injectable()
export class DisplayPreferenceStore {
  private readonly prefs = new Map<string, DisplayPreferences>();

  get(sessionId: string): DisplayPreferences {
    return { ...(this.prefs.get(sessionId) ?? DEFAULTS) };
  }

  /** Defaults for sessions with no stored preference. */
  defaults(): DisplayPreferences {
    return { ...DEFAULTS };
  }

  set(
    sessionId: string,
    update: Partial<DisplayPreferences>,
  ): DisplayPreferences {
    const next = { ...this.get(sessionId), ...update };
    this.prefs.set(sessionId, next);
    return { ...next };
  }
}
