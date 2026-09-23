export type HealthCheckStatus = 'healthy' | 'degraded' | 'unknown';

/** Mirrors core `HealthCheck` (`core/src/health/health-report.ts`). */
export interface HealthCheck {
  readonly status: HealthCheckStatus;
  readonly detail: string;
}

/** Mirrors core `LlmHealthCheck`: config state only, never a live probe. */
export interface LlmHealthCheck extends HealthCheck {
  readonly provider: string;
  readonly model: string;
}

/** Mirrors core `GpuHealth`: null when the host has no NVIDIA GPU. */
export interface GpuHealth {
  readonly name: string;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly temperatureC: number | null;
}

/** Mirrors core `HostHealth`: every probe is best-effort, null when unavailable. */
export interface HostHealth {
  readonly os: string;
  readonly arch: string;
  readonly uptimeSeconds: number;
  readonly cpuCores: number;
  /** 0–100, or null when it cannot be measured. */
  readonly cpuPercent: number | null;
  readonly loadAverage: readonly [number, number, number];
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly gpu: GpuHealth | null;
}

/** Mirrors core `GET /core/health` response. */
export interface HealthResponse {
  readonly status: 'healthy' | 'degraded';
  readonly runtime: {
    readonly core: HealthCheck;
    readonly sessions: HealthCheck;
    readonly memory: HealthCheck;
    readonly llm: LlmHealthCheck;
  };
  readonly host: HostHealth;
}
