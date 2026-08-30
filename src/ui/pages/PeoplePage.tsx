import { useEffect, useMemo, useState } from 'react';
import { calculateColaBalances } from '../../application/usecases/colaService';
import { AthleteRepositoryDexie } from '../../infrastructure/repositories/local/athleteRepositoryDexie';
import { ColaLedgerRepositoryDexie } from '../../infrastructure/repositories/local/colaLedgerRepositoryDexie';
import { RoundRepositoryDexie } from '../../infrastructure/repositories/local/roundRepositoryDexie';
import type { Athlete } from '../../domain/types';

const athleteRepo = new AthleteRepositoryDexie();
const roundRepo = new RoundRepositoryDexie();
const colaRepo = new ColaLedgerRepositoryDexie();

export function PeoplePage() {
  const [list, setList] = useState<Athlete[]>([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editingName, setEditingName] = useState('');
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});
  const [winRateMap, setWinRateMap] = useState<Record<string, string>>({});
  const [colaMap, setColaMap] = useState<Record<string, number>>({});
  const [message, setMessage] = useState('');

  useEffect(() => {
    void refresh();
  }, []);

  const refresh = async () => {
    const [athletes, stats, ledger] = await Promise.all([
      athleteRepo.listAll(),
      roundRepo.listAllRoundStats(),
      colaRepo.listAll(),
    ]);

    setList(athletes);

    const pointRecord: Record<string, number> = {};
    const winTmp: Record<string, { wins: number; rounds: number }> = {};

    stats.forEach((row) => {
      pointRecord[row.athleteId] = (pointRecord[row.athleteId] ?? 0) + row.pointDelta;
      const item = winTmp[row.athleteId] ?? { wins: 0, rounds: 0 };
      item.rounds += 1;
      if (row.pointDelta > 0) item.wins += 1;
      winTmp[row.athleteId] = item;
    });

    const winRateRecord: Record<string, string> = {};
    Object.entries(winTmp).forEach(([athleteId, val]) => {
      const rate = val.rounds === 0 ? 0 : (val.wins / val.rounds) * 100;
      winRateRecord[athleteId] = `${rate.toFixed(1)}%`;
    });

    setPointsMap(pointRecord);
    setWinRateMap(winRateRecord);
    setColaMap(calculateColaBalances(athletes.map((a) => a.id), ledger));
  };

  const sorted = useMemo(
    () => [...list].sort((a, b) => Number(a.isDeleted) - Number(b.isDeleted)),
    [list],
  );

  const createAthlete = async () => {
    setMessage('');
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage('姓名不能为空。');
      return;
    }
    try {
      await athleteRepo.create(trimmed);
      setName('');
      setMessage('已新增。');
      await refresh();
    } catch {
      setMessage('新增失败：姓名可能重复，请换一个名字。');
    }
  };

  const startEdit = (item: Athlete) => {
    setEditingId(item.id);
    setEditingName(item.name);
  };

  const saveEdit = async () => {
    setMessage('');
    const trimmed = editingName.trim();
    if (!editingId || !trimmed) {
      setMessage('姓名不能为空。');
      return;
    }
    try {
      await athleteRepo.updateName(editingId, trimmed);
      setEditingId('');
      setEditingName('');
      setMessage('已更新。');
      await refresh();
    } catch {
      setMessage('更新失败：姓名可能重复，请换一个名字。');
    }
  };

  const softDelete = async (id: string) => {
    setMessage('');
    await athleteRepo.softDelete(id);
    setMessage('已停用（历史保留）。');
    await refresh();
  };

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">球员库</h1>
        <p className="subtitle">新增、改名、停用（停用后不影响历史战绩）。</p>
        <div className="inline-actions">
          <input
            className="text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入球员姓名"
          />
          <button className="button" onClick={createAthlete} type="button">
            新增
          </button>
        </div>
        {message ? <p className="subtitle">{message}</p> : null}
      </section>
      <section className="card">
        <p className="subtitle">当前人数：{list.length}</p>
        <ul className="list-reset">
          {sorted.map((item) => (
            <li key={item.id} className="ledger-item">
              {editingId === item.id ? (
                <div className="stack-sm">
                  <input
                    className="text-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                  <div className="inline-actions">
                    <button className="button button-small" onClick={saveEdit} type="button">
                      保存
                    </button>
                    <button
                      className="button button-small button-ghost"
                      onClick={() => {
                        setEditingId('');
                        setEditingName('');
                      }}
                      type="button"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="row-between">
                    <strong>
                      {item.name} {item.isDeleted ? '（已停用）' : ''}
                    </strong>
                    <div className="inline-actions">
                      <button
                        className="button button-small button-ghost"
                        onClick={() => startEdit(item)}
                        type="button"
                        disabled={item.isDeleted}
                      >
                        改名
                      </button>
                      <button
                        className="button button-small button-ghost"
                        onClick={() => void softDelete(item.id)}
                        type="button"
                        disabled={item.isDeleted}
                      >
                        停用
                      </button>
                    </div>
                  </div>
                  <div className="subtitle">
                    积分：{pointsMap[item.id] ?? 0} ｜ 可乐：{colaMap[item.id] ?? 0} ｜ 胜率：
                    {winRateMap[item.id] ?? '0.0%'}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
