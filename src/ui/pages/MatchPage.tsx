import { useEffect, useMemo, useRef, useState, type ChangeEventHandler } from 'react';
import {
  archiveToJson,
  exportArchive,
  importArchiveFromJson,
} from '../../application/usecases/archiveService';
import {
  buildRound,
  buildRoundRewardLedger,
  buildRoundStats,
  previewRoundSettlement,
} from '../../application/usecases/matchService';
import type { SettlementMode } from '../../domain/roundSettlement';
import type { Athlete, Match, MatchPlayer } from '../../domain/types';
import { AthleteRepositoryDexie } from '../../infrastructure/repositories/local/athleteRepositoryDexie';
import { ColaLedgerRepositoryDexie } from '../../infrastructure/repositories/local/colaLedgerRepositoryDexie';
import { MatchRepositoryDexie } from '../../infrastructure/repositories/local/matchRepositoryDexie';
import { RoundRepositoryDexie } from '../../infrastructure/repositories/local/roundRepositoryDexie';
import {
  pushToCloud,
  pullFromCloud,
} from '../../infrastructure/cloudbase/syncService';
import { withAutoBackupSuppressed } from '../../infrastructure/cloudbase/autoBackup';
import { useAuth } from '../../infrastructure/auth/useAuth';
import { LoginPanel } from '../components/LoginPanel';
import { createId } from '../../shared/createId';

interface ActiveMatchState {
  match: Match;
  players: MatchPlayer[];
  nextRoundNo: number;
}

interface SessionState {
  mode: SettlementMode;
  participants: string[];
  roundNo: number;
  parentRoundId: string | null;
  overtimeSeq: number;
}

interface LastSubmissionState {
  roundId: string;
  session: SessionState;
  pendingWinnerIds: string[];
}

interface ResultDisplayRow {
  athleteId: string;
  name: string;
  attempts: number;
  hits: number;
  hitRate: number;
  pointDelta: -1 | 0 | 1;
  colaDelta: -1 | 0 | 1;
}

interface RoundEndSummaryRow {
  athleteId: string;
  name: string;
  rounds: number;
  points: number;
  cola: number;
}

interface MatchEndSummaryRow {
  athleteId: string;
  name: string;
  rounds: number;
  points: number;
  cola: number;
}

type UiStage = 'select' | 'setup' | 'input' | 'result';

const athleteRepo = new AthleteRepositoryDexie();
const matchRepo = new MatchRepositoryDexie();
const roundRepo = new RoundRepositoryDexie();
const colaRepo = new ColaLedgerRepositoryDexie();

