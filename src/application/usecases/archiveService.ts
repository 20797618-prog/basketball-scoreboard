import { z } from 'zod';
import { appDb } from '../../infrastructure/db/appDb';
import type {
  Athlete,
  AthleteClaim,
  ColaLedgerEntry,
  ColaTransfer,
  Match,
  MatchPlayer,
  Round,
  RoundStat,
} from '../../domain/types';
import type { AppMetaRecord, OplogRecord } from '../../infrastructure/db/appDb';

const CURRENT_SCHEMA_VERSION = 1;

const athleteSchema = z.object({
  id: z.string(),
  name: z.string(),
  isDeleted: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const matchSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.union([z.literal('active'), z.literal('finished')]),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});

const matchPlayerSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  athleteId: z.string(),
  joinOrder: z.number(),
});

const roundSchema = z.object({
  id: z.string(),
  matchId: z.string(),
  roundNo: z.number(),
  phase: z.union([
    z.literal('regular'),
    z.literal('overtime_loser'),
    z.literal('overtime_winner'),
    z.literal('overtime_duel'),
  ]),
  overtimeSeq: z.number(),
  parentRoundId: z.string().nullable(),
  createdAt: z.number(),
});

const roundStatSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  matchId: z.string(),
  athleteId: z.string(),
  attempts: z.number(),
  hits: z.number(),
  hitRate: z.number(),
  rankGroup: z.union([
    z.literal('winner'),
    z.literal('loser'),
    z.literal('middle'),
    z.literal('pending'),
  ]),
  pointDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  colaDelta: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  createdAt: z.number(),
});

const colaLedgerSchema = z.object({
  id: z.string(),
  type: z.union([
    z.literal('round_reward'),
    z.literal('transfer'),
    z.literal('consume'),
    z.literal('adjust_reversal'),
  ]),
  fromAthleteId: z.string().nullable(),
  toAthleteId: z.string().nullable(),
  amount: z.number(),
  matchId: z.string().nullable(),
  roundId: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.number(),
  operator: z.union([z.literal('system'), z.literal('user')]),
});

const appMetaSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

