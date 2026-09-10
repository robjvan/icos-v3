import {
  Inject,
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import { CORE_CONFIG } from '../config';
import type { CoreConfig } from '../config';
import { openDatabase } from './database';

/**
 * Owns the Core SQLite connection. Shared by the session transcript
 * store and the memory-candidate evidence ledger — both live in the
 * same database file, but neither knows about the other.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db: Database.Database | null = null;

  constructor(@Inject(CORE_CONFIG) private readonly config: CoreConfig) {}

  onModuleInit(): void {
    // Throws on failure: Core must fail startup without its database.
    this.db = openDatabase(this.config.dbPath);
  }

  onModuleDestroy(): void {
    this.db?.close();
    this.db = null;
  }

  get connection(): Database.Database {
    if (!this.db) {
      throw new Error('Database is not initialized');
    }
    return this.db;
  }
}
