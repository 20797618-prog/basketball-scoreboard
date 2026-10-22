import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  allFilterValue,
  buildPointRanking,
  buildPointRankingFromRoundLedger,
  buildRoundDetails,
  buildWinRateRanking,
  buildWinRateRankingFromRoundLedger,
  buildHitRateRanking,
  buildDailyHitRate,
  filterLedger,
  filterRoundStats,
  type StatsFilters,
  type DailyHitRateRow,
} from '../../application/usecases/statsService';
import type { Athlete, ColaLedgerEntry, Match, Round, RoundStat } from '../../domain/types';
import { AthleteRepositoryDexie } from '../../infrastructure/repositories/local/athleteRepositoryDexie';
import { ColaLedgerRepositoryDexie } from '../../infrastructure/repositories/local/colaLedgerRepositoryDexie';
import { appDb } from '../../infrastructure/db/appDb';
import { MatchRepositoryDexie } from '../../infrastructure/repositories/local/matchRepositoryDexie';
import { RoundRepositoryDexie } from '../../infrastructure/repositories/local/roundRepositoryDexie';
import { calculateColaBalances } from '../../application/usecases/colaService';

const athleteRepo = new AthleteRepositoryDexie();
const matchRepo = new MatchRepositoryDexie();
const roundRepo = new RoundRepositoryDexie();
const colaRepo = new ColaLedgerRepositoryDexie();

type RankingTab = 'points' | 'cola' | 'winRate' | 'hitRate';

function rankTone(rank: number) {
  if (rank === 1) return 'is-first';
  if (rank === 2) return 'is-second';
  if (rank === 3) return 'is-third';
  return '';
}

interface DebugCounts {
  athletes: number;
  matches: number;
  rounds: number;
  roundStats: number;
  ledger: number;
}

/** 每日命中率「按人显示」时的一条序列（values 与日期轴一一对应，null = 当天没投篮）。 */
interface TrendSeries {
  athleteId: string;
  name: string;
  color: string;
  values: (number | null)[];
}

type ScopeFilter = 'global' | 'month';

