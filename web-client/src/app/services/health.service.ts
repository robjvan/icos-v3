import { Injectable, inject, signal } from '@angular/core';
import { HEALTH_ENDPOINT } from '../../constants';
import type { HealthResponse } from '../models/health';
import { CoreApiService } from './core-api.service';

/** Default footer health poll interval (seconds). */
export const DEFAULT_HEALTH_POLL_SECONDS = 5;
/** Minimum footer health poll interval (seconds). */
export const MIN_HEALTH_POLL_SECONDS = 1;
/** Maximum footer health poll interval (seconds). */
export const MAX_HEALTH_POLL_SECONDS = 30;

const HEALTH_POLL_STORAGE_KEY = 'icos-health-poll-seconds';

function readStoredPollInterval(): number {
  try {
    const raw = localStorage.getItem(HEALTH_POLL_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_HEALTH_POLL_SECONDS;
    }
    return clampPollInterval(Number(raw));
  } catch {
    return DEFAULT_HEALTH_POLL_SECONDS;
  }
}

function clampPollInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_HEALTH_POLL_SECONDS;
  }
  return Math.min(
    MAX_HEALTH_POLL_SECONDS,
    Math.max(MIN_HEALTH_POLL_SECONDS, Math.round(value)),
  );
}

/** RAM usage percent from a health payload, one-decimal precision. */
export function ramPercent(health: HealthResponse): number {
  const { memoryUsedBytes, memoryTotalBytes } = health.host;
  if (memoryTotalBytes <= 0) {
    return 0;
  }
  return (
    Math.round((memoryUsedBytes / memoryTotalBytes) * 1000) / 10
  );
}

/**
 * Pollable system health for the footer status bar.
 * Auxiliary surface: failures degrade to the `error` signal and never
 * break chat. Poll scheduling lives in the consumer (footer) so the
 * interval slider can restart it; this service owns fetch + state.
 */
@Injectable({ providedIn: 'root' })
export class HealthService {
  private readonly api = inject(CoreApiService);

  readonly health = signal<HealthResponse | null>(null);
  readonly error = signal<string | null>(null);
  readonly pollIntervalSeconds = signal<number>(readStoredPollInterval());

  async refresh(): Promise<void> {
    this.error.set(null);
    try {
      const data = await this.api.get<HealthResponse>(HEALTH_ENDPOINT);
      this.health.set(data);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : String(error));
    }
  }

  setPollInterval(seconds: number): void {
    const next = clampPollInterval(seconds);
    this.pollIntervalSeconds.set(next);
    try {
      localStorage.setItem(HEALTH_POLL_STORAGE_KEY, String(next));
    } catch {
      // Storage unavailable; interval still applies in-memory.
    }
  }
}
