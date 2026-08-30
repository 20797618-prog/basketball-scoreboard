import type { ColaLedgerEntry } from '../../domain/types';
import { createId } from '../../shared/createId';

export interface TransferTarget {
  toAthleteId: string;
  amount: number;
}

export function buildTransferEntries(
  fromAthleteId: string,
  targets: TransferTarget[],
  note?: string,
): ColaLedgerEntry[] {
  const createdAt = Date.now();

  return targets.map((target) => ({
    id: createId(),
    type: 'transfer',
    fromAthleteId,
    toAthleteId: target.toAthleteId,
    amount: target.amount,
    matchId: null,
    roundId: null,
    note: note ?? null,
    createdAt,
    operator: 'user',
  }));
}

export function buildConsumeEntry(
  athleteId: string,
  amount: number,
  note?: string,
): ColaLedgerEntry {
  return {
    id: createId(),
    type: 'consume',
    fromAthleteId: athleteId,
    toAthleteId: null,
    amount,
    matchId: null,
    roundId: null,
    note: note ?? null,
    createdAt: Date.now(),
    operator: 'user',
  };
}

export function calculateColaBalances(
  athleteIds: string[],
  entries: ColaLedgerEntry[],
): Record<string, number> {
  const result: Record<string, number> = {};
  athleteIds.forEach((id) => {
    result[id] = 0;
  });

  entries.forEach((entry) => {
    if (entry.fromAthleteId) {
      result[entry.fromAthleteId] = (result[entry.fromAthleteId] ?? 0) - entry.amount;
    }
    if (entry.toAthleteId) {
      result[entry.toAthleteId] = (result[entry.toAthleteId] ?? 0) + entry.amount;
    }
  });

  return result;
}
