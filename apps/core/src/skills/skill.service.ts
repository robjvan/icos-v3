import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { loadSkillBody, scanSkillDir } from './skill-loader';
import type { ParsedSkillFile } from './skill-loader';
import type {
  LoadedSkill,
  SkillDescriptor,
  SkillLoadReport,
} from './skill.types';

/**
 * Filesystem skill registry (M7a). Owns validated descriptors in memory
 * plus a body cache; the filesystem stays the writer. No LLM contact, no
 * SQLite, no transcript writes. Disabled mode behaves as an empty catalog.
 */
@Injectable()
export class SkillService implements OnModuleInit {
  private readonly logger = new Logger(SkillService.name);
  private descriptors = new Map<string, SkillDescriptor>();
  private bodies = new Map<string, LoadedSkill>();
  private report: SkillLoadReport = {
    dir: '',
    scanned: 0,
    loaded: 0,
    skipped: [],
  };

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  get enabled(): boolean {
    return this.config.skillsEnabled === true;
  }

  get skillsDir(): string {
    return this.config.skillsDirPath;
  }

  /** Re-scan the catalog from disk, replacing registry state and dropping
   * the body cache. Idempotent. Never throws on invalid content — skips
   * are reported, not raised. */
  async refresh(): Promise<SkillLoadReport> {
    const dir = this.config.skillsDirPath;
    if (!this.enabled || !dir) {
      this.descriptors = new Map();
      this.bodies = new Map();
      this.report = { dir: dir ?? '', scanned: 0, loaded: 0, skipped: [] };
      return this.report;
    }
    const scanned = await scanSkillDir(dir, {
      maxBodyChars: this.config.skillsMaxBodyChars,
    });
    const next = new Map<string, SkillDescriptor>();
    for (const descriptor of scanned.descriptors) {
      next.set(descriptor.name.toLowerCase(), descriptor);
    }
    this.descriptors = next;
    this.bodies = new Map();
    this.report = {
      dir,
      scanned: scanned.descriptors.length + scanned.skipped.length,
      loaded: scanned.descriptors.length,
      skipped: scanned.skipped,
    };
    if (scanned.skipped.length > 0) {
      this.logger.warn(
        `Skills refresh skipped ${scanned.skipped.length}: ${scanned.skipped
          .map((s) => `${s.name} (${s.reason})`)
          .join(', ')}`,
      );
    }
    return this.report;
  }

  /** Last scan outcome, including skip reasons. */
  getReport(): SkillLoadReport {
    return this.report;
  }

  /** Alphabetical descriptors — no body reads, safe for discovery/catalog. */
  listDescriptors(): SkillDescriptor[] {
    return [...this.descriptors.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /** Explicit body load from the canonical location, cached per scan
   * generation. Unknown names → 404; disabled catalog → 400. */
  async loadBody(name: string): Promise<LoadedSkill> {
    if (!this.enabled) {
      throw new BadRequestException(
        'Skills are disabled (SKILLS_ENABLED=false).',
      );
    }
    const key = name.toLowerCase();
    const descriptor = this.descriptors.get(key);
    if (!descriptor) {
      throw new NotFoundException(`Unknown skill "${name}"`);
    }
    const cached = this.bodies.get(key);
    if (cached) return cached;
    let parsed: ParsedSkillFile;
    try {
      parsed = await loadSkillBody(this.config.skillsDirPath, descriptor.name, {
        maxBodyChars: this.config.skillsMaxBodyChars,
      });
    } catch {
      // File changed or vanished since the scan: evict rather than serve
      // stale or invalid content.
      this.descriptors.delete(key);
      throw new NotFoundException(`Skill "${name}" is unavailable`);
    }
    const loaded: LoadedSkill = {
      name: parsed.name,
      description: parsed.description,
      version: parsed.version,
      body: parsed.body,
      bodyChars: parsed.body.length,
    };
    this.bodies.set(key, loaded);
    return loaded;
  }
}
