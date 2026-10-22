import { useEffect, useMemo, useState } from 'react';
import {
  buildLedgerEntryFromTransfer,
  buildPendingTransfers,
  calculateColaBalances,
  listMyAthleteIds,
  listPendingForMe,
  listPendingFromMe,
} from '../../application/usecases/colaService';
import type {
  Athlete,
  AthleteClaim,
  ColaLedgerEntry,
  ColaTransfer,
} from '../../domain/types';
import { getCurrentEmail } from '../../infrastructure/auth/authService';
import { DATA_REFRESHED_EVENT } from '../../infrastructure/cloudbase/cloudRefresh';
import { AthleteClaimRepositoryDexie } from '../../infrastructure/repositories/local/athleteClaimRepositoryDexie';
import { AthleteRepositoryDexie } from '../../infrastructure/repositories/local/athleteRepositoryDexie';
import { ColaLedgerRepositoryDexie } from '../../infrastructure/repositories/local/colaLedgerRepositoryDexie';
import { ColaTransferRepositoryDexie } from '../../infrastructure/repositories/local/colaTransferRepositoryDexie';

interface TransferDraft {
  toAthleteId: string;
  amount: number;
}

const athleteRepo = new AthleteRepositoryDexie();
const colaRepo = new ColaLedgerRepositoryDexie();
const claimRepo = new AthleteClaimRepositoryDexie();
const transferRepo = new ColaTransferRepositoryDexie();

function rankTone(rank: number) {
  if (rank === 1) return 'is-first';
  if (rank === 2) return 'is-second';
  if (rank === 3) return 'is-third';
  return '';
}

