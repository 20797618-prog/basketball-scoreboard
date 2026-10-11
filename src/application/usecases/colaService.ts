import type {
  AthleteClaim,
  ColaLedgerEntry,
  ColaTransfer,
} from '../../domain/types';
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

// ============ 转让双方确认 ============

/** 由 A 发起转让：生成「待确认」申请，此时不动任何人的余额。 */
export function buildPendingTransfers(
  fromAthleteId: string,
  targets: TransferTarget[],
  note: string | undefined,
  createdByEmail: string,
): ColaTransfer[] {
  const createdAt = Date.now();

  return targets.map((target) => ({
    id: createId(),
    fromAthleteId,
    toAthleteId: target.toAthleteId,
    amount: target.amount,
    note: note ?? null,
    status: 'pending' as const,
    createdByEmail,
    decidedByEmail: null,
    createdAt,
    decidedAt: null,
  }));
}

/**
 * 申请被同意后，转成正式账本条目。
 * id 由申请 id 派生，保证同一笔申请重复入账也只有一条（幂等）。
 */
export function buildLedgerEntryFromTransfer(transfer: ColaTransfer): ColaLedgerEntry {
  return {
    id: `transfer-entry-${transfer.id}`,
    type: 'transfer',
    fromAthleteId: transfer.fromAthleteId,
    toAthleteId: transfer.toAthleteId,
    amount: transfer.amount,
    matchId: null,
    roundId: null,
    note: transfer.note,
    createdAt: transfer.decidedAt ?? Date.now(),
    operator: 'user',
  };
}

/** 找出某个登录账号认领的全部球员 id。 */
export function listMyAthleteIds(claims: AthleteClaim[], email: string): string[] {
  if (!email) return [];
  const target = email.trim().toLowerCase();
  return claims
    .filter((row) => (row.claimedBy ?? '').trim().toLowerCase() === target)
    .map((row) => row.athleteId);
}

/** 需要「我」确认的申请：转给我认领的球员，且不是我发起的。 */
export function listPendingForMe(
  transfers: ColaTransfer[],
  myAthleteIds: string[],
  email: string,
): ColaTransfer[] {
  const mine = new Set(myAthleteIds);
  const me = email.trim().toLowerCase();
  return transfers.filter(
    (row) =>
      row.status === 'pending' &&
      mine.has(row.toAthleteId) &&
      row.createdByEmail.trim().toLowerCase() !== me,
  );
}

/** 「我」发起、还在等对方确认的申请（可撤销）。 */
export function listPendingFromMe(
  transfers: ColaTransfer[],
  email: string,
): ColaTransfer[] {
  const me = email.trim().toLowerCase();
  return transfers.filter(
    (row) => row.status === 'pending' && row.createdByEmail.trim().toLowerCase() === me,
  );
}
