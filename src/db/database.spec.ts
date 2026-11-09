import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from './database.module';
import { prizes, undian } from './schema';

describe('openDatabase', () => {
  it('creates nested data folders, migrates, and persists across restarts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'undian-'));
    const dir = join(root, 'nested', 'pglite');
    try {
      const first = await openDatabase(dir);
      await first.insert(undian).values({ name: 'Persist' });
      await first.$client.close();

      const second = await openDatabase(dir); // migrations are idempotent
      const rows = await second.select().from(undian);
      expect(rows.map((r) => r.name)).toEqual(['Persist']);
      await second.$client.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces the database constraints', async () => {
    const db = await openDatabase(undefined);
    const [u] = await db.insert(undian).values({ name: 'Constraints' }).returning();
    await expect(
      db.insert(prizes).values({ undianId: u.id, name: 'Nothing', quantity: 0, position: 1 }),
    ).rejects.toThrow();
    await db.insert(prizes).values({ undianId: u.id, name: 'Kipas', position: 1 });
    await expect(
      db.insert(prizes).values({ undianId: u.id, name: 'Setrika', position: 1 }),
    ).rejects.toThrow(); // one prize per draw position
    await db.$client.close();
  });
});
