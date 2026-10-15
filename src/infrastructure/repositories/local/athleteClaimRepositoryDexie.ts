import { appDb } from '../../db/appDb';
import type { AthleteClaimRepository } from '../../../application/ports';
import type { AthleteClaim } from '../../../domain/types';
import { generateClaimCode, normalizeClaimCode } from '../../../shared/claimCode';

/** 球员认领仓储：维护「球员 ↔ 登录账号」的绑定关系与认领码。 */
export class AthleteClaimRepositoryDexie implements AthleteClaimRepository {
  async listAll(): Promise<AthleteClaim[]> {
    return appDb.athleteClaims.toArray();
  }

  async ensureForAthletes(athleteIds: string[]): Promise<AthleteClaim[]> {
    const existing = await appDb.athleteClaims.toArray();
    const have = new Set(existing.map((row) => row.athleteId));
    const missing = athleteIds.filter((id) => !have.has(id));

    if (missing.length === 0) return existing;

    const usedCodes = new Set(existing.map((row) => row.claimCode));
    const now = Date.now();

    const rows: AthleteClaim[] = missing.map((athleteId) => {
      let code = generateClaimCode();
      let guard = 0;
      while (usedCodes.has(code) && guard < 30) {
        code = generateClaimCode();
        guard += 1;
      }
      usedCodes.add(code);
      return {
        athleteId,
        claimCode: code,
        claimedBy: null,
        claimedAt: null,
        createdAt: now,
        updatedAt: now,
      };
    });

    await appDb.athleteClaims.bulkPut(rows);
    return appDb.athleteClaims.toArray();
  }

  async claimByCode(athleteId: string, code: string, email: string): Promise<void> {
    const row = await appDb.athleteClaims.get(athleteId);
    if (!row) {
      throw new Error('该球员还没有认领码，请刷新页面后重试。');
    }
    if (row.claimedBy === email) return;
    if (row.claimedBy) {
      throw new Error('该球员已被其他账号认领，请先让对方解除。');
    }
    if (normalizeClaimCode(code) !== normalizeClaimCode(row.claimCode)) {
      throw new Error('认领码不正确。');
    }

    await appDb.athleteClaims.update(athleteId, {
      claimedBy: email,
      claimedAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  /**
   * 解除认领。
   *
   * 数据现在是全队共享的一份，球员认领相当于队内的登记，不是私有资产；
   * 认领错了（比如用了别人的邮箱）需要有人能改回来，因此不做"只能解自己"的限制。
   */
  async release(athleteId: string, _email: string): Promise<void> {
    const row = await appDb.athleteClaims.get(athleteId);
    if (!row?.claimedBy) return;
    await appDb.athleteClaims.update(athleteId, {
      claimedBy: null,
      claimedAt: null,
      updatedAt: Date.now(),
    });
  }
}
