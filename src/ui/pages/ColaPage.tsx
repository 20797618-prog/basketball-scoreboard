import { useEffect, useMemo, useState } from 'react';
import {
  buildConsumeEntry,
  buildTransferEntries,
  calculateColaBalances,
} from '../../application/usecases/colaService';
import type { Athlete, ColaLedgerEntry } from '../../domain/types';
import { AthleteRepositoryDexie } from '../../infrastructure/repositories/local/athleteRepositoryDexie';
import { ColaLedgerRepositoryDexie } from '../../infrastructure/repositories/local/colaLedgerRepositoryDexie';

interface TransferDraft {
  toAthleteId: string;
  amount: number;
}

const athleteRepo = new AthleteRepositoryDexie();
const colaRepo = new ColaLedgerRepositoryDexie();

function rankTone(rank: number) {
  if (rank === 1) return 'is-first';
  if (rank === 2) return 'is-second';
  if (rank === 3) return 'is-third';
  return '';
}

export function ColaPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [entries, setEntries] = useState<ColaLedgerEntry[]>([]);
  const [transferFromId, setTransferFromId] = useState('');
  const [transferRows, setTransferRows] = useState<TransferDraft[]>([
    { toAthleteId: '', amount: 1 },
  ]);
  const [transferNote, setTransferNote] = useState('');
  const [consumeTargetId, setConsumeTargetId] = useState('');
  const [consumeAmount, setConsumeAmount] = useState(1);
  const [consumeNote, setConsumeNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    void boot();
  }, []);

  const boot = async () => {
    const [activeAthletes, ledger] = await Promise.all([
      athleteRepo.listActive(),
      colaRepo.listAll(),
    ]);

    setAthletes(activeAthletes);
    setEntries(ledger);

    if (activeAthletes.length > 0) {
      const firstId = activeAthletes[0].id;
      setTransferFromId((prev) => prev || firstId);
      setConsumeTargetId((prev) => prev || firstId);
      setTransferRows((prev) =>
        prev.map((item, index) =>
          index === 0 && !item.toAthleteId
            ? {
                ...item,
                toAthleteId: activeAthletes.length > 1 ? activeAthletes[1].id : firstId,
              }
            : item,
        ),
      );
    }
  };

  const athleteMap = useMemo(() => {
    const map = new Map<string, Athlete>();
    athletes.forEach((a) => map.set(a.id, a));
    return map;
  }, [athletes]);

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

  const submitTransfer = async () => {
    setError('');
    setSuccess('');

    const targets = transferRows
      .map((row) => ({
        toAthleteId: row.toAthleteId,
        amount: Math.max(0, Math.floor(row.amount || 0)),
      }))
      .filter((row) => row.toAthleteId && row.amount > 0 && row.toAthleteId !== transferFromId);

    if (!transferFromId) {
      setError('请选择转出人。');
      return;
    }
    if (targets.length === 0) {
      setError('请至少填写一条有效转账（金额>0，且不能转给自己）。');
      return;
    }

    const newEntries = buildTransferEntries(transferFromId, targets, transferNote.trim() || undefined);
    await colaRepo.append(newEntries);
    setEntries(await colaRepo.listAll());
    setSuccess('批量转账已完成。');
  };

  const submitConsume = async () => {
    setError('');
    setSuccess('');

    const safeAmount = Math.max(0, Math.floor(consumeAmount || 0));
    if (!consumeTargetId) {
      setError('请选择消耗对象。');
      return;
    }
    if (safeAmount <= 0) {
      setError('消耗数量必须大于 0。');
      return;
    }

    const entry = buildConsumeEntry(consumeTargetId, safeAmount, consumeNote.trim() || undefined);
    await colaRepo.append([entry]);
    setEntries(await colaRepo.listAll());
    setSuccess('可乐消耗已记录。');
  };

  const describeEntry = (entry: ColaLedgerEntry) => {
    const fromName = entry.fromAthleteId
      ? (athleteMap.get(entry.fromAthleteId)?.name ?? entry.fromAthleteId)
      : '系统';
    const toName = entry.toAthleteId
      ? (athleteMap.get(entry.toAthleteId)?.name ?? entry.toAthleteId)
      : '系统';

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

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">可乐市场</h1>
        <p className="subtitle">支持批量转账、清零/消耗、流水查询（余额可为负）。</p>
      </section>

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
              <strong className="result-num ranking-value">{balances[athlete.id] ?? 0} 瓶</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <p className="subtitle">批量转账</p>
        <div className="stack-sm">
          <label className="field-label">转出人</label>
          <select
            className="select-input"
            value={transferFromId}
            onChange={(e) => setTransferFromId(e.target.value)}
          >
            <option value="">请选择</option>
            {athletes.map((athlete) => (
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

          <button className="button" type="button" onClick={submitTransfer}>
            确认转账
          </button>
        </div>
      </section>

      <section className="card">
        <p className="subtitle">清零/消耗</p>
        <div className="stack-sm">
          <label className="field-label">对象</label>
          <select
            className="select-input"
            value={consumeTargetId}
            onChange={(e) => setConsumeTargetId(e.target.value)}
          >
            <option value="">请选择</option>
            {athletes.map((athlete) => (
              <option key={athlete.id} value={athlete.id}>
                {athlete.name}
              </option>
            ))}
          </select>

          <label className="field-label">消耗数量</label>
          <input
            className="number-input"
            type="number"
            min={1}
            value={consumeAmount}
            onChange={(e) => setConsumeAmount(Number(e.target.value) || 0)}
          />

          <label className="field-label">备注（可选）</label>
          <input
            className="text-input"
            value={consumeNote}
            onChange={(e) => setConsumeNote(e.target.value)}
            placeholder="例如：买水喝啦"
          />

          <button className="button" type="button" onClick={submitConsume}>
            确认消耗
          </button>
        </div>
      </section>

      <section className="card">
        {error ? <p className="error-text">{error}</p> : null}
        {success ? <p className="ok-text">{success}</p> : null}
        <p className="subtitle">可乐流水（最新在前）</p>
        {entries.length === 0 ? (
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
