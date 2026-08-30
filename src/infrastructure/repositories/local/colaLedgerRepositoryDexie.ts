import { appDb } from '../../db/appDb';
import type { ColaLedgerRepository } from '../../../application/ports';
import type { ColaLedgerEntry } from '../../../domain/types';

export class ColaLedgerRepositoryDexie implements ColaLedgerRepository {
  async append(entries: ColaLedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await appDb.colaLedger.bulkAdd(entries);
  }

  async listAll(): Promise<ColaLedgerEntry[]> {
    return appDb.colaLedger.orderBy('createdAt').reverse().toArray();
  }

  async deleteByRound(roundId: string): Promise<void> {
    const ids = await appDb.colaLedger
      .where('roundId')
      .equals(roundId)
      .primaryKeys();
    if (ids.length > 0) {
      await appDb.colaLedger.bulkDelete(ids);
    }
  }
}
