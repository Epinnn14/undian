import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.module';
import { groups } from './schema';

describe('openDatabase', () => {
  it('creates nested data folders, migrates, and persists across restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'arisan-'));
    const dir = join(root, 'nested', 'pglite');
    try {
      const first = await openDatabase(dir);
      await first
        .insert(groups)
        .values({ name: 'Persist', contribution: 50_000, frequency: 'weekly' });
      await first.$client.close();

      const second = await openDatabase(dir); // migrations are idempotent
      const rows = await second.select().from(groups);
      expect(rows.map((r) => r.name)).toEqual(['Persist']);
      await second.$client.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces the database constraints', async () => {
    const db = await openDatabase(undefined);
    await expect(
      db.insert(groups).values({ name: 'Bad', contribution: 0, frequency: 'monthly' }),
    ).rejects.toThrow();
    await db.$client.close();
  });
});