export function ColaPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [claims, setClaims] = useState<AthleteClaim[]>([]);
  const [transfers, setTransfers] = useState<ColaTransfer[]>([]);
  const [entries, setEntries] = useState<ColaLedgerEntry[]>([]);
  const [transferFromId, setTransferFromId] = useState('');
  const [transferRows, setTransferRows] = useState<TransferDraft[]>([
    { toAthleteId: '', amount: 1 },
  ]);
  const [transferNote, setTransferNote] = useState('');
  const [showColaLedger, setShowColaLedger] = useState(false);
  const [showTransferLog, setShowTransferLog] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    void boot();
    // 云端数据被刷新时（队友在他手机上操作、或定时拉取），重新读取本地数据
    const onRefreshed = () => {
      void boot();
    };
    window.addEventListener(DATA_REFRESHED_EVENT, onRefreshed);
    return () => window.removeEventListener(DATA_REFRESHED_EVENT, onRefreshed);
  }, []);

  const boot = async () => {
    const currentEmail = getCurrentEmail();
    setEmail(currentEmail);

    const [activeAthletes, ledger, transferRows] = await Promise.all([
      athleteRepo.listActive(),
      colaRepo.listAll(),
      transferRepo.listAll(),
    ]);

    const claimRows = await claimRepo.ensureForAthletes(activeAthletes.map((a) => a.id));
    const myIds = listMyAthleteIds(claimRows, currentEmail ?? '');

    setAthletes(activeAthletes);
    setEntries(ledger);
    setClaims(claimRows);
    setTransfers(transferRows);

    setTransferFromId((prev) => (prev && myIds.includes(prev) ? prev : myIds[0] ?? ''));
    setTransferRows((prev) =>
      prev.map((item, index) =>
        index === 0 && !item.toAthleteId
          ? {
              ...item,
              toAthleteId:
                activeAthletes.length > 1
                  ? activeAthletes[1].id
                  : activeAthletes[0]?.id ?? '',
            }
          : item,
      ),
    );
  };

  const athleteMap = useMemo(() => {
    const map = new Map<string, Athlete>();
    athletes.forEach((a) => map.set(a.id, a));
    return map;
  }, [athletes]);

  const nameOf = (id: string | null) => (id ? athleteMap.get(id)?.name ?? id : '系统');

  const myAthleteIds = useMemo(
    () => listMyAthleteIds(claims, email ?? ''),
    [claims, email],
  );

  const myAthletes = useMemo(
    () =>
      myAthleteIds
        .map((id) => athleteMap.get(id))
        .filter((a): a is Athlete => !!a),
    [myAthleteIds, athleteMap],
  );

  const pendingForMe = useMemo(
    () => listPendingForMe(transfers, myAthleteIds, email ?? ''),
    [transfers, myAthleteIds, email],
  );

  const pendingFromMe = useMemo(
    () => listPendingFromMe(transfers, email ?? ''),
    [transfers, email],
  );

  const balances = useMemo(
    () => calculateColaBalances(athletes.map((a) => a.id), entries),
    [athletes, entries],
  );

  const balanceRanking = useMemo(
    () =>
      [...athletes].sort(
        (a, b) => (balances[b.id] ?? 0) - (balances[a.id] ?? 0),
      ),
    [athletes, balances],
  );

  const addTransferRow = () => {
    setTransferRows((prev) => [...prev, { toAthleteId: '', amount: 1 }]);
  };

  const removeTransferRow = (index: number) => {
    setTransferRows((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTransferRow = (index: number, patch: Partial<TransferDraft>) => {
    setTransferRows((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  /** 发起转让：只生成待确认申请，不动任何人的余额。 */
  const submitTransfer = async () => {
    setError('');
    setSuccess('');

    if (!email) {
      setError('请先登录后再发起转让。');
      return;
    }
    if (myAthleteIds.length === 0) {
      setError('当前账号还没有认领球员，请先到「球员」页认领自己。');
      return;
    }
    if (!transferFromId) {
      setError('请选择转出人。');
      return;
    }

    const targets = transferRows
      .map((row) => ({
        toAthleteId: row.toAthleteId,
        amount: Math.max(0, Math.floor(row.amount || 0)),
      }))
      .filter(
        (row) =>
          row.toAthleteId && row.amount > 0 && row.toAthleteId !== transferFromId,
      );

    if (targets.length === 0) {
      setError('请至少填写一条有效转让（金额>0，且不能转给自己）。');
      return;
    }

    const pending = buildPendingTransfers(
      transferFromId,
      targets,
      transferNote.trim() || undefined,
      email,
    );
    await transferRepo.createMany(pending);
    setTransfers(await transferRepo.listAll());
    setTransferNote('');
    setSuccess(`已发起 ${pending.length} 笔转让申请，等对方确认后才会计入可乐余额。`);
  };

  /** 同意：先写正式账本（幂等 id），再把申请标记为已同意。 */
  const approveTransfer = async (row: ColaTransfer) => {
    setError('');
    setSuccess('');
    if (!email) return;

    if (!myAthleteIds.includes(row.toAthleteId)) {
      setError('这笔转让不是转给你的，无法确认。');
      return;
    }
    if (row.createdByEmail.trim().toLowerCase() === email.trim().toLowerCase()) {
      setError('不能确认自己发起的申请。');
      return;
    }

    const decidedAt = Date.now();
    const decided: ColaTransfer = {
      ...row,
      status: 'approved',
      decidedByEmail: email,
      decidedAt,
    };

    await colaRepo.append([buildLedgerEntryFromTransfer(decided)]);
    await transferRepo.patch(row.id, {
      status: 'approved',
      decidedByEmail: email,
      decidedAt,
    });

    setEntries(await colaRepo.listAll());
    setTransfers(await transferRepo.listAll());
    setSuccess(
      `已同意：${nameOf(row.fromAthleteId)} → ${nameOf(row.toAthleteId)} ${row.amount} 瓶。`,
    );
  };

  const rejectTransfer = async (row: ColaTransfer) => {
    setError('');
    setSuccess('');
    if (!email) return;
    if (!myAthleteIds.includes(row.toAthleteId)) {
      setError('这笔转让不是转给你的，无法处理。');
      return;
    }

    await transferRepo.patch(row.id, {
      status: 'rejected',
      decidedByEmail: email,
      decidedAt: Date.now(),
    });
    setTransfers(await transferRepo.listAll());
    setSuccess('已拒绝该笔转让申请。');
  };

  const cancelTransfer = async (row: ColaTransfer) => {
    setError('');
    setSuccess('');
    if (!email) return;

    await transferRepo.patch(row.id, {
      status: 'canceled',
      decidedByEmail: email,
      decidedAt: Date.now(),
    });
    setTransfers(await transferRepo.listAll());
    setSuccess('已撤销该笔申请。');
  };

  const describeEntry = (entry: ColaLedgerEntry) => {
    const fromName = nameOf(entry.fromAthleteId);
    const toName = nameOf(entry.toAthleteId);

    if (entry.type === 'transfer') {
      return `${fromName} -> ${toName}：${entry.amount} 瓶`;
    }
    if (entry.type === 'consume') {
      return `${fromName} 消耗 ${entry.amount} 瓶`;
    }
    if (entry.type === 'round_reward') {
      return `${fromName} -> ${toName}：${entry.amount} 瓶（比赛）`;
    }
    return `${fromName} -> ${toName}：${entry.amount} 瓶（调整）`;
  };

  const recentDecided = useMemo(
    () => transfers.filter((row) => row.status !== 'pending').slice(0, 10),
    [transfers],
  );

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">可乐市场</h1>
        <p className="subtitle">转让需对方确认：A 发起 → B 同意后才会入账。</p>
        {!email ? (
          <p className="error-text">
            当前未登录：可以查看数据，但无法发起或确认转让。请到「比赛」页登录。
          </p>
        ) : (
          <p className="subtitle">
            当前账号：{email}｜我认领的球员：
            {myAthletes.length > 0
              ? myAthletes.map((a) => a.name).join('、')
              : '（还没认领，请到「球员」页认领）'}
          </p>
        )}
      </section>

      {pendingForMe.length > 0 ? (
        <section className="card">
          <p className="subtitle">待我确认（{pendingForMe.length} 笔）</p>
          <ul className="list-reset">
            {pendingForMe.map((row) => (
              <li key={row.id} className="ledger-item">
                <div className="row-between">
                  <strong>
                    {nameOf(row.fromAthleteId)} → {nameOf(row.toAthleteId)}：{row.amount} 瓶
                  </strong>
                  <div className="inline-actions">
                    <button
                      className="button button-small"
                      type="button"
                      onClick={() => void approveTransfer(row)}
                    >
                      同意
                    </button>
                    <button
                      className="button button-small button-ghost"
                      type="button"
                      onClick={() => void rejectTransfer(row)}
                    >
                      拒绝
                    </button>
                  </div>
                </div>
                <div className="subtitle">
                  {row.note ? `备注：${row.note}｜` : ''}发起人：{row.createdByEmail}｜
                  {new Date(row.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="card">
        <p className="subtitle">可乐榜（按余额）</p>
        <div className="ranking-table">
          <div className="ranking-row ranking-head ranking-grid-cola">
            <span>名次</span>
            <span>球员</span>
            <span className="result-num">可乐</span>
          </div>
          {balanceRanking.length === 0 ? <p className="subtitle">暂无数据</p> : null}
          {balanceRanking.map((athlete, index) => (
            <div key={athlete.id} className="ranking-row ranking-grid-cola">
              <span className={`rank-pill ${rankTone(index + 1)}`}>#{index + 1}</span>
              <span className="ranking-name">{athlete.name}</span>
              <strong className="result-num ranking-value">
                {balances[athlete.id] ?? 0} 瓶
              </strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="subtitle">发起转让（需对方同意）</p>
        <div className="stack-sm">
          <label className="field-label">转出人（只能选自己认领的球员）</label>
          <select
            className="select-input"
            value={transferFromId}
            onChange={(e) => setTransferFromId(e.target.value)}
            disabled={myAthletes.length === 0}
          >
            <option value="">
              {myAthletes.length === 0 ? '请先到「球员」页认领自己' : '请选择'}
            </option>
            {myAthletes.map((athlete) => (
              <option key={athlete.id} value={athlete.id}>
                {athlete.name}
              </option>
            ))}
          </select>

          {transferRows.map((row, index) => (
            <div key={`${index}-${row.toAthleteId}`} className="row-grid-3">
              <select
                className="select-input"
                value={row.toAthleteId}
                onChange={(e) => updateTransferRow(index, { toAthleteId: e.target.value })}
              >
                <option value="">转给谁</option>
                {athletes
                  .filter((a) => a.id !== transferFromId)
                  .map((athlete) => (
                    <option key={athlete.id} value={athlete.id}>
                      {athlete.name}
                    </option>
                  ))}
              </select>
              <input
                className="number-input"
                type="number"
                min={1}
                value={row.amount}
                onChange={(e) =>
                  updateTransferRow(index, { amount: Number(e.target.value) || 0 })
                }
              />
              <button
                className="button button-ghost button-small"
                type="button"
                onClick={() => removeTransferRow(index)}
                disabled={transferRows.length === 1}
              >
                删除
              </button>
            </div>
          ))}

          <button className="button button-ghost" type="button" onClick={addTransferRow}>
            + 增加一位转入人
          </button>

          <label className="field-label">备注（可选）</label>
          <input
            className="text-input"
            value={transferNote}
            onChange={(e) => setTransferNote(e.target.value)}
            placeholder="例如：请喝可乐"
          />

          <button
            className="button"
            type="button"
            onClick={submitTransfer}
            disabled={!email || myAthletes.length === 0}
          >
            发起转让
          </button>
        </div>
      </section>

      {pendingFromMe.length > 0 || recentDecided.length > 0 ? (
        <section className="card">
          <div className="inline-actions">
            <p className="subtitle">转让记录（待确认 {pendingFromMe.length} 笔）</p>
            <button
              className="button button-small button-ghost"
              type="button"
              onClick={() => setShowTransferLog((prev) => !prev)}
            >
              {showTransferLog
                ? '收起转让记录'
                : `展开转让记录（${pendingFromMe.length + recentDecided.length} 条）`}
            </button>
          </div>
          {!showTransferLog ? (
            <p className="subtitle">已折叠，点击“展开转让记录”查看。</p>
          ) : (
          <ul className="list-reset">
            {[...pendingFromMe, ...recentDecided].map((row) => (
              <li key={row.id} className="ledger-item">
                <div className="row-between">
                  <strong>
                    {nameOf(row.fromAthleteId)} → {nameOf(row.toAthleteId)}：{row.amount} 瓶
                    <span className={`status-pill status-${row.status}`}>
                      {row.status === 'pending'
                        ? '待确认'
                        : row.status === 'approved'
                          ? '已同意'
                          : row.status === 'rejected'
                            ? '已拒绝'
                            : '已撤销'}
                    </span>
                  </strong>
                  {row.status === 'pending' &&
                  email &&
                  row.createdByEmail.trim().toLowerCase() === email.trim().toLowerCase() ? (
                    <button
                      className="button button-small button-ghost"
                      type="button"
                      onClick={() => void cancelTransfer(row)}
                    >
                      撤销
                    </button>
                  ) : null}
                </div>
                <div className="subtitle">
                  {row.note ? `备注：${row.note}｜` : ''}发起人：{row.createdByEmail}｜
                  {new Date(row.createdAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
          )}
        </section>
      ) : null}

      <section className="card">
        <div className="inline-actions">
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={() => setShowColaLedger((prev) => !prev)}
          >
            {showColaLedger ? '收起可乐流水' : `展开可乐流水（${entries.length} 条）`}
          </button>
        </div>
      </section>

      <section className="card">
        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="ok-text">{success}</p> : null}
        <p className="subtitle">可乐流水（最新在前）</p>
        {!showColaLedger ? (
          <p className="subtitle">已折叠，点击上方“展开可乐流水”查看。</p>
        ) : entries.length === 0 ? (
          <p className="subtitle">暂无流水。</p>
        ) : (
          <ul className="list-reset">
            {entries.map((entry) => (
              <li key={entry.id} className="ledger-item">
                <div>{describeEntry(entry)}</div>
                <div className="subtitle">{new Date(entry.createdAt).toLocaleString()}</div>
                {entry.note ? <div className="subtitle">备注：{entry.note}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
