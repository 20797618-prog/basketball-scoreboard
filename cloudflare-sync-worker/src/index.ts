// @ts-ignore - account 体系为纯 JS，无类型声明
import * as authRequestCode from '../account/api/auth/request-code.js';
// @ts-ignore
import * as authVerifyCode from '../account/api/auth/verify-code.js';
// @ts-ignore
import * as authLoginPassword from '../account/api/auth/login-password.js';
// @ts-ignore
import * as authSetPassword from '../account/api/auth/set-password.js';
// @ts-ignore
import * as authMe from '../account/api/auth/me.js';
// @ts-ignore
import { resolveSession, normEmail, randomHex, SESSION_TTL } from '../account/_account_lib.js';

export interface Env {
  SYNC_DB: D1Database;
  ACCOUNTS_KV: KVNamespace;
  /** WorkBuddy 应用的数据面地址（用于校验微信身份） */
  WB_AUTH_ENDPOINT?: string;
  /** WorkBuddy 应用的 publishableKey（客户端凭据，非密钥） */
  WB_PUBLISHABLE_KEY?: string;
}

type D1Database = any;
type D1PreparedStatement = any;
type KVNamespace = any;

type RowRecord = Record<string, unknown>;

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      // 跨域时必须允许 authorization，否则从 WorkBuddy 托管域名发起的请求会在预检阶段被浏览器拦掉
      'access-control-allow-headers': 'content-type, authorization',
    },
  });

const asBoolInt = (value: unknown): number => (value ? 1 : 0);

const chunks = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (const batch of chunks(statements, 100)) {
    await db.batch(batch);
  }
}

async function upsertAthletes(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO athletes (sync_code, id, name, is_deleted, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       name = excluded.name,
       is_deleted = excluded.is_deleted,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.name ?? ''),
        asBoolInt(r.isDeleted),
        Number(r.createdAt ?? 0),
        Number(r.updatedAt ?? 0),
      ),
    ),
  );
}

async function upsertMatches(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO matches (sync_code, id, title, status, created_at, finished_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       created_at = excluded.created_at,
       finished_at = excluded.finished_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.title ?? ''),
        String(r.status ?? 'active'),
        Number(r.createdAt ?? 0),
        r.finishedAt == null ? null : Number(r.finishedAt),
      ),
    ),
  );
}

async function upsertMatchPlayers(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO match_players (sync_code, id, match_id, athlete_id, join_order)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       match_id = excluded.match_id,
       athlete_id = excluded.athlete_id,
       join_order = excluded.join_order`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.matchId ?? ''),
        String(r.athleteId ?? ''),
        Number(r.joinOrder ?? 0),
      ),
    ),
  );
}

async function upsertRounds(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO rounds (sync_code, id, match_id, round_no, phase, overtime_seq, parent_round_id, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       match_id = excluded.match_id,
       round_no = excluded.round_no,
       phase = excluded.phase,
       overtime_seq = excluded.overtime_seq,
       parent_round_id = excluded.parent_round_id,
       created_at = excluded.created_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.matchId ?? ''),
        Number(r.roundNo ?? 0),
        String(r.phase ?? 'regular'),
        Number(r.overtimeSeq ?? 0),
        r.parentRoundId == null ? null : String(r.parentRoundId),
        Number(r.createdAt ?? 0),
      ),
    ),
  );
}

async function upsertRoundStats(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO round_stats (sync_code, id, round_id, match_id, athlete_id, attempts, hits, hit_rate, rank_group, point_delta, cola_delta, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       round_id = excluded.round_id,
       match_id = excluded.match_id,
       athlete_id = excluded.athlete_id,
       attempts = excluded.attempts,
       hits = excluded.hits,
       hit_rate = excluded.hit_rate,
       rank_group = excluded.rank_group,
       point_delta = excluded.point_delta,
       cola_delta = excluded.cola_delta,
       created_at = excluded.created_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.roundId ?? ''),
        String(r.matchId ?? ''),
        String(r.athleteId ?? ''),
        Number(r.attempts ?? 0),
        Number(r.hits ?? 0),
        Number(r.hitRate ?? 0),
        String(r.rankGroup ?? 'pending'),
        Number(r.pointDelta ?? 0),
        Number(r.colaDelta ?? 0),
        Number(r.createdAt ?? 0),
      ),
    ),
  );
}

async function upsertColaLedger(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO cola_ledger (sync_code, id, type, from_athlete_id, to_athlete_id, amount, match_id, round_id, note, created_at, operator)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       type = excluded.type,
       from_athlete_id = excluded.from_athlete_id,
       to_athlete_id = excluded.to_athlete_id,
       amount = excluded.amount,
       match_id = excluded.match_id,
       round_id = excluded.round_id,
       note = excluded.note,
       created_at = excluded.created_at,
       operator = excluded.operator`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id),
        String(r.type ?? 'transfer'),
        r.fromAthleteId == null ? null : String(r.fromAthleteId),
        r.toAthleteId == null ? null : String(r.toAthleteId),
        Number(r.amount ?? 0),
        r.matchId == null ? null : String(r.matchId),
        r.roundId == null ? null : String(r.roundId),
        r.note == null ? null : String(r.note),
        Number(r.createdAt ?? 0),
        String(r.operator ?? 'system'),
      ),
    ),
  );
}

