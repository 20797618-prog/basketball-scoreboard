#!/usr/bin/env node
// 逐条执行 migrate-pg.sql 的 SQL（通过 tcb db execute）
// 用法: node scripts/run-migrate.mjs
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const ENV_ID = 'basketballscoreboard-d5a1794da22';
const TCB = '/Users/kenmaster/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/bin/tcb';

const raw = readFileSync(new URL('./migrate-pg.sql', import.meta.url), 'utf8');
const lines = raw.split('\n').filter((l) => !l.trim().startsWith('--'));
const stmts = lines.join('\n').split(';').map((s) => s.trim()).filter((s) => s.length > 0);

console.log(`共 ${stmts.length} 条 SQL\n`);

let ok = 0;
let failed = 0;

for (let i = 0; i < stmts.length; i++) {
  const sql = stmts[i];
  const preview = sql.length > 70 ? sql.slice(0, 70) + '...' : sql;
  process.stdout.write(`[${i + 1}/${stmts.length}] ${preview}\n  → `);

  const run = (s) => {
    try {
      const out = execFileSync(TCB, ['db', 'execute', '-e', ENV_ID, '--sql', s, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { ok: !/error|InternalError|denied|failed/i.test(out), out };
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || '').toString();
      return { ok: !/error|InternalError|denied|failed/i.test(msg), out: msg };
    }
  };

  let r = run(sql);
  if (r.ok) {
    console.log('OK');
    ok++;
  } else {
    // 包装为 DO $$ 匿名块重试
    console.log('直接执行失败，尝试 DO $$ 包装...');
    const wrapped = `DO LANGUAGE plpgsql $$ BEGIN EXECUTE '${sql.replace(/'/g, "''")}'; END $$`;
    const r2 = run(wrapped);
    if (r2.ok) {
      console.log('  OK (wrapped)');
      ok++;
    } else {
      console.log('  FAILED');
      console.log('  ' + r2.out.replace(/\n/g, '\n  ').slice(0, 400));
      failed++;
    }
  }
}

console.log(`\n=== 完成：成功 ${ok}，失败 ${failed} ===`);
