-- 篮球罚球记分器 - PostgreSQL 建表脚本（Plan C）
-- 通过 tcb db execute -e <envId> --sql "<单条SQL>" 逐条执行
-- 每条 SQL 单独执行（接口限制：一次只能一条 SQL）

-- 1. athletes 运动员表
CREATE TABLE IF NOT EXISTS public.athletes (
  id text PRIMARY KEY,
  name text NOT NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- 2. matches 比赛表
CREATE TABLE IF NOT EXISTS public.matches (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at bigint NOT NULL,
  finished_at bigint,
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- 3. match_players 比赛-运动员关联表
CREATE TABLE IF NOT EXISTS public.match_players (
  id text PRIMARY KEY,
  match_id text NOT NULL,
  athlete_id text NOT NULL,
  join_order integer NOT NULL DEFAULT 0,
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- 4. rounds 轮次表
CREATE TABLE IF NOT EXISTS public.rounds (
  id text PRIMARY KEY,
  match_id text NOT NULL,
  round_no integer NOT NULL,
  phase text NOT NULL DEFAULT 'regular',
  overtime_seq integer NOT NULL DEFAULT 0,
  parent_round_id text,
  created_at bigint NOT NULL,
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- 5. round_stats 轮次统计表
CREATE TABLE IF NOT EXISTS public.round_stats (
  id text PRIMARY KEY,
  round_id text NOT NULL,
  match_id text NOT NULL,
  athlete_id text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  hits integer NOT NULL DEFAULT 0,
  hit_rate double precision NOT NULL DEFAULT 0,
  rank_group text NOT NULL DEFAULT 'pending',
  point_delta integer NOT NULL DEFAULT 0,
  cola_delta integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- 6. cola_ledger 可乐账本表
CREATE TABLE IF NOT EXISTS public.cola_ledger (
  id text PRIMARY KEY,
  type text NOT NULL,
  from_athlete_id text,
  to_athlete_id text,
  amount integer NOT NULL DEFAULT 0,
  match_id text,
  round_id text,
  note text,
  created_at bigint NOT NULL,
  operator text NOT NULL DEFAULT 'system',
  uid text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::json->>'sub')
);

-- ============ 权限（GRANT + RLS）============
-- 登录用户（authenticated）可读写全部表
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athletes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.matches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.match_players TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rounds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.round_stats TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cola_ledger TO authenticated;

-- 启用 RLS
ALTER TABLE public.athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.round_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cola_ledger ENABLE ROW LEVEL SECURITY;

-- RLS Policy：仅自己（uid = JWT sub）可读写（PRIVATE 模式）
CREATE POLICY athletes_private ON public.athletes
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY matches_private ON public.matches
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY match_players_private ON public.match_players
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY rounds_private ON public.rounds
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY round_stats_private ON public.round_stats
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));

CREATE POLICY cola_ledger_private ON public.cola_ledger
  FOR ALL TO authenticated
  USING (uid = (current_setting('request.jwt.claims', true)::json->>'sub'))
  WITH CHECK (uid = (current_setting('request.jwt.claims', true)::json->>'sub'));
