-- 数据归属迁移：从「按登录邮箱隔离」改为「全队共享一份」
--
-- 背景：原归属键是登录邮箱，导致可乐「A 发起 → B 确认」跨账号无法工作。
-- 现在所有账号统一读写共享空间 'team'。
--
-- 注意：库中另有三份数据（123456 / 654321 / 328627264@qq.com），
-- 已核实它们与主份 20797618@qq.com 的 id 完全重合，是副本；
-- 若一并迁移会因 (sync_code, id) 主键冲突而失败，故只迁移主份。

UPDATE athletes       SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE matches        SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE match_players  SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE rounds         SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE round_stats    SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE cola_ledger    SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE athlete_claims SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
UPDATE cola_transfers SET sync_code = 'team' WHERE sync_code = '20797618@qq.com';
