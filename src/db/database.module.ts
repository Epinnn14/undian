import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle, PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema';

export const DB = Symbol('DB');
export type Db = PgliteDatabase<typeof schema> & { $client: PGlite };

function migrationsFolder(): string {
  const candidates = [join(__dirname, '../drizzle'), join(__dirname, '../../drizzle')];
  const found = candidates.find((dir) => existsSync(join(dir, 'meta/_journal.json')));
  if (!found) throw new Error(`drizzle migrations not found in ${candidates.join(', ')}`);
  return found;
}

/**
 * Opens PGlite (Postgres compiled to WASM — no server to install) and applies migrations.
 * `PGLITE_DIR` persists data on disk; leave it unset for an in-memory database.
 */
export async function openDatabase(dataDir = process.env.PGLITE_DIR): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true }); // PGlite won't create parent folders
  const client = new PGlite(dataDir);
  const db = drizzle({ client, schema }) as Db;
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

@Global()
@Module({
  providers: [{ provide: DB, useFactory: () => openDatabase() }],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Db) {}

  async onApplicationShutdown() {
    await this.db.$client.close();
  }
}
