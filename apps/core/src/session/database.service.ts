import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Database from 'better-sqlite3';
import { openDatabase } from './database';
import type { DatabaseSchema } from './database';

/**
 * Owns one Core SQLite connection. Subclassed per database file so each
 * store gets its own lifecycle while sharing open/close semantics.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db: Database.Database | null = null;

  constructor(
    private readonly dbPath: string,
    private readonly schema: DatabaseSchema,
  ) {}

  onModuleInit(): void {
    // Throws on failure: Core must fail startup without its stores.
    this.db = openDatabase(this.dbPath, this.schema);
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