export function MatchPage() {
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [activeMatch, setActiveMatch] = useState<ActiveMatchState | null>(null);
  const [stage, setStage] = useState<UiStage>('select');
  const [session, setSession] = useState<SessionState | null>(null);
  const [nextSession, setNextSession] = useState<SessionState | null>(null);
  const [pendingWinnerIds, setPendingWinnerIds] = useState<string[]>([]);
  const [attemptsMap, setAttemptsMap] = useState<Record<string, number>>({});
  const [hitsMap, setHitsMap] = useState<Record<string, number>>({});
  const [resultRows, setResultRows] = useState<ResultDisplayRow[]>([]);
  const [resultHint, setResultHint] = useState('');
  const [error, setError] = useState('');
  const [archiveMessage, setArchiveMessage] = useState('');
  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const auth = useAuth();
  const [lastSubmission, setLastSubmission] = useState<LastSubmissionState | null>(null);
  const [isStartingMatch, setIsStartingMatch] = useState(false);
  const [showRoundEndModal, setShowRoundEndModal] = useState(false);
  const [roundEndRows, setRoundEndRows] = useState<RoundEndSummaryRow[]>([]);
  const [showMatchEndModal, setShowMatchEndModal] = useState(false);
  const [matchEndRows, setMatchEndRows] = useState<MatchEndSummaryRow[]>([]);
  const [settlementWarning, setSettlementWarning] = useState('');

  /**
   * A 方案：常规轮「最高分并列」时，赢家要等加时定，输家的 −1 也一起延后。
   * 记下该轮的输家和轮次 id，等 overtime_winner 决出唯一赢家后，
   * 再把这笔 −1 回写到原常规轮（输家的投篮数据在那条记录上）。
   * 若整场结束都未决出赢家，则这轮不结算（不加不扣）。
   */
  const pendingLoserRef = useRef<{ roundId: string; loserIds: string[] } | null>(null);

  const settlePendingLoser = async () => {
    const pending = pendingLoserRef.current;
    if (!pending || !activeMatch) return;
    pendingLoserRef.current = null;
    try {
      const all = await roundRepo.getRoundStatsByMatch(activeMatch.match.id);
      const targets = all.filter(
        (row) =>
          row.roundId === pending.roundId && pending.loserIds.includes(row.athleteId),
      );
      if (targets.length === 0) return;

      await roundRepo.updateRoundStats(
        targets.map((row) => ({
          ...row,
          pointDelta: -1 as const,
          colaDelta: -1 as const,
          rankGroup: 'loser' as const,
        })),
      );

      await colaRepo.append(
        targets.map((row) => ({
          id: createId(),
          type: 'round_reward' as const,
          fromAthleteId: row.athleteId,
          toAthleteId: null,
          amount: 1,
          matchId: activeMatch.match.id,
          roundId: pending.roundId,
          note: '比赛扣减',
          createdAt: Date.now(),
          operator: 'system' as const,
        })),
      );
    } catch {
      // 回写失败不阻断主流程；结束本局的自检会提示账面不平
    }
  };
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const athleteMap = useMemo(() => {
    const map = new Map<string, Athlete>();
    athletes.forEach((item) => map.set(item.id, item));
    return map;
  }, [athletes]);

  useEffect(() => {
    void boot();
  }, []);

  const boot = async () => {
    const [active, allAthletes] = await Promise.all([
      matchRepo.getActiveMatch(),
      athleteRepo.listActive(),
    ]);

    setAthletes(allAthletes);

    if (!active) {
      setStage('select');
      return;
    }

    const [players, rounds] = await Promise.all([
      matchRepo.getPlayers(active.id),
      roundRepo.getRoundsByMatch(active.id),
    ]);

    const maxRoundNo = rounds.reduce((max, item) => Math.max(max, item.roundNo), 0);
    const nextRoundNo = maxRoundNo + 1;

    const state: ActiveMatchState = {
      match: active,
      players,
      nextRoundNo,
    };

    setActiveMatch(state);
    prepareRegularSession(state);
  };

  const prevAuthEmailRef = useRef<string | null | undefined>(undefined);

  // 登录 / 切换账号时，自动拉取该账号的云端数据（空账号则保留本机数据）
  const autoLoadAccount = async (email: string) => {
    setSyncMessage(`正在加载 ${email} 的云端数据…`);
    setIsSyncing(true);
    try {
      const result = await withAutoBackupSuppressed(() =>
        pullFromCloud({ allowEmpty: true }),
      );
      const total =
        result.counts.athletes +
        result.counts.matches +
        result.counts.matchPlayers +
        result.counts.rounds +
        result.counts.roundStats +
        result.counts.colaLedger;
      if (total === 0) {
        setSyncMessage(
          `已登录 ${email}（该账号暂无云端数据，可点“备份到云端”上传本机数据）。`,
        );
      } else {
        setSyncMessage(`已登录 ${email}，已加载云端数据（共 ${total} 条）。`);
        setSelectedIds([]);
        await boot();
      }
    } catch (err) {
      setSyncMessage(`已登录 ${email}，加载云端数据失败：${String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    const email = auth.email;
    if (prevAuthEmailRef.current === undefined) {
      prevAuthEmailRef.current = email;
      return;
    }
    if (email && email !== prevAuthEmailRef.current) {
      void autoLoadAccount(email);
    }
    prevAuthEmailRef.current = email;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.email]);

  const prepareRegularSession = (state: ActiveMatchState) => {
    const participants = state.players.map((item) => item.athleteId);
    const newSession: SessionState = {
      mode: 'regular',
      participants,
      roundNo: state.nextRoundNo,
      parentRoundId: null,
      overtimeSeq: 0,
    };
    setSession(newSession);
    setNextSession(null);
    setPendingWinnerIds([]);
    setLastSubmission(null);
    setResultRows([]);
    setShowRoundEndModal(false);
    setRoundEndRows([]);
    setShowMatchEndModal(false);
    setMatchEndRows([]);
    setResultHint('');
    initInputs(participants, 'regular');
    setStage('setup');
  };

  const initInputs = (participants: string[], mode: SettlementMode) => {
    const defaultAttempts = mode === 'regular' ? 10 : 1;
    const attempts: Record<string, number> = {};
    const hits: Record<string, number> = {};
    participants.forEach((id) => {
      attempts[id] = defaultAttempts;
      hits[id] = 0;
    });
    setAttemptsMap(attempts);
    setHitsMap(hits);
  };

  const toggleSelect = (athleteId: string) => {
    setSelectedIds((prev) =>
      prev.includes(athleteId)
        ? prev.filter((x) => x !== athleteId)
        : [...prev, athleteId],
    );
  };

  const createMatch = async () => {
    setError('');
    setIsStartingMatch(true);
    if (selectedIds.length < 2) {
      setError('至少选择 2 名球员。');
      setIsStartingMatch(false);
      return;
    }

    try {
      const now = Date.now();
      const match: Match = {
        id: createId(),
        title: `罚球局 ${new Date(now).toLocaleString()}`,
        status: 'active',
        createdAt: now,
        finishedAt: null,
      };

      const players: MatchPlayer[] = selectedIds.map((athleteId, index) => ({
        id: createId(),
        matchId: match.id,
        athleteId,
        joinOrder: index + 1,
      }));

      await matchRepo.createMatch(match, players);

      const state: ActiveMatchState = {
        match,
        players,
        nextRoundNo: 1,
      };

      setActiveMatch(state);
      prepareRegularSession(state);
    } catch (err) {
      setError(`开新局失败：${String(err)}`);
    } finally {
      setIsStartingMatch(false);
    }
  };

  const onExportArchive = async () => {
    try {
      const payload = await exportArchive();
      const json = archiveToJson(payload);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
      a.href = url;
      a.download = `basketball-archive-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setArchiveMessage('导出成功。');
    } catch {
      setArchiveMessage('导出失败，请重试。');
    }
  };

  const openImportDialog = () => {
    importInputRef.current?.click();
  };

  const onImportArchiveFile: ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const ok = window.confirm('导入将覆盖当前本地数据，是否继续？');
    if (!ok) return;

    try {
      const text = await file.text();
      await importArchiveFromJson(text);
      setArchiveMessage('导入成功，已刷新数据。');
      setSelectedIds([]);
      await boot();
    } catch {
      setArchiveMessage('导入失败：文件格式错误或版本不支持。');
    } finally {
      event.target.value = '';
    }
  };

  const onPushToCloud = async () => {
    if (!auth.email) {
      setSyncMessage('请先登录再备份。');
      return;
    }
    setSyncMessage('');
    setIsSyncing(true);
    try {
      const result = await pushToCloud();
      const total =
        result.counts.athletes +
        result.counts.matches +
        result.counts.matchPlayers +
        result.counts.rounds +
        result.counts.roundStats +
        result.counts.colaLedger;
      setSyncMessage(`已备份到云端（共 ${total} 条，账号：${result.email}）。`);
    } catch (err) {
      setSyncMessage(`备份失败：${String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const onPullFromCloud = async () => {
    if (!auth.email) {
      setSyncMessage('请先登录再恢复。');
      return;
    }

    const ok = window.confirm(
      `从云端恢复将覆盖当前本地数据（账号：${auth.email}），是否继续？`,
    );
    if (!ok) return;

    setSyncMessage('');
    setIsSyncing(true);
    try {
      const result = await withAutoBackupSuppressed(() => pullFromCloud());
      const total =
        result.counts.athletes +
        result.counts.matches +
        result.counts.matchPlayers +
        result.counts.rounds +
        result.counts.roundStats +
        result.counts.colaLedger;
      setSyncMessage(`已从云端恢复（共 ${total} 条），正在刷新…`);
      setSelectedIds([]);
      await boot();
    } catch (err) {
      setSyncMessage(`恢复失败：${String(err)}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const finishMatch = async () => {
    if (!activeMatch) return;
    await matchRepo.finishMatch(activeMatch.match.id);
    setActiveMatch(null);
    setSession(null);
    setNextSession(null);
    setPendingWinnerIds([]);
    setLastSubmission(null);
    setShowMatchEndModal(false);
    setMatchEndRows([]);
    setSettlementWarning('');
    // 未决轮次的欠账随比赛结束一并作废（该轮不结算）
    pendingLoserRef.current = null;
    setStage('select');
  };

  const openMatchEndSummary = async () => {
    if (!activeMatch) return;

    const [rounds, stats] = await Promise.all([
      roundRepo.getRoundsByMatch(activeMatch.match.id),
      roundRepo.getRoundStatsByMatch(activeMatch.match.id),
    ]);

    const roundNoByRoundId = new Map<string, number>();
    rounds.forEach((row) => {
      roundNoByRoundId.set(row.id, row.roundNo);
    });

    const byAthlete = new Map<
      string,
      { roundNos: Set<number>; points: number; cola: number }
    >();

    stats.forEach((row) => {
      const roundNo = roundNoByRoundId.get(row.roundId);
      const prev = byAthlete.get(row.athleteId) ?? {
        roundNos: new Set<number>(),
        points: 0,
        cola: 0,
      };
      if (typeof roundNo === 'number') {
        prev.roundNos.add(roundNo);
      }
      prev.points += row.pointDelta;
      prev.cola += row.colaDelta;
      byAthlete.set(row.athleteId, prev);
    });

    const rows = activeMatch.players.map((item) => {
      const score = byAthlete.get(item.athleteId);
      return {
        athleteId: item.athleteId,
        name: athleteMap.get(item.athleteId)?.name ?? item.athleteId,
        rounds: score?.roundNos.size ?? 0,
        points: score?.points ?? 0,
        cola: score?.cola ?? 0,
      };
    });

    setMatchEndRows(rows.sort((a, b) => b.points - a.points));

    // 自检：按「轮」校验收支是否成对（同一 roundNo 的常规+加时算一轮）。
    // 正常每轮应为 +1 / −1 抵消，净额恒为 0；不为 0 说明有孤立的加或扣。
    const netByRoundNo = new Map<number, number>();
    stats.forEach((row) => {
      const roundNo = roundNoByRoundId.get(row.roundId);
      if (typeof roundNo !== 'number') return;
      netByRoundNo.set(roundNo, (netByRoundNo.get(roundNo) ?? 0) + row.pointDelta);
    });
    const badRounds = [...netByRoundNo.entries()]
      .filter(([, v]) => v !== 0)
      .sort((a, b) => a[0] - b[0])
      .map(([roundNo, v]) => `第 ${roundNo} 轮(${v > 0 ? '+' : ''}${v})`);
    const totalNet = [...netByRoundNo.values()].reduce((sum, v) => sum + v, 0);

    setSettlementWarning(
      badRounds.length > 0
        ? `⚠️ 账面不平：${badRounds.join('、')}；本场积分净 ${totalNet > 0 ? '+' : ''}${totalNet}。正常应为 0。`
        : '',
    );

    setShowMatchEndModal(true);
  };

  const startHitInput = () => {
    if (!session) return;
    const fixedHits = { ...hitsMap };
    session.participants.forEach((id) => {
      const attempts = attemptsMap[id] ?? 0;
      const current = fixedHits[id] ?? 0;
      fixedHits[id] = Math.min(Math.max(current, 0), attempts);
    });
    setHitsMap(fixedHits);
    setStage('input');
  };

  const updateAttempt = (athleteId: string, value: number) => {
    const safe = Math.max(0, Math.floor(value || 0));
    setAttemptsMap((prev) => ({ ...prev, [athleteId]: safe }));
    setHitsMap((prev) => ({ ...prev, [athleteId]: Math.min(prev[athleteId] ?? 0, safe) }));
  };

  const addHit = (athleteId: string, delta: number) => {
    const attempts = attemptsMap[athleteId] ?? 0;
    const current = hitsMap[athleteId] ?? 0;
    const next = Math.min(Math.max(current + delta, 0), attempts);
    setHitsMap((prev) => ({ ...prev, [athleteId]: next }));
  };

  const submitRound = async () => {
    if (!activeMatch || !session) return;

    const inputs = session.participants.map((athleteId) => ({
      athleteId,
      attempts: attemptsMap[athleteId] ?? 0,
      hits: hitsMap[athleteId] ?? 0,
    }));

    const settlement = previewRoundSettlement(inputs, session.mode);

    const round = buildRound({
      matchId: activeMatch.match.id,
      roundNo: session.roundNo,
      mode: session.mode,
      parentRoundId: session.parentRoundId,
      overtimeSeq: session.overtimeSeq,
    });

    const stats = buildRoundStats({
      matchId: activeMatch.match.id,
      roundId: round.id,
      settlement,
    });
    const ledger = buildRoundRewardLedger({
      matchId: activeMatch.match.id,
      roundId: round.id,
      settlement,
    });

    await roundRepo.createRound(round);
    await roundRepo.saveRoundStats(stats);
    await colaRepo.append(ledger);
    setLastSubmission({
      roundId: round.id,
      session,
      pendingWinnerIds: [...pendingWinnerIds],
    });

    setResultRows(
      settlement.rows.map((row) => ({
        athleteId: row.athleteId,
        name: athleteMap.get(row.athleteId)?.name ?? row.athleteId,
        attempts: row.attempts,
        hits: row.hits,
        hitRate: row.hitRate,
        pointDelta: row.pointDelta,
        colaDelta: row.colaDelta,
      })),
    );

    let plannedNext: SessionState | null = null;

    if (session.mode === 'regular') {
      if (settlement.needDuelOvertime) {
        // 2 人局两人打平：合并为一场加时（duel），不再拆成「最后加时 + 第一加时」
        plannedNext = {
          mode: 'overtime_duel',
          participants: settlement.duelAthleteIds,
          roundNo: session.roundNo,
          parentRoundId: round.id,
          overtimeSeq: 1,
        };
        setPendingWinnerIds([]);
      } else {
        const hasLoserTie = settlement.needLoserOvertime;
        const hasWinnerTie = settlement.needWinnerOvertime;
        setPendingWinnerIds(hasWinnerTie ? settlement.winnerAthleteIds : []);

        // 赢家并列、输家唯一 → 输家的 −1 先不算，等加时决出赢家再回写本轮回
        pendingLoserRef.current =
          hasWinnerTie && !hasLoserTie && settlement.loserAthleteIds.length === 1
            ? { roundId: round.id, loserIds: settlement.loserAthleteIds }
            : null;

        if (hasLoserTie) {
          plannedNext = {
            mode: 'overtime_loser',
            participants: settlement.loserAthleteIds,
            roundNo: session.roundNo,
            parentRoundId: round.id,
            overtimeSeq: 1,
          };
        } else if (hasWinnerTie) {
          plannedNext = {
            mode: 'overtime_winner',
            participants: settlement.winnerAthleteIds,
            roundNo: session.roundNo,
            parentRoundId: round.id,
            overtimeSeq: 1,
          };
        }
      }
    } else if (session.mode === 'overtime_loser') {
      if (settlement.needLoserOvertime) {
        plannedNext = {
          ...session,
          participants: settlement.loserAthleteIds,
          overtimeSeq: session.overtimeSeq + 1,
        };
      } else if (pendingWinnerIds.length > 1) {
        plannedNext = {
          mode: 'overtime_winner',
          participants: pendingWinnerIds,
          roundNo: session.roundNo,
          parentRoundId: session.parentRoundId,
          overtimeSeq: 1,
        };
        setPendingWinnerIds([]);
      } else {
        setPendingWinnerIds([]);
      }
    } else if (session.mode === 'overtime_duel') {
      if (settlement.needDuelOvertime) {
        plannedNext = {
          ...session,
          participants: settlement.duelAthleteIds,
          overtimeSeq: session.overtimeSeq + 1,
        };
      } else {
        setPendingWinnerIds([]);
      }
    } else if (session.mode === 'overtime_winner') {
      if (settlement.needWinnerOvertime) {
        plannedNext = {
          ...session,
          participants: settlement.winnerAthleteIds,
          overtimeSeq: session.overtimeSeq + 1,
        };
      } else {
        setPendingWinnerIds([]);
        // 赢家已决出：把本轮输家欠下的 −1 回写到原常规轮，保证收支成对
        await settlePendingLoser();
      }
    } else {
      setPendingWinnerIds([]);
    }

    setNextSession(plannedNext);

    if (plannedNext) {
      if (plannedNext.mode === 'overtime_loser') {
        setResultHint('先进行最后加时。');
      } else if (plannedNext.mode === 'overtime_winner') {
        setResultHint('进入第一加时。');
      } else if (plannedNext.mode === 'overtime_duel') {
        setResultHint('平局，进入加时。');
      }
    } else {
      setResultHint('本轮已完成，可开始下轮。');
    }

    setStage('result');
  };

  const openRoundEndSummary = async () => {
    if (!activeMatch) return;

    const [rounds, stats] = await Promise.all([
      roundRepo.getRoundsByMatch(activeMatch.match.id),
      roundRepo.getRoundStatsByMatch(activeMatch.match.id),
    ]);

    const roundNoByRoundId = new Map<string, number>();
    rounds.forEach((row) => {
      roundNoByRoundId.set(row.id, row.roundNo);
    });

    // 按 roundNo 去重：常规赛和加时属于同一轮，按 1 轮算。
    const byAthlete = new Map<
      string,
      { roundNos: Set<number>; points: number; cola: number }
    >();

    stats.forEach((row) => {
      const roundNo = roundNoByRoundId.get(row.roundId);
      const prev = byAthlete.get(row.athleteId) ?? {
        roundNos: new Set<number>(),
        points: 0,
        cola: 0,
      };
      if (typeof roundNo === 'number') {
        prev.roundNos.add(roundNo);
      }
      prev.points += row.pointDelta;
      prev.cola += row.colaDelta;
      byAthlete.set(row.athleteId, prev);
    });

    const rows = activeMatch.players.map((item) => {
      const score = byAthlete.get(item.athleteId);
      return {
        athleteId: item.athleteId,
        name: athleteMap.get(item.athleteId)?.name ?? item.athleteId,
        rounds: score?.roundNos.size ?? 0,
        points: score?.points ?? 0,
        cola: score?.cola ?? 0,
      };
    });

    setRoundEndRows(rows.sort((a, b) => b.points - a.points));
    setShowRoundEndModal(true);
  };

  const continueAfterResult = async () => {
    if (!activeMatch || !session) return;

    if (!nextSession) {
      setLastSubmission(null);
      prepareRegularSession({
        ...activeMatch,
        nextRoundNo: activeMatch.nextRoundNo + 1,
      });
      setActiveMatch((prev) =>
        prev
          ? {
              ...prev,
              nextRoundNo: prev.nextRoundNo + 1,
            }
          : prev,
      );
      return;
    }

    setSession(nextSession);
    setNextSession(null);
    setLastSubmission(null);
    setResultRows([]);
    initInputs(nextSession.participants, nextSession.mode);
    setShowRoundEndModal(false);
    setRoundEndRows([]);
    setShowMatchEndModal(false);
    setMatchEndRows([]);
    // 加时直接进入命中录入，跳过「确认每人投 1 球」的 setup 屏（框架保留，便于以后改规则）
    setStage(nextSession.mode === 'regular' ? 'setup' : 'input');
  };

  const rollbackLastSubmission = async () => {
    if (!lastSubmission) return;
    await roundRepo.deleteRoundWithStats(lastSubmission.roundId);
    await colaRepo.deleteByRound(lastSubmission.roundId);
    setSession(lastSubmission.session);
    setPendingWinnerIds(lastSubmission.pendingWinnerIds);
    setNextSession(null);
    setResultRows([]);
    setResultHint('已撤回本次提交，请重新录入。');
    setLastSubmission(null);
    setShowRoundEndModal(false);
    setRoundEndRows([]);
    setShowMatchEndModal(false);
    setMatchEndRows([]);
    setStage('input');
  };

  if (stage === 'select') {
    return (
      <main className="page">
        <section className="card">
          <h1 className="title">开始比赛</h1>
          <p className="subtitle">开始本局前请先选人（至少 2 名）。</p>
          <div className="inline-actions">
            <button className="button button-small button-ghost" type="button" onClick={onExportArchive}>
              导出存档
            </button>
            <button className="button button-small button-ghost" type="button" onClick={openImportDialog}>
              导入存档
            </button>
            <button
              className="button button-small button-ghost"
              type="button"
              onClick={() => void onPushToCloud()}
              disabled={isSyncing}
            >
              {isSyncing ? '同步中…' : '备份到云端'}
            </button>
            <button
              className="button button-small button-ghost"
              type="button"
              onClick={() => void onPullFromCloud()}
              disabled={isSyncing}
            >
              从云端恢复
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden-input"
              onChange={onImportArchiveFile}
            />
          </div>
          {archiveMessage ? <p className="subtitle">{archiveMessage}</p> : null}
          {syncMessage ? <p className="subtitle">{syncMessage}</p> : null}
          <LoginPanel auth={auth} />
        </section>

        <section className="card">
          {athletes.length === 0 ? (
            <p className="subtitle">暂无球员，请先到“人员”页面新增。</p>
          ) : (
            <>
              <ul className="list-reset">
                {athletes.map((athlete) => (
                  <li key={athlete.id} className="row-between">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(athlete.id)}
                        onChange={() => toggleSelect(athlete.id)}
                      />{' '}
                      {athlete.name}
                    </label>
                  </li>
                ))}
              </ul>
              {error ? <p className="error-text">{error}</p> : null}
              <button
                className="button"
                type="button"
                onClick={createMatch}
                disabled={isStartingMatch}
              >
                {isStartingMatch ? '开局中...' : '开新局'}
              </button>
              <p className="subtitle">已选 {selectedIds.length} 人</p>
            </>
          )}
        </section>
      </main>
    );
  }

  const participants = session?.participants ?? [];
  const title = session
    ? session.mode === 'regular'
      ? `第 ${session.roundNo} 轮`
      : session.mode === 'overtime_loser'
        ? `第 ${session.roundNo} 轮 · 最后加时 #${session.overtimeSeq}`
        : session.mode === 'overtime_winner'
          ? `第 ${session.roundNo} 轮 · 第一加时 #${session.overtimeSeq}`
          : `第 ${session.roundNo} 轮 · 加时 #${session.overtimeSeq}`
    : '';

  return (
    <main className="page">
      <section className="card">
        <h1 className="title">比赛进行中</h1>
        <p className="subtitle">{activeMatch?.match.title}</p>
        <p className="subtitle">当前阶段：{title}</p>
        <div className="inline-actions">
          <button className="button button-small button-ghost" type="button" onClick={onExportArchive}>
            导出存档
          </button>
          <button className="button button-small button-ghost" type="button" onClick={openImportDialog}>
            导入存档
          </button>
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={() => void onPushToCloud()}
            disabled={isSyncing}
          >
            {isSyncing ? '同步中…' : '备份到云端'}
          </button>
          <button
            className="button button-small button-ghost"
            type="button"
            onClick={() => void onPullFromCloud()}
            disabled={isSyncing}
          >
            从云端恢复
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden-input"
            onChange={onImportArchiveFile}
          />
        </div>
        {archiveMessage ? <p className="subtitle">{archiveMessage}</p> : null}
        {syncMessage ? <p className="subtitle">{syncMessage}</p> : null}
        <LoginPanel auth={auth} />
        <button className="button button-ghost" type="button" onClick={() => void openMatchEndSummary()}>
          结束本局
        </button>
      </section>

      {stage === 'setup' ? (
        <section className="card">
          <p className="subtitle">
            {session?.mode === 'regular' ? '每人投球数（默认 10，可用 + / - 调整）' : '加时规则：每人固定投 1 球'}
          </p>
          <ul className="list-reset">
            {participants.map((id) => (
              <li key={id} className="row-between">
                <span>{athleteMap.get(id)?.name ?? id}</span>
                <div className="hit-control">
                  <button
                    className="button button-small button-ghost"
                    type="button"
                    onClick={() => updateAttempt(id, (attemptsMap[id] ?? 10) - 1)}
                    disabled={session?.mode !== 'regular'}
                  >
                    -
                  </button>
                  <span className="hit-value">
                    {attemptsMap[id] ?? (session?.mode === 'regular' ? 10 : 1)}
                  </span>
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() => updateAttempt(id, (attemptsMap[id] ?? 10) + 1)}
                    disabled={session?.mode !== 'regular'}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="button" type="button" onClick={startHitInput}>
            开始录入命中
          </button>
        </section>
      ) : null}

      {stage === 'input' ? (
        <section className="card">
          <p className="subtitle">命中录入（+ / -）</p>
          <ul className="list-reset">
            {participants.map((id) => (
              <li key={id} className="row-between">
                <span>{athleteMap.get(id)?.name ?? id}</span>
                <div className="hit-control">
                  <button
                    className="button button-small button-ghost"
                    type="button"
                    onClick={() => addHit(id, -1)}
                  >
                    -
                  </button>
                  <span className="hit-value">
                    {hitsMap[id] ?? 0}/{attemptsMap[id] ?? 0}
                  </span>
                  <button
                    className="button button-small"
                    type="button"
                    onClick={() => addHit(id, 1)}
                  >
                    +
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="button" type="button" onClick={submitRound}>
            确认数据
          </button>
          <button className="button button-ghost" type="button" onClick={() => setStage('setup')}>
            返回上一屏
          </button>
        </section>
      ) : null}

      {stage === 'result' ? (
        <section className="card">
          <p className="subtitle">本次结果</p>
          <div className="result-table">
            <div className="result-row result-head">
              <span>姓名</span>
              <span>命中</span>
              <span>命中率</span>
              <span>积分</span>
              <span>可乐</span>
            </div>
            {resultRows.map((row) => (
              <div key={row.athleteId} className="result-row">
                <span>{row.name}</span>
                <span className="result-num">
                  {row.hits}/{row.attempts}
                </span>
                <span className="result-num">{(row.hitRate * 100).toFixed(1)}%</span>
                <span className="result-num">{row.pointDelta > 0 ? `+${row.pointDelta}` : row.pointDelta}</span>
                <span className="result-num">{row.colaDelta > 0 ? `+${row.colaDelta}` : row.colaDelta}</span>
              </div>
            ))}
          </div>
          <p className="subtitle">{resultHint}</p>
          <div className="inline-actions">
            {nextSession ? (
              <button className="button" type="button" onClick={continueAfterResult}>
                继续
              </button>
            ) : (
              <button className="button" type="button" onClick={() => void openRoundEndSummary()}>
                结束本轮
              </button>
            )}
            <button
              className="button button-ghost"
              type="button"
              onClick={rollbackLastSubmission}
              disabled={!lastSubmission}
            >
              撤回本次提交
            </button>
          </div>
        </section>
      ) : null}

      {showRoundEndModal ? (
        <div className="modal-mask" onClick={() => setShowRoundEndModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="title">{activeMatch?.match.title}：本轮结束结算</h3>
            <div className="result-table">
              <div className="result-row result-head result-row-4">
                <span>姓名</span>
                <span>轮</span>
                <span>积分</span>
                <span>可乐</span>
              </div>
              {roundEndRows.map((row) => (
                <div key={row.athleteId} className="result-row result-row-4">
                  <span>{row.name}</span>
                  <span className="result-num">{row.rounds}</span>
                  <span className="result-num">{row.points}</span>
                  <span className="result-num">{row.cola}</span>
                </div>
              ))}
            </div>
            <div className="inline-actions">
              <button className="button" type="button" onClick={continueAfterResult}>
                开始下轮
              </button>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setShowRoundEndModal(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showMatchEndModal ? (
        <div className="modal-mask" onClick={() => setShowMatchEndModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 className="title">{activeMatch?.match.title}：本局结束结算</h3>
            <div className="result-table">
              <div className="result-row result-head result-row-4">
                <span>姓名</span>
                <span>轮</span>
                <span>积分</span>
                <span>可乐</span>
              </div>
              {matchEndRows.map((row) => (
                <div key={row.athleteId} className="result-row result-row-4">
                  <span>{row.name}</span>
                  <span className="result-num">{row.rounds}</span>
                  <span className="result-num">{row.points}</span>
                  <span className="result-num">{row.cola}</span>
                </div>
              ))}
            </div>
            {settlementWarning ? (
              <p className="subtitle settlement-warning">{settlementWarning}</p>
            ) : null}
            <p className="subtitle">说明：同一轮内的常规赛和加时赛，按 1 轮计算。</p>
            <div className="inline-actions">
              <button className="button" type="button" onClick={() => void finishMatch()}>
                确认结束本局
              </button>
              <button
                className="button button-ghost"
                type="button"
                onClick={() => setShowMatchEndModal(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
