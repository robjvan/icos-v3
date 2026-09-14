import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { migrateLegacyDatabase } from '../session/database';
import { DatabaseService } from '../session/database.service';

/**
 * The evidence-ledger database: memory candidates.
 * Runs the one-time legacy split migration before opening (idempotent —
 * whichever service initializes first performs it).
 */
@Injectable()
export class MemoryDatabaseService extends DatabaseService {
  private readonly logger = new Logger(MemoryDatabaseService.name);

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    super(config.memoryDbPath, 'memories');
  }

  override onModuleInit(): void {
    const result = migrateLegacyDatabase(
      this.config.legacyDbPath,
      this.config.sessionDbPath,
      this.config.memoryDbPath,
    );
    if (result.migratedMemories) {
      this.logger.log(
        `Migrated legacy candidate ledger to ${this.config.memoryDbPath}`,
      );
    }
    for (const error of result.errors) {
      this.logger.warn(error);
    }
    super.onModuleInit();
  }
}
