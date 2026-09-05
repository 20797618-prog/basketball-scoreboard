#!/usr/bin/env node
// 修正权限：匿名用户走 anon 角色（不是 authenticated）
// 1. GRANT 给 anon
// 2. 删除旧的 authenticated policy
// 3. 重建 policy 给 anon
import { execFileSync } from 'child_process';

const ENV_ID = 'basketballscoreboard-d5a1794da22';
const TCB = '/Users/kenmaster/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/bin/tcb';

const TABLES = ['athletes', 'matches', 'match_players', 'rounds', 'round_stats', 'cola_ledger'];

const stmts = [];

// GRANT 给 anon
for (const t of TABLES) {
  stmts.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON public.${t} TO anon`);
}

// 删除旧的 authenticated policy
for (const t of TABLES) {
  stmts.push(`DROP POLICY IF EXISTS ${t}_private ON public.${t}`);
}

// 重建 policy 给 anon
for (const t of TABLES) {
  stmts.push(
    `CREATE POLICY ${t}_private ON public.${t} FOR ALL TO anon USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub')) WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))`
  );
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
