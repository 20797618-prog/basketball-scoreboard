#!/usr/bin/env node
// 恢复码方案改造：
// 1. 给 6 张表加 sync_code 列（text NOT NULL DEFAULT ''）
// 2. 禁用 RLS（改为应用层按 sync_code 过滤，因为 RLS 无法感知请求体里的 sync_code）
// 3. 保留 anon 的 GRANT 权限
import { execFileSync } from 'child_process';

const ENV_ID = 'basketballscoreboard-d5a1794da22';
const TCB = '/Users/kenmaster/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/bin/tcb';

const TABLES = ['athletes', 'matches', 'match_players', 'rounds', 'round_stats', 'cola_ledger'];

const stmts = [];

// 加 sync_code 列
for (const t of TABLES) {
  stmts.push(`ALTER TABLE public.${t} ADD COLUMN IF NOT EXISTS sync_code text NOT NULL DEFAULT ''`);
}

// 禁用 RLS（改为应用层过滤）
for (const t of TABLES) {
  stmts.push(`ALTER TABLE public.${t} DISABLE ROW LEVEL SECURITY`);
}

// 确保 anon 有全表权限（已有，但再确认一次不报错）
for (const t of TABLES) {
  stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO anon`);
}

const run = (sql) => {
  try {
    const out = execFileSync(TCB, ['db', 'execute', '-e', ENV_ID, '--sql', sql, '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: !/error|InternalError|denied|failed/i.test(out), out };
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').toString();
    return { ok: !/error|InternalError|denied|failed/i.test(msg), out: msg };
  }
};

let ok = 0, failed = 0;
for (let i = 0; i < stmts.length; i++) {
  const sql = stmts[i];
  const preview = sql.length > 60 ? sql.slice(0, 60) + '...' : sql;
  process.stdout.write(`[${i + 1}/${stmts.length}] ${preview}\n  → `);
  const r = run(sql);
  if (r.ok) { console.log('OK'); ok++; }
  else {
    console.log('FAILED: ' + r.out.replace(/\n/g, ' ').slice(0, 200));
    failed++;
  }
}
console.log(`\n=== 完成：成功 ${ok}，失败 ${failed} ===`);
