import { appDb } from '../../db/appDb';
import type { ColaTransferRepository } from '../../../application/ports';
import type { ColaTransfer } from '../../../domain/types';

/** 可乐转让申请仓储：只负责存取，状态流转在 colaService 里定义。 */
export class ColaTransferRepositoryDexie implements ColaTransferRepository {
  async listAll(): Promise<ColaTransfer[]> {
    return appDb.colaTransfers.orderBy('createdAt').reverse().toArray();
  }

  async createMany(rows: ColaTransfer[]): Promise<void> {
    if (rows.length === 0) return;
    await appDb.colaTransfers.bulkAdd(rows);
  }

  async patch(id: string, patch: Partial<ColaTransfer>): Promise<void> {
    await appDb.colaTransfers.update(id, patch);
  }
}
