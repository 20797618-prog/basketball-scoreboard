import Dexie, { type Table } from 'dexie';
import type {
  Athlete,
  ColaLedgerEntry,
  Match,
  MatchPlayer,
  Round,
  RoundStat,
} from '../../domain/types';

export interface AppMetaRecord {
  key: string;
  value: unknown;
}

export interface OplogRecord {
  id: string;
  entity: string;
  entityId: string;
  op: 'create' | 'update' | 'delete';
  payload: unknown;
  createdAt: number;
  synced: boolean;
}

export class AppDb extends Dexie {
  athletes!: Table<Athlete, string>;
  matches!: Table<Match, string>;
  matchPlayers!: Table<MatchPlayer, string>;
  rounds!: Table<Round, string>;
  roundStats!: Table<RoundStat, string>;
  colaLedger!: Table<ColaLedgerEntry, string>;
  appMeta!: Table<AppMetaRecord, string>;
  oplog!: Table<OplogRecord, string>;

  constructor() {
    super('free_throw_scoreboard_db');

    this.version(1).stores({
      athletes: 'id, name, isDeleted, createdAt, updatedAt',
      matches: 'id, status, createdAt, finishedAt',
      matchPlayers: 'id, matchId, athleteId, [matchId+athleteId]',
      rounds: 'id, matchId, roundNo, phase, parentRoundId, [matchId+roundNo]',
      roundStats: 'id, roundId, matchId, athleteId, [roundId+athleteId], [matchId+athleteId]',
      colaLedger: 'id, type, fromAthleteId, toAthleteId, createdAt, matchId',
      appMeta: 'key',
      oplog: 'id, entity, entityId, op, createdAt, synced',
    });
  }
}

export const appDb = new AppDb();
