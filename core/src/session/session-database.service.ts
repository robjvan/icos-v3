import { Inject, Injectable, Logger } from '@nestjs/common';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { migrateLegacyDatabase } from './database';
import { DatabaseService } from './database.service';

/**
 * The transcript database: sessions, messages, FTS index.
 * Runs the one-time legacy split migration before opening.
 */
@Injectable()
export class SessionDatabaseService extends DatabaseService {
  private readonly logger = new Logger(SessionDatabaseService.name);

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {
    super(config.sessionDbPath, 'sessions');
  }

  override onModuleInit(): void {
    const result = migrateLegacyDatabase(
      this.config.legacyDbPath,
      this.config.sessionDbPath,
      this.config.memoryDbPath,
    );
    if (result.migratedSessions) {
      this.logger.log(
        `Migrated legacy transcript database to ${this.config.sessionDbPath}`,
      );
    }
    for (const error of result.errors) {
      this.logger.warn(error);
    }
    super.onModuleInit();
  }
}
