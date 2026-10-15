import { appDb } from '../../db/appDb';
import type { AthleteRepository } from '../../../application/ports';
import type { Athlete } from '../../../domain/types';
import { createId } from '../../../shared/createId';

export class AthleteRepositoryDexie implements AthleteRepository {
  async listActive(): Promise<Athlete[]> {
    return appDb.athletes.filter((item) => !item.isDeleted).toArray();
  }

  async listAll(): Promise<Athlete[]> {
    return appDb.athletes.toArray();
  }

  async create(name: string): Promise<Athlete> {
    const now = Date.now();
    const row: Athlete = {
      id: createId(),
      name,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
    };
    await appDb.athletes.add(row);
    return row;
  }

  async updateName(id: string, name: string): Promise<void> {
    await appDb.athletes.update(id, { name, updatedAt: Date.now() });
  }

  async softDelete(id: string): Promise<void> {
    await appDb.athletes.update(id, { isDeleted: true, updatedAt: Date.now() });
  }

  async restore(id: string): Promise<void> {
    await appDb.athletes.update(id, { isDeleted: false, updatedAt: Date.now() });
  }
}