const mapAthlete = (r: any) => ({
  id: r.id,
  name: r.name,
  isDeleted: !!r.is_deleted,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const mapMatch = (r: any) => ({
  id: r.id,
  title: r.title,
  status: r.status,
  createdAt: Number(r.created_at),
  finishedAt: r.finished_at == null ? null : Number(r.finished_at),
});

const mapMatchPlayer = (r: any) => ({
  id: r.id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  joinOrder: Number(r.join_order),
});

const mapRound = (r: any) => ({
  id: r.id,
  matchId: r.match_id,
  roundNo: Number(r.round_no),
  phase: r.phase,
  overtimeSeq: Number(r.overtime_seq),
  parentRoundId: r.parent_round_id,
  createdAt: Number(r.created_at),
});

const mapRoundStat = (r: any) => ({
  id: r.id,
  roundId: r.round_id,
  matchId: r.match_id,
  athleteId: r.athlete_id,
  attempts: Number(r.attempts),
  hits: Number(r.hits),
  hitRate: Number(r.hit_rate),
  rankGroup: r.rank_group,
  pointDelta: Number(r.point_delta),
  colaDelta: Number(r.cola_delta),
  createdAt: Number(r.created_at),
});

const mapColaLedger = (r: any) => ({
  id: r.id,
  type: r.type,
  fromAthleteId: r.from_athlete_id,
  toAthleteId: r.to_athlete_id,
  amount: Number(r.amount),
  matchId: r.match_id,
  roundId: r.round_id,
  note: r.note,
  createdAt: Number(r.created_at),
  operator: r.operator,
});

async function upsertAthleteClaims(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO athlete_claims (sync_code, athlete_id, claim_code, claimed_by, claimed_at, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(sync_code, athlete_id) DO UPDATE SET
       claim_code = excluded.claim_code,
       claimed_by = excluded.claimed_by,
       claimed_at = excluded.claimed_at,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.athleteId ?? ''),
        String(r.claimCode ?? ''),
        r.claimedBy == null ? null : String(r.claimedBy),
        r.claimedAt == null ? null : Number(r.claimedAt),
        Number(r.createdAt ?? 0),
        Number(r.updatedAt ?? 0),
      ),
    ),
  );
}