const athleteClaimSchema = z.object({
  athleteId: z.string(),
  claimCode: z.string(),
  claimedBy: z.string().nullable(),
  claimedAt: z.number().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const colaTransferSchema = z.object({
  id: z.string(),
  fromAthleteId: z.string(),
  toAthleteId: z.string(),
  amount: z.number(),
  note: z.string().nullable(),
  status: z.union([
    z.literal('pending'),
    z.literal('approved'),
    z.literal('rejected'),
    z.literal('canceled'),
  ]),
  createdByEmail: z.string(),
  decidedByEmail: z.string().nullable(),
  createdAt: z.number(),
  decidedAt: z.number().nullable(),
});

const oplogSchema = z.object({
  id: z.string(),
  entity: z.string(),
  entityId: z.string(),
  op: z.union([z.literal('create'), z.literal('update'), z.literal('delete')]),
  payload: z.unknown(),
  createdAt: z.number(),
  synced: z.boolean(),
});

const archiveSchema = z.object({
  schemaVersion: z.number(),
  exportedAt: z.number(),
  data: z.object({
    athletes: z.array(athleteSchema),
    matches: z.array(matchSchema),
    matchPlayers: z.array(matchPlayerSchema),
    rounds: z.array(roundSchema),
    roundStats: z.array(roundStatSchema),
    colaLedger: z.array(colaLedgerSchema),
    // 旧存档没有这两项，给默认值以便向后兼容
    athleteClaims: z.array(athleteClaimSchema).default([]),
    colaTransfers: z.array(colaTransferSchema).default([]),
    appMeta: z.array(appMetaSchema),
    oplog: z.array(oplogSchema),
  }),
});

export interface ArchivePayload {
  schemaVersion: number;
  exportedAt: number;
  data: {
    athletes: Athlete[];
    matches: Match[];
    matchPlayers: MatchPlayer[];
    rounds: Round[];
    roundStats: RoundStat[];
    colaLedger: ColaLedgerEntry[];
    athleteClaims: AthleteClaim[];
    colaTransfers: ColaTransfer[];
    appMeta: AppMetaRecord[];
    oplog: OplogRecord[];
  };
}

export async function exportArchive(): Promise<ArchivePayload> {
  const [
    athletes,
    matches,
    matchPlayers,
    rounds,
    roundStats,
    colaLedger,
    athleteClaims,
    colaTransfers,
    appMeta,
    oplog,
  ] = await Promise.all([
    appDb.athletes.toArray(),
    appDb.matches.toArray(),
    appDb.matchPlayers.toArray(),
    appDb.rounds.toArray(),
    appDb.roundStats.toArray(),
    appDb.colaLedger.toArray(),
    appDb.athleteClaims.toArray(),
    appDb.colaTransfers.toArray(),
    appDb.appMeta.toArray(),
    appDb.oplog.toArray(),
  ]);

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    data: {
      athletes,
      matches,
      matchPlayers,
      rounds,
      roundStats,
      colaLedger,
      athleteClaims,
      colaTransfers,
      appMeta,
      oplog,
    },
  };
}

export function archiveToJson(payload: ArchivePayload): string {
  return JSON.stringify(payload, null, 2);
}

function migrateArchive(raw: unknown): ArchivePayload {
  const parsed = archiveSchema.parse(raw);

  if (parsed.schemaVersion === CURRENT_SCHEMA_VERSION) {
    return parsed as ArchivePayload;
  }

  throw new Error(`不支持的存档版本：${parsed.schemaVersion}`);
}

export async function importArchiveFromJson(jsonText: string): Promise<void> {
  const raw = JSON.parse(jsonText) as unknown;
  const payload = migrateArchive(raw);

  await appDb.transaction(
    'rw',
    [
      appDb.athletes,
      appDb.matches,
      appDb.matchPlayers,
      appDb.rounds,
      appDb.roundStats,
      appDb.colaLedger,
      appDb.athleteClaims,
      appDb.colaTransfers,
      appDb.appMeta,
      appDb.oplog,
    ],
    async () => {
      await Promise.all([
        appDb.athletes.clear(),
        appDb.matches.clear(),
        appDb.matchPlayers.clear(),
        appDb.rounds.clear(),
        appDb.roundStats.clear(),
        appDb.colaLedger.clear(),
        appDb.athleteClaims.clear(),
        appDb.colaTransfers.clear(),
        appDb.appMeta.clear(),
        appDb.oplog.clear(),
      ]);

      if (payload.data.athletes.length > 0) await appDb.athletes.bulkAdd(payload.data.athletes);
      if (payload.data.matches.length > 0) await appDb.matches.bulkAdd(payload.data.matches);
      if (payload.data.matchPlayers.length > 0) {
        await appDb.matchPlayers.bulkAdd(payload.data.matchPlayers);
      }
      if (payload.data.rounds.length > 0) await appDb.rounds.bulkAdd(payload.data.rounds);
      if (payload.data.roundStats.length > 0) {
        await appDb.roundStats.bulkAdd(payload.data.roundStats);
      }
      if (payload.data.colaLedger.length > 0) {
        await appDb.colaLedger.bulkAdd(payload.data.colaLedger);
      }
      const claims = payload.data.athleteClaims ?? [];
      if (claims.length > 0) {
        await appDb.athleteClaims.bulkAdd(claims);
      }
      const transfers = payload.data.colaTransfers ?? [];
      if (transfers.length > 0) {
        await appDb.colaTransfers.bulkAdd(transfers);
      }
      if (payload.data.appMeta.length > 0) await appDb.appMeta.bulkAdd(payload.data.appMeta);
      if (payload.data.oplog.length > 0) await appDb.oplog.bulkAdd(payload.data.oplog);

      await appDb.appMeta.put({ key: 'schemaVersion', value: CURRENT_SCHEMA_VERSION });
      await appDb.appMeta.put({ key: 'lastImportedAt', value: Date.now() });
    },
  );
}
