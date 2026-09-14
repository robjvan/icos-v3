import { Injectable } from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as os from 'node:os';

export interface GpuHealth {
  name: string;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  temperatureC: number | null;
}

export interface HostHealth {
  os: string;
  arch: string;
  uptimeSeconds: number;
  cpuCores: number;
  /** 0–100, or null when it cannot be measured. */
  cpuPercent: number | null;
  loadAverage: [number, number, number];
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  gpu: GpuHealth | null;
}

/** Delay between CPU time samples for a usage measurement. */
const CPU_SAMPLE_GAP_MS = 150;

function tryExec(
  cmd: string,
  args: string[],
  timeoutMs: number,
): string | null {
  try {
    return execFileSync(cmd, args, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function prettyOs(): string {
  if (os.platform() === 'linux') {
    try {
      const release = readFileSync('/etc/os-release', 'utf8');
      const match = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (match) return match[1];
    } catch {
      // Fall through to the generic description.
    }
    return `Linux ${os.release()}`;
  }
  if (os.platform() === 'darwin') {
    const version = tryExec('sw_vers', ['-productVersion'], 2000);
    return version ? `macOS ${version}` : `macOS (Darwin ${os.release()})`;
  }
  return `${os.type()} ${os.release()}`;
}

function prettyArch(): string {
  switch (os.arch()) {
    case 'x64':
      return 'x86_64';
    case 'arm64':
      return 'arm64';
    default:
      return os.arch();
  }
}

function cpuSnapshot(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

async function measureCpuPercent(): Promise<number | null> {
  try {
    const first = cpuSnapshot();
    await new Promise((resolve) => setTimeout(resolve, CPU_SAMPLE_GAP_MS));
    const second = cpuSnapshot();
    const idleDelta = second.idle - first.idle;
    const totalDelta = second.total - first.total;
    if (totalDelta <= 0) return null;
    return (
      Math.round(((1 - idleDelta / totalDelta) * 100 + Number.EPSILON) * 10) /
      10
    );
  } catch {
    return null;
  }
}

function probeDisk(): { used: number; total: number } | null {
  // On macOS `/` is a small snapshot volume; the data volume holds the
  // real usage. Everywhere else `/` is correct.
  const targets =
    os.platform() === 'darwin' ? ['/System/Volumes/Data', '/'] : ['/'];
  for (const target of targets) {
    // `df -k <target>` has a stable first-data-line shape on both macOS
    // and Linux: filesystem, 1K-blocks, used, available, ...
    const output = tryExec('df', ['-k', target], 3000);
    if (!output) continue;
    const lines = output.split('\n');
    if (lines.length < 2) continue;
    const cols = lines[1].trim().split(/\s+/);
    const totalKb = Number(cols[1]);
    const usedKb = Number(cols[2]);
    if (!Number.isFinite(totalKb) || !Number.isFinite(usedKb)) continue;
    return { used: usedKb * 1024, total: totalKb * 1024 };
  }
  return null;
}

/**
 * macOS "Memory Used" as Activity Monitor reports it: active + wired +
 * compressed pages. `os.freemem()` counts the file cache as used, which
 * reads ~98% on an idle Mac — technically defensible, practically noise.
 */
function probeDarwinMemoryUsed(): number | null {
  const output = tryExec('vm_stat', [], 3000);
  if (!output) return null;
  const pageSize = Number(output.match(/page size of (\d+) bytes/)?.[1]);
  const pages = (label: string): number | null => {
    const value = Number(
      output.match(new RegExp(`${label}:\\s*([\\d]+)`))?.[1],
    );
    return Number.isFinite(value) ? value : null;
  };
  const active = pages('Pages active');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');
  if (!pageSize || active === null || wired === null || compressed === null) {
    return null;
  }
  return (active + wired + compressed) * pageSize;
}

function probeNvidiaGpu(): GpuHealth | null {
  // Single query for name, memory, and temperature; first GPU wins.
  // Absent outside NVIDIA Linux hosts (and some WSL setups) — that is a
  // normal "unavailable", never an error.
  const output = tryExec(
    'nvidia-smi',
    [
      '--query-gpu=name,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits',
    ],
    4000,
  );
  if (!output) return null;
  const cols = output
    .split('\n')[0]
    .split(',')
    .map((col) => col.trim());
  if (cols.length < 4) return null;
  const [name, usedMb, totalMb, tempC] = cols;
  const used = Number(usedMb);
  const total = Number(totalMb);
  const temp = Number(tempC);
  if (!name || !Number.isFinite(used) || !Number.isFinite(total)) return null;
  return {
    name,
    memoryUsedBytes: used * 1024 * 1024,
    memoryTotalBytes: total * 1024 * 1024,
    temperatureC: Number.isFinite(temp) ? temp : null,
  };
}

/**
 * Host-system health. Every probe is best-effort and guarded: a missing
 * source (no NVIDIA card, `df` blocked, exotic OS) yields `null`, never
 * a failed `/health`. Works on macOS (dev) and Linux (deploy).
 */
@Injectable()
export class HostHealthProvider {
  async collect(): Promise<HostHealth> {
    const [cpuPercent, disk, gpu] = await Promise.all([
      measureCpuPercent(),
      Promise.resolve(probeDisk()),
      Promise.resolve(probeNvidiaGpu()),
    ]);
    const totalMem = os.totalmem();
    const darwinUsed =
      os.platform() === 'darwin' ? probeDarwinMemoryUsed() : null;
    return {
      os: prettyOs(),
      arch: prettyArch(),
      uptimeSeconds: Math.floor(os.uptime()),
      cpuCores: os.cpus().length,
      cpuPercent,
      loadAverage: os.loadavg() as [number, number, number],
      memoryUsedBytes: darwinUsed ?? totalMem - os.freemem(),
      memoryTotalBytes: totalMem,
      diskUsedBytes: disk?.used ?? null,
      diskTotalBytes: disk?.total ?? null,
      gpu,
    };
  }
}

export function formatGib(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)}`;
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

export function percent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((used / total) * 100);
}
