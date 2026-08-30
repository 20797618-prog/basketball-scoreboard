import { appDb } from '../../db/appDb';
import type { RoundRepository } from '../../../application/ports';
import type { Round, RoundStat } from '../../../domain/types';

export class RoundRepositoryDexie implements RoundRepository {
  async createRound(round: Round): Promise<void> {
    await appDb.rounds.add(round);
  }

  async saveRoundStats(rows: RoundStat[]): Promise<void> {
    await appDb.roundStats.bulkAdd(rows);
  }

  async getRoundsByMatch(matchId: string): Promise<Round[]> {
    return appDb.rounds.where('matchId').equals(matchId).sortBy('createdAt');
  }

  async getRoundStatsByMatch(matchId: string): Promise<RoundStat[]> {
    return appDb.roundStats.where('matchId').equals(matchId).toArray();
  }

  async listAllRounds(): Promise<Round[]> {
    const rows = await appDb.rounds.toArray();
    return rows.sort((a, b) => a.createdAt - b.createdAt);
  }

  async listAllRoundStats(): Promise<RoundStat[]> {
    return appDb.roundStats.toArray();
  }

  async deleteRoundWithStats(roundId: string): Promise<void> {
    await appDb.transaction('rw', appDb.rounds, appDb.roundStats, async () => {
      await appDb.rounds.delete(roundId);
      const statIds = await appDb.roundStats
        .where('roundId')
        .equals(roundId)
        .primaryKeys();
      if (statIds.length > 0) {
        await appDb.roundStats.bulkDelete(statIds);
      }
    });
  }
}