export function StatsPage() {
  const [tab, setTab] = useState<RankingTab>('points');
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [roundStats, setRoundStats] = useState<RoundStat[]>([]);
  const [ledger, setLedger] = useState<ColaLedgerEntry[]>([]);
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('global');
  const [monthValue, setMonthValue] = useState('');
  const [athleteFilterId, setAthleteFilterId] = useState(allFilterValue());
  const [showPointLedger, setShowPointLedger] = useState(false);
  // 每日命中率：关=合计一条线；开=每个球员一条线
  const [showPerAthleteTrend, setShowPerAthleteTrend] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState('');
  const [refreshTapCount, setRefreshTapCount] = useState(0);
  const [debugCounts, setDebugCounts] = useState<DebugCounts>({
    athletes: 0,
    matches: 0,
    rounds: 0,
    roundStats: 0,
    ledger: 0,
  });

  const boot = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshMessage('');
    try {
      const [aRes, mRes, rRes, rsRes, lRes] = await Promise.allSettled([
        athleteRepo.listAll(),
        matchRepo.listAll(),
        roundRepo.listAllRounds(),
        roundRepo.listAllRoundStats(),
        colaRepo.listAll(),
      ]);

      const a = aRes.status === 'fulfilled' ? aRes.value : [];
      const m = mRes.status === 'fulfilled' ? mRes.value : [];
      const r = rRes.status === 'fulfilled' ? rRes.value : [];
      const rs = rsRes.status === 'fulfilled' ? rsRes.value : [];
      const l = lRes.status === 'fulfilled' ? lRes.value : [];

      setAthletes(a);
      setMatches(m);
      setRounds(r);
      setRoundStats(rs);
      setLedger(l);

      const [athletesCount, matchesCount, roundsCount, roundStatsCount, ledgerCount] = await Promise.all([
        appDb.athletes.count().catch(() => a.length),
        appDb.matches.count().catch(() => m.length),
        appDb.rounds.count().catch(() => r.length),
        appDb.roundStats.count().catch(() => rs.length),
        appDb.colaLedger.count().catch(() => l.length),
      ]);

      setDebugCounts({
        athletes: athletesCount,
        matches: matchesCount,
        rounds: roundsCount,
        roundStats: roundStatsCount,
        ledger: ledgerCount,
      });

      const rejected = [aRes, mRes, rRes, rsRes, lRes].filter((x) => x.status === 'rejected');
      if (rejected.length > 0) {
        const reason = rejected[0];
        const detail = reason.status === 'rejected' ? String(reason.reason) : '';
        setRefreshMessage(`部分数据刷新失败：${detail}`);
      } else {
        setRefreshMessage(`已刷新：${new Date().toLocaleTimeString()}`);
      }
    } catch (error) {
      setRefreshMessage(`刷新失败：${String(error)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  useEffect(() => {
    const onFocus = () => {
      void boot();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void boot();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [boot]);

  const athleteNameMap = useMemo(() => {
    const map = new Map<string, string>();
    athletes.forEach((a) => map.set(a.id, a.name));
    return map;
  }, [athletes]);

  const filters = useMemo<StatsFilters>(
    () => ({
      matchId: allFilterValue(),
      athleteId: athleteFilterId,
      day: scopeFilter === 'month' ? monthValue : '',
    }),
    [scopeFilter, monthValue, athleteFilterId],
  );

  const filteredStats = useMemo(
    () => filterRoundStats(roundStats, filters),
    [roundStats, filters],
  );

  const filteredLedger = useMemo(
    () => filterLedger(ledger, filters),
    [ledger, filters],
  );

  const pointRanking = useMemo(
    () =>
      filteredStats.length > 0
        ? buildPointRanking(filteredStats)
        : buildPointRankingFromRoundLedger(filteredLedger),
    [filteredStats, filteredLedger],
  );
  // 榜单只统计「在用」球员：已删除/停用的不出现在任何排行榜里。
  // （名字映射仍用全量 athletes，避免历史记录里出现裸 id）
  const activeAthletes = useMemo(
    () => athletes.filter((a) => !a.isDeleted),
    [athletes],
  );

  const pointRankingWithAllAthletes = useMemo(() => {
    const pointMap = new Map(pointRanking.map((row) => [row.athleteId, row.value]));
    return [...activeAthletes]
      .map((athlete) => ({
        athleteId: athlete.id,
        value: pointMap.get(athlete.id) ?? 0,
      }))
      .sort((a, b) => b.value - a.value);
  }, [activeAthletes, pointRanking]);
  const colaBalances = useMemo(
    () => calculateColaBalances(activeAthletes.map((a) => a.id), ledger),
    [athletes, ledger],
  );

  const colaRanking = useMemo(
    () =>
      [...activeAthletes].sort(
        (a, b) => (colaBalances[b.id] ?? 0) - (colaBalances[a.id] ?? 0),
      ),
    [athletes, colaBalances],
  );
  const winRateRanking = useMemo(
    () => {
      // roundId → 轮次键（matchId-roundNo）：同一场比赛的同一轮号视为同一轮
      // （同一轮多次加时合并为 1 轮计胜率）。
      const roundKeyByRoundId = new Map<string, string>();
      for (const r of rounds) {
        roundKeyByRoundId.set(r.id, `${r.matchId}-${r.roundNo}`);
      }
      return filteredStats.length > 0
        ? buildWinRateRanking(filteredStats, roundKeyByRoundId)
        : buildWinRateRankingFromRoundLedger(filteredLedger, roundKeyByRoundId);
    },
    [filteredStats, filteredLedger, rounds],
  );
  const winRateRankingWithAllAthletes = useMemo(() => {
    const winMap = new Map(
      winRateRanking.map((row) => [row.athleteId, { value: row.value, wins: row.wins ?? 0, rounds: row.rounds ?? 0 }]),
    );
    return [...activeAthletes]
      .map((athlete) => {
        const item = winMap.get(athlete.id);
        return {
          athleteId: athlete.id,
          value: item?.value ?? 0,
          wins: item?.wins ?? 0,
          rounds: item?.rounds ?? 0,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [activeAthletes, winRateRanking]);

  const details = useMemo(
    () => buildRoundDetails({ stats: filteredStats, rounds, matches }),
    [filteredStats, rounds, matches],
  );

  /**
   * 积分调整记录：来自 cola_ledger 的 adjust_reversal 条目
   * （例如「系统问题补回」这类人为修正）。
   * 这类修正同时改了 round_stats 的 point_delta 和账本，
   * 但 round_stats 没有备注字段，所以在积分流水里单列出来展示备注。
   */
  const pointAdjustments = useMemo(
    () =>
      ledger
        .filter((row) => row.type === 'adjust_reversal')
        .map((row) => {
          const toId = row.toAthleteId;
          const fromId = row.fromAthleteId;
          return {
            key: `adjust-${row.id}`,
            athleteId: toId ?? fromId ?? '',
            note: row.note ?? '调整',
            // 入账为正、出账为负（与补记方向一致）
            delta: toId ? row.amount : -row.amount,
            createdAt: row.createdAt,
          };
        })
        .sort((a, b) => b.createdAt - a.createdAt),
    [ledger],
  );

  const hitRateRanking = useMemo(
    () => buildHitRateRanking(filteredStats),
    [filteredStats],
  );

  const hitRateRankingWithAllAthletes = useMemo(() => {
    const map = new Map(
      hitRateRanking.map((row) => [
        row.athleteId,
        { hits: row.hits, attempts: row.attempts, rate: row.rate },
      ]),
    );
    return [...activeAthletes]
      .map((athlete) => {
        const item = map.get(athlete.id);
        return {
          athleteId: athlete.id,
          hits: item?.hits ?? 0,
          attempts: item?.attempts ?? 0,
          rate: item?.rate ?? 0,
        };
      })
      .sort((a, b) => b.rate - a.rate);
  }, [activeAthletes, hitRateRanking]);

  const dailyHitRate = useMemo(
    () => buildDailyHitRate(filteredStats),
    [filteredStats],
  );

  /**
   * 按人拆分的每日命中率序列。
   * 日期轴沿用 dailyHitRate 的顺序（旧→新）；某球员某天没投篮则留 null，
   * 画线时在此断开——不能补 0，否则会看出"今天掉到 0%"的假象。
   */
  const perAthleteSeries = useMemo<TrendSeries[]>(() => {
    const days = dailyHitRate.map((row) => row.day);
    if (days.length === 0) return [];

    const daySet = new Set(days);
    const pad2 = (n: number) => String(n).padStart(2, '0');
    const activeIds = new Set(activeAthletes.map((a) => a.id));

    const acc = new Map<string, Map<string, { hits: number; attempts: number }>>();

    filteredStats.forEach((row) => {
      if (!activeIds.has(row.athleteId)) return;
      const d = new Date(row.createdAt);
      const day = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      if (!daySet.has(day)) return;

      let perDay = acc.get(row.athleteId);
      if (!perDay) {
        perDay = new Map();
        acc.set(row.athleteId, perDay);
      }
      const cur = perDay.get(day) ?? { hits: 0, attempts: 0 };
      cur.hits += row.hits;
      cur.attempts += row.attempts;
      perDay.set(day, cur);
    });

    const palette = [
      '#00e6a8',
      '#4d9bff',
      '#ff8a3d',
      '#c77dff',
      '#ffd23f',
      '#ff5d73',
      '#3ddad7',
      '#9aa7b4',
    ];

    return [...acc.entries()]
      .map(([athleteId, perDay], index) => ({
        athleteId,
        name: athleteNameMap.get(athleteId) ?? athleteId,
        color: palette[index % palette.length],
        values: days.map((day) => {
          const v = perDay.get(day);
          return v && v.attempts > 0 ? v.hits / v.attempts : null;
        }),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [dailyHitRate, filteredStats, activeAthletes, athleteNameMap]);

  /**
   * 今日战报：只统计「今天」且「已结束」的比赛，一局一张表。
   * 表结构沿用「结束本局结算」：姓名 / 轮 / 积分 / 可乐，
   * 轮按 roundNo 去重（同一轮的常规赛+加时算 1 轮）。
   */
  const todayMatchTables = useMemo(() => {
    const now = new Date();
    const isToday = (ts: number) => {
      const d = new Date(ts);
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    };

    const pad2 = (n: number) => String(n).padStart(2, '0');
    const athleteMap = new Map(athletes.map((a) => [a.id, a.name]));

    const todays = matches
      .filter((m) => m.status === 'finished' && isToday(m.createdAt))
      .sort((a, b) => a.createdAt - b.createdAt);

    return todays.map((match, index) => {
      const matchRounds = rounds.filter((r) => r.matchId === match.id);
      const roundNoByRoundId = new Map(matchRounds.map((r) => [r.id, r.roundNo]));

      const byAthlete = new Map<
        string,
        { roundNos: Set<number>; points: number; cola: number }
      >();

      roundStats
        .filter((row) => row.matchId === match.id)
        .forEach((row) => {
          const roundNo = roundNoByRoundId.get(row.roundId);
          const prev = byAthlete.get(row.athleteId) ?? {
            roundNos: new Set<number>(),
            points: 0,
            cola: 0,
          };
          if (typeof roundNo === 'number') prev.roundNos.add(roundNo);
          prev.points += row.pointDelta;
          prev.cola += row.colaDelta;
          byAthlete.set(row.athleteId, prev);
        });

      const rows = [...byAthlete.entries()]
        .map(([athleteId, score]) => ({
          athleteId,
          name: athleteMap.get(athleteId) ?? athleteId,
          rounds: score.roundNos.size,
          points: score.points,
          cola: score.cola,
        }))
        .sort((a, b) => b.points - a.points);

      const created = new Date(match.createdAt);

      return {
        matchId: match.id,
        label: `第 ${index + 1} 局`,
        time: `${pad2(created.getHours())}:${pad2(created.getMinutes())}`,
        rows,
      };
    });
  }, [matches, rounds, roundStats, athletes]);

  const handleManualRefresh = () => {
    setRefreshTapCount((prev) => prev + 1);
    setRefreshMessage('手动刷新中...');
    void boot();
  };

  return (
    <main className="page">
      <section className="card">
        <p className="title">今日战报</p>
        <p className="subtitle">只显示今天已结束的局，一局一张表；轮按「同一轮含加时算 1 轮」统计。</p>
        {todayMatchTables.length === 0 ? (
          <p className="subtitle">今天还没有结束的比赛。</p>
        ) : (
          <div className="today-matches">
            {todayMatchTables.map((table) => (
              <div key={table.matchId} className="today-match-block">
                <p className="today-match-title">
                  {table.label}
                  <span className="today-match-time">{table.time}</span>
                </p>
                <div className="result-table">
                  <div className="result-row result-head result-row-4">
                    <span>姓名</span>
                    <span>轮</span>
                    <span>积分</span>
                    <span>可乐</span>
                  </div>
                  {table.rows.map((row) => (
                    <div key={row.athleteId} className="result-row result-row-4">
                      <span>{row.name}</span>
                      <span className="result-num">{row.rounds}</span>
                      <span className="result-num">
                        {row.points > 0 ? `+${row.points}` : row.points}
                      </span>
                      <span className="result-num">
                        {row.cola > 0 ? `+${row.cola}` : row.cola}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <h1 className="title">排行</h1>
        <p className="subtitle">三榜单 + 按全局/按月/按人筛选 + 详细轮次记录。</p>
        <div className="inline-actions">
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={handleManualRefresh}
          >
            {isRefreshing ? '刷新中...' : '刷新数据'}
          </button>
          <span className="subtitle">轮次记录：{roundStats.length} 条</span>
          <span className="subtitle">筛选后：{filteredStats.length} 条</span>
          <span className="subtitle">可乐流水：{ledger.length} 条</span>
        </div>
        <div className="inline-actions">
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={() => window.location.reload()}
          >
            强制重载页面
          </button>
        </div>
        {refreshMessage ? <p className="subtitle">{refreshMessage}</p> : null}
        <p className="subtitle">
          刷新点击：{refreshTapCount} 次｜DB计数：人 {debugCounts.athletes} / 局 {debugCounts.matches} / 轮{' '}
          {debugCounts.rounds} / 轮明细 {debugCounts.roundStats} / 流水 {debugCounts.ledger}
        </p>
        {filteredStats.length === 0 && (scopeFilter === 'month' || filters.athleteId !== allFilterValue()) ? (
          <p className="subtitle">当前已启用筛选条件，可点“重置筛选”查看全部数据。</p>
        ) : null}
        {roundStats.length === 0 && ledger.some((x) => x.type === 'round_reward') ? (
          <p className="subtitle">检测到历史轮次明细缺失，积分榜/胜率榜已按比赛可乐流水兼容计算。</p>
        ) : null}
      </section>

      <section className="card">
        <p className="subtitle">筛选</p>
        <div className="stack-sm">
          <label className="field-label">范围</label>
          <select
            className="select-input"
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
          >
            <option value="global">全局</option>
            <option value="month">按月</option>
          </select>

          {scopeFilter === 'month' ? (
            <>
              <label className="field-label">月份</label>
              <select
                className="select-input"
                value={monthValue}
                onChange={(e) => setMonthValue(e.target.value)}
              >
                <option value="">请选择月份</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={String(month)}>
                    {month}月
                  </option>
                ))}
              </select>
            </>
          ) : null}

          <label className="field-label">人员</label>
          <select
            className="select-input"
            value={athleteFilterId}
            onChange={(e) => setAthleteFilterId(e.target.value)}
          >
            <option value={allFilterValue()}>全部人</option>
            {activeAthletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>

          <button
            className="button button-ghost"
            type="button"
            onClick={() => {
              setScopeFilter('global');
              setMonthValue('');
              setAthleteFilterId(allFilterValue());
            }}
          >
            重置筛选
          </button>
        </div>
      </section>

      <section className="card">
        <div className="tabs-row">
          <button
            className={tab === 'points' ? 'button button-small' : 'button button-small button-ghost'}
            type="button"
            onClick={() => setTab('points')}
          >
            积分榜
          </button>
          <button
            className={tab === 'cola' ? 'button button-small' : 'button button-small button-ghost'}
            type="button"
            onClick={() => setTab('cola')}
          >
            可乐榜
          </button>
          <button
            className={tab === 'winRate' ? 'button button-small' : 'button button-small button-ghost'}
            type="button"
            onClick={() => setTab('winRate')}
          >
            胜率榜
          </button>
          <button
            className={tab === 'hitRate' ? 'button button-small' : 'button button-small button-ghost'}
            type="button"
            onClick={() => setTab('hitRate')}
          >
            命中榜
          </button>
        </div>

        {tab === 'points' ? (
          <div className="ranking-table">
            <div className="ranking-row ranking-head ranking-grid-points">
              <span>名次</span>
              <span>球员</span>
              <span className="result-num">积分</span>
            </div>
            {pointRankingWithAllAthletes.length === 0 ? <p className="subtitle">暂无数据</p> : null}
            {pointRankingWithAllAthletes.map((row, index) => (
              <div key={row.athleteId} className="ranking-row ranking-grid-points">
                <span className={`rank-pill ${rankTone(index + 1)}`}>#{index + 1}</span>
                <span className="ranking-name">{athleteNameMap.get(row.athleteId) ?? row.athleteId}</span>
                <strong className="result-num ranking-value">{row.value}</strong>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'cola' ? (
          <div className="ranking-table">
            <div className="ranking-row ranking-head ranking-grid-cola">
              <span>名次</span>
              <span>球员</span>
              <span className="result-num">可乐</span>
            </div>
            {colaRanking.length === 0 ? <p className="subtitle">暂无数据</p> : null}
            {colaRanking.map((row, index) => (
              <div key={row.id} className="ranking-row ranking-grid-cola">
                <span className={`rank-pill ${rankTone(index + 1)}`}>#{index + 1}</span>
                <span className="ranking-name">{row.name}</span>
                <strong className="result-num ranking-value">{colaBalances[row.id] ?? 0} 瓶</strong>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'winRate' ? (
          <div className="ranking-table">
            <div className="ranking-row ranking-head ranking-grid-rate">
              <span>名次</span>
              <span>球员</span>
              <span className="result-num">胜率</span>
              <span className="result-num">胜/轮</span>
            </div>
            {winRateRankingWithAllAthletes.length === 0 ? <p className="subtitle">暂无数据</p> : null}
            {winRateRankingWithAllAthletes.map((row, index) => (
              <div key={row.athleteId} className="ranking-row ranking-grid-rate">
                <span className={`rank-pill ${rankTone(index + 1)}`}>#{index + 1}</span>
                <span className="ranking-name">{athleteNameMap.get(row.athleteId) ?? row.athleteId}</span>
                <strong className="result-num ranking-value">{(row.value * 100).toFixed(1)}%</strong>
                <span className="result-num ranking-meta">
                  {row.wins}/{row.rounds}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'hitRate' ? (
          <div className="ranking-table">
            <div className="ranking-row ranking-head ranking-grid-rate">
              <span>名次</span>
              <span>球员</span>
              <span className="result-num">命中率</span>
              <span className="result-num">命中/投篮</span>
            </div>
            {hitRateRankingWithAllAthletes.length === 0 ? <p className="subtitle">暂无数据</p> : null}
            {hitRateRankingWithAllAthletes.map((row, index) => (
              <div key={row.athleteId} className="ranking-row ranking-grid-rate">
                <span className={`rank-pill ${rankTone(index + 1)}`}>#{index + 1}</span>
                <span className="ranking-name">{athleteNameMap.get(row.athleteId) ?? row.athleteId}</span>
                <strong className="result-num ranking-value">{(row.rate * 100).toFixed(1)}%</strong>
                <span className="result-num ranking-meta">
                  {row.hits}/{row.attempts}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="card">
        <div className="row-between">
          <p className="title">每日命中率</p>
          <button
            className={`button button-small ${showPerAthleteTrend ? '' : 'button-ghost'}`}
            type="button"
            onClick={() => setShowPerAthleteTrend((prev) => !prev)}
          >
            {showPerAthleteTrend ? '看合计' : '按人显示'}
          </button>
        </div>
        <p className="subtitle">
          {showPerAthleteTrend
            ? '已按人拆分：每人一条线，某天没投篮则线在此断开（不补 0）。'
            : '按天汇总命中情况，折线图展示趋势，可配合上方筛选查看单个人。'}
        </p>
        {dailyHitRate.length === 0 ? (
          <p className="subtitle">暂无数据。</p>
        ) : (
          <>
            <DailyHitRateChart
              rows={dailyHitRate}
              series={showPerAthleteTrend ? perAthleteSeries : undefined}
            />
            {showPerAthleteTrend && perAthleteSeries.length > 0 ? (
              <div className="trend-legend">
                {perAthleteSeries.map((item) => (
                  <span key={item.athleteId} className="trend-legend-item">
                    <i style={{ background: item.color }} />
                    {item.name}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="ranking-table">
              <div className="ranking-row ranking-head daily-grid">
                <span>日期</span>
                <span>命中/投篮</span>
                <span className="result-num">命中率</span>
                <span className="result-num">人数</span>
              </div>
              {dailyHitRate.map((row) => (
                <div key={row.day} className="ranking-row daily-grid">
                  <span className="ranking-name">{row.dayLabel}</span>
                  <span className="ranking-meta">
                    {row.hits}/{row.attempts}
                  </span>
                  <strong className="result-num ranking-value">{(row.rate * 100).toFixed(1)}%</strong>
                  <span className="result-num ranking-meta">{row.athleteCount} 人</span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <div className="inline-actions">
          <p className="subtitle">积分流水（筛选后）</p>
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={() => setShowPointLedger((prev) => !prev)}
          >
            {showPointLedger ? '收起积分流水' : `展开积分流水（${details.length} 条）`}
          </button>
        </div>
        {!showPointLedger ? (
          <p className="subtitle">已折叠，点击“展开积分流水”查看。</p>
        ) : details.length === 0 ? (
          <p className="subtitle">暂无记录。</p>
        ) : (
          <>
            {pointAdjustments.length > 0 ? (
              <div className="point-adjust-block">
                <p className="subtitle">调整记录</p>
                <ul className="list-reset">
                  {pointAdjustments.map((row) => (
                    <li key={row.key} className="ledger-item">
                      <div>
                        {athleteNameMap.get(row.athleteId) ?? row.athleteId} · 系统调整
                      </div>
                      <div className="subtitle">备注：{row.note}</div>
                      <div className="subtitle">
                        积分 {row.delta > 0 ? `+${row.delta}` : row.delta}，可乐{' '}
                        {row.delta > 0 ? `+${row.delta}` : row.delta}
                      </div>
                      <div className="subtitle">{new Date(row.createdAt).toLocaleString()}</div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <ul className="list-reset">
            {details.map((row) => (
              <li key={row.key} className="ledger-item">
                <div>
                  {athleteNameMap.get(row.athleteId) ?? row.athleteId} · {row.matchTitle}
                </div>
                <div className="subtitle">{row.roundLabel}</div>
                <div className="subtitle">
                  {row.hits}/{row.attempts}，命中率 {(row.hitRate * 100).toFixed(1)}%，积分 {row.pointDelta}，可乐{' '}
                  {row.colaDelta}
                </div>
                <div className="subtitle">{new Date(row.createdAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>
    </main>
  );
}

function DailyHitRateChart({
  rows,
  series,
}: {
  rows: DailyHitRateRow[];
  series?: TrendSeries[];
}) {
  const W = 600;
  const H = 180;
  const padL = 44;
  const padR = 16;
  const padT = 14;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxRate = 1;
  const xFor = (i: number) =>
    rows.length <= 1 ? padL + plotW / 2 : padL + (plotW * i) / (rows.length - 1);
  const yFor = (rate: number) => padT + plotH - (rate / maxRate) * plotH;

  const points = rows.map((row, i) => `${xFor(i).toFixed(1)},${yFor(row.rate).toFixed(1)}`).join(' ');
  const gridLines = [0, 0.25, 0.5, 0.75, 1];

  const multi = !!series && series.length > 0;

  // 把含 null 的序列切成连续段：null（当天没投篮）处断开，不补 0
  const segmentsOf = (values: (number | null)[]) => {
    const segs: { i: number; v: number }[][] = [];
    let cur: { i: number; v: number }[] = [];
    values.forEach((v, i) => {
      if (v == null) {
        if (cur.length > 0) segs.push(cur);
        cur = [];
        return;
      }
      cur.push({ i, v });
    });
    if (cur.length > 0) segs.push(cur);
    return segs;
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="daily-chart" role="img" aria-label="每日命中率折线图">
      {gridLines.map((g) => {
        const y = yFor(g);
        return (
          <g key={g}>
            <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1c2630" strokeWidth="0.5" />
            <text x={padL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#4c5966">
              {Math.round(g * 100)}
            </text>
          </g>
        );
      })}
      {rows.length > 0 ? (
        <>
          {multi ? (
            series!.map((item) => (
              <g key={item.athleteId}>
                {segmentsOf(item.values).map((seg, si) =>
                  seg.length === 1 ? (
                    <circle
                      key={`seg${si}`}
                      cx={xFor(seg[0].i)}
                      cy={yFor(seg[0].v)}
                      r="3"
                      fill={item.color}
                    />
                  ) : (
                    <polyline
                      key={`seg${si}`}
                      points={seg
                        .map((p) => `${xFor(p.i).toFixed(1)},${yFor(p.v).toFixed(1)}`)
                        .join(' ')}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ),
                )}
                {item.values.map((v, i) =>
                  v == null ? null : (
                    <circle
                      key={`dot${i}`}
                      cx={xFor(i)}
                      cy={yFor(v)}
                      r="2.5"
                      fill={item.color}
                    />
                  ),
                )}
              </g>
            ))
          ) : (
            <>
              <polyline
                points={points}
                fill="none"
                stroke="#00e6a8"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {rows.map((row, i) => (
                <circle key={row.day} cx={xFor(i)} cy={yFor(row.rate)} r="4" fill="#00e6a8" />
              ))}
            </>
          )}
          {rows.map((row, i) => (
            <text
              key={`lab-${row.day}`}
              x={xFor(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize="11"
              fill="#8b98a5"
            >
              {row.dayLabel}
            </text>
          ))}
        </>
      ) : null}
    </svg>
  );
}