async function upsertColaTransfers(db: D1Database, syncCode: string, rows: RowRecord[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO cola_transfers (sync_code, id, from_athlete_id, to_athlete_id, amount, note, status, created_by_email, decided_by_email, created_at, decided_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(sync_code, id) DO UPDATE SET
       from_athlete_id = excluded.from_athlete_id,
       to_athlete_id = excluded.to_athlete_id,
       amount = excluded.amount,
       note = excluded.note,
       status = excluded.status,
       created_by_email = excluded.created_by_email,
       decided_by_email = excluded.decided_by_email,
       created_at = excluded.created_at,
       decided_at = excluded.decided_at`,
  );
  await runBatches(
    db,
    rows.map((r) =>
      stmt.bind(
        syncCode,
        String(r.id ?? ''),
        String(r.fromAthleteId ?? ''),
        String(r.toAthleteId ?? ''),
        Number(r.amount ?? 0),
        r.note == null ? null : String(r.note),
        String(r.status ?? 'pending'),
        String(r.createdByEmail ?? ''),
        r.decidedByEmail == null ? null : String(r.decidedByEmail),
        Number(r.createdAt ?? 0),
        r.decidedAt == null ? null : Number(r.decidedAt),
      ),
    ),
  );
}

const mapAthleteClaim = (r: any) => ({
  athleteId: r.athlete_id,
  claimCode: r.claim_code,
  claimedBy: r.claimed_by,
  claimedAt: r.claimed_at == null ? null : Number(r.claimed_at),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const mapColaTransfer = (r: any) => ({
  id: r.id,
  fromAthleteId: r.from_athlete_id,
  toAthleteId: r.to_athlete_id,
  amount: Number(r.amount),
  note: r.note,
  status: r.status,
  createdByEmail: r.created_by_email,
  decidedByEmail: r.decided_by_email,
  createdAt: Number(r.created_at),
  decidedAt: r.decided_at == null ? null : Number(r.decided_at),
});

// ============ WorkBuddy（微信登录）身份桥 ============
//
// 安全底线：绝不信任前端传来的 uid。
// Worker 拿前端递来的用户令牌，自己去调用 WorkBuddy 的身份校验接口确认身份，
// 校验通过后才把 uid 与邮箱账号关联（首次绑定一次），并签发我们自己的会话 token。

interface WbVerifyResult {
  uid?: string;
  error?: string;
}

async function verifyWorkBuddyToken(env: Env, wbToken: string): Promise<WbVerifyResult> {
  if (!env.WB_AUTH_ENDPOINT || !env.WB_PUBLISHABLE_KEY) {
    return { error: '服务端尚未配置 WorkBuddy 校验参数（WB_AUTH_ENDPOINT / WB_PUBLISHABLE_KEY）' };
  }
  if (!wbToken) return { error: '缺少 WorkBuddy 令牌' };

  try {
    const res = await fetch(`${env.WB_AUTH_ENDPOINT}/.cloud/auth/v1/user/me`, {
      headers: {
        'x-wb-webapp-access-key': env.WB_PUBLISHABLE_KEY,
        Authorization: `Bearer ${wbToken}`,
      },
    });
    if (!res.ok) {
      return { error: `WorkBuddy 身份校验失败（HTTP ${res.status}）` };
    }
    const data: any = await res.json();
    const uid = data?.user?.id ?? data?.id ?? data?.user_id ?? '';
    if (!uid) return { error: '身份校验响应中缺少 uid' };
    return { uid: String(uid) };
  } catch (err) {
    return { error: `WorkBuddy 身份校验异常：${String(err)}` };
  }
}

/** 按现有账号体系签发会话（与 verify-code 完全一致的机制）。 */
async function issueSession(env: Env, email: string): Promise<string> {
  const token = randomHex(32);
  const exp = Date.now() + SESSION_TTL * 1000;
  await env.ACCOUNTS_KV.put('session:' + token, JSON.stringify({ email, exp }), {
    expirationTtl: SESSION_TTL,
  });
  return token;
}

async function readJsonBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/** POST /api/auth/workbuddy-exchange —— 用微信登录令牌换取本站会话。 */
async function workbuddyExchange(request: Request, env: Env): Promise<Response> {
  const body = await readJsonBody(request);
  const wbToken = String(body?.wbToken ?? '').trim();

  const verified = await verifyWorkBuddyToken(env, wbToken);
  if (verified.error) {
    return json({ error: 'wb_verify_failed', message: verified.error }, 401);
  }

  const row: any = await env.SYNC_DB
    .prepare('SELECT email FROM wb_bindings WHERE wb_uid = ?1')
    .bind(verified.uid)
    .first();

  if (!row?.email) {
    return json(
      {
        error: 'need_bind',
        message: '该微信尚未绑定账号，请先用邮箱验证码登录完成一次绑定。',
      },
      409,
    );
  }

  const token = await issueSession(env, row.email);
  return json({ ok: true, token, email: row.email, wbUid: verified.uid });
}

/** POST /api/auth/workbuddy-bind —— 已用邮箱登录后，把微信与该邮箱绑定。 */
async function workbuddyBind(request: Request, env: Env): Promise<Response> {
  const sess: any = await resolveSession(request, env);
  if (!sess) {
    return json({ error: 'unauthorized', message: '请先用邮箱验证码登录后再绑定' }, 401);
  }

  const body = await readJsonBody(request);
  const wbToken = String(body?.wbToken ?? '').trim();

  const verified = await verifyWorkBuddyToken(env, wbToken);
  if (verified.error) {
    return json({ error: 'wb_verify_failed', message: verified.error }, 401);
  }

  const email = normEmail(sess.email);
  const existing: any = await env.SYNC_DB
    .prepare('SELECT email FROM wb_bindings WHERE wb_uid = ?1')
    .bind(verified.uid)
    .first();

  if (existing?.email && normEmail(existing.email) !== email) {
    return json(
      { error: 'already_bound', message: '该微信已绑定其他账号，请先用原账号解绑。' },
      409,
    );
  }

  const now = Date.now();
  await env.SYNC_DB
    .prepare(
      `INSERT INTO wb_bindings (wb_uid, email, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(wb_uid) DO UPDATE SET
         email = excluded.email,
         updated_at = excluded.updated_at`,
    )
    .bind(verified.uid, email, now, now)
    .run();

  return json({ ok: true, email, wbUid: verified.uid });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 账号认证路由（/api/auth/*），含 OPTIONS，交给 account 体系处理
    if (url.pathname.startsWith('/api/auth/')) {
      const route = url.pathname.slice('/api/auth/'.length);
      if (route === 'workbuddy-exchange') {
        return workbuddyExchange(request, env);
      }
      if (route === 'workbuddy-bind') {
        return workbuddyBind(request, env);
      }
      const handler =
        route === 'request-code'
          ? authRequestCode
          : route === 'verify-code'
            ? authVerifyCode
            : route === 'login-password'
              ? authLoginPassword
              : route === 'set-password'
                ? authSetPassword
                : route === 'me'
                  ? authMe
                  : null;
      if (handler) {
        return handler.onRequest({ request, env });
      }
      return json({ error: 'Not Found' }, 404);
    }

    if (request.method === 'OPTIONS') {
      return json({ ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, service: 'scoreboard-sync-worker' });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method Not Allowed' }, 405);
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return json({ error: '请求体必须是 JSON' }, 400);
    }

    if (url.pathname === '/sync/push') {
      const sess = await resolveSession(request, env);
      if (!sess) {
        return json({ error: '未登录，请先登录' }, 401);
      }
      const syncCode = sess.email;

      const data = payload?.data ?? {};
      const athletes = Array.isArray(data.athletes) ? data.athletes : [];
      const matches = Array.isArray(data.matches) ? data.matches : [];
      const matchPlayers = Array.isArray(data.matchPlayers) ? data.matchPlayers : [];
      const rounds = Array.isArray(data.rounds) ? data.rounds : [];
      const roundStats = Array.isArray(data.roundStats) ? data.roundStats : [];
      const colaLedger = Array.isArray(data.colaLedger) ? data.colaLedger : [];
      const athleteClaims = Array.isArray(data.athleteClaims) ? data.athleteClaims : [];
      const colaTransfers = Array.isArray(data.colaTransfers) ? data.colaTransfers : [];

      try {
        await upsertAthletes(env.SYNC_DB, syncCode, athletes);
        await upsertMatches(env.SYNC_DB, syncCode, matches);
        await upsertMatchPlayers(env.SYNC_DB, syncCode, matchPlayers);
        await upsertRounds(env.SYNC_DB, syncCode, rounds);
        await upsertRoundStats(env.SYNC_DB, syncCode, roundStats);
        await upsertColaLedger(env.SYNC_DB, syncCode, colaLedger);
        await upsertAthleteClaims(env.SYNC_DB, syncCode, athleteClaims);
        await upsertColaTransfers(env.SYNC_DB, syncCode, colaTransfers);
      } catch (err) {
        return json({ error: `写入 D1 失败：${String(err)}` }, 500);
      }

      return json({
        ok: true,
        counts: {
          athletes: athletes.length,
          matches: matches.length,
          matchPlayers: matchPlayers.length,
          rounds: rounds.length,
          roundStats: roundStats.length,
          colaLedger: colaLedger.length,
          athleteClaims: athleteClaims.length,
          colaTransfers: colaTransfers.length,
        },
      });
    }

    if (url.pathname === '/sync/pull') {
      const sess = await resolveSession(request, env);
      if (!sess) {
        return json({ error: '未登录，请先登录' }, 401);
      }
      const syncCode = sess.email;

      try {
        const [athletes, matches, matchPlayers, rounds, roundStats, colaLedger, athleteClaims, colaTransfers] = await Promise.all([
          env.SYNC_DB.prepare('SELECT id, name, is_deleted, created_at, updated_at FROM athletes WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, title, status, created_at, finished_at FROM matches WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, match_id, athlete_id, join_order FROM match_players WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, match_id, round_no, phase, overtime_seq, parent_round_id, created_at FROM rounds WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, round_id, match_id, athlete_id, attempts, hits, hit_rate, rank_group, point_delta, cola_delta, created_at FROM round_stats WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, type, from_athlete_id, to_athlete_id, amount, match_id, round_id, note, created_at, operator FROM cola_ledger WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT athlete_id, claim_code, claimed_by, claimed_at, created_at, updated_at FROM athlete_claims WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
          env.SYNC_DB.prepare('SELECT id, from_athlete_id, to_athlete_id, amount, note, status, created_by_email, decided_by_email, created_at, decided_at FROM cola_transfers WHERE sync_code = ?1')
            .bind(syncCode)
            .all(),
        ]);

        return json({
          ok: true,
          data: {
            athletes: (athletes.results || []).map(mapAthlete),
            matches: (matches.results || []).map(mapMatch),
            matchPlayers: (matchPlayers.results || []).map(mapMatchPlayer),
            rounds: (rounds.results || []).map(mapRound),
            roundStats: (roundStats.results || []).map(mapRoundStat),
            colaLedger: (colaLedger.results || []).map(mapColaLedger),
            athleteClaims: (athleteClaims.results || []).map(mapAthleteClaim),
            colaTransfers: (colaTransfers.results || []).map(mapColaTransfer),
          },
        });
      } catch (err) {
        return json({ error: `读取 D1 失败：${String(err)}` }, 500);
      }
    }

    return json({ error: 'Not Found' }, 404);
  },
};
