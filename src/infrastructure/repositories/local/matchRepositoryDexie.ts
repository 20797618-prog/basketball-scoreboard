import { appDb } from '../../db/appDb';
import type { MatchRepository } from '../../../application/ports';
import type { Match, MatchPlayer } from '../../../domain/types';

export class MatchRepositoryDexie implements MatchRepository {
  async createMatch(match: Match, players: MatchPlayer[]): Promise<void> {
    await appDb.transaction('rw', appDb.matches, appDb.matchPlayers, async () => {
      await appDb.matches.add(match);
      await appDb.matchPlayers.bulkAdd(players);
    });
  }

  async getActiveMatch(): Promise<Match | null> {
    const row = await appDb.matches.where('status').equals('active').last();
    return row ?? null;
  }

  async getPlayers(matchId: string): Promise<MatchPlayer[]> {
    return appDb.matchPlayers.where('matchId').equals(matchId).sortBy('joinOrder');
  }

  async finishMatch(matchId: string): Promise<void> {
    await appDb.matches.update(matchId, {
      status: 'finished',
      finishedAt: Date.now(),
    });
  }

  async listAll(): Promise<Match[]> {
    return appDb.matches.orderBy('createdAt').reverse().toArray();
  }
}
