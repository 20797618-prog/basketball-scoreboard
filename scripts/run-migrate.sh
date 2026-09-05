#!/bin/zsh
# 逐条执行 migrate-pg.sql 中的 SQL 语句
# 用法: zsh scripts/run-migrate.sh
ENV_ID="basketballscoreboard-d5a1794da22"
TCB="/Users/kenmaster/.workbuddy/binaries/node/workspace/node_modules/@cloudbase/cli/bin/tcb"
SQL_FILE="scripts/migrate-pg.sql"

# 用 node 解析 SQL 文件，按语句分隔（分号结尾），忽略注释和空行，输出每条 SQL 到文件
NODE="/Users/kenmaster/.workbuddy/binaries/node/versions/22.22.2-2/bin/node"

$NODE -e '
const fs = require("fs");
const raw = fs.readFileSync(process.argv[1], "utf8");
// 去掉注释行
const lines = raw.split("\n").filter(l => !l.trim().startsWith("--"));
const text = lines.join("\n");
// 按分号+换行分隔语句（简单处理，本脚本 SQL 均为单行或明确以分号结尾）
const stmts = text.split(";").map(s => s.trim()).filter(s => s.length > 0);
fs.writeFileSync("/tmp/migrate_stmts.json", JSON.stringify(stmts));
console.log("共 " + stmts.length + " 条 SQL");
' "$SQL_FILE"

# 读取语句数量
TOTAL=$(/Users/kenmaster/.workbuddy/binaries/node/versions/22.22.2-2/bin/node -e 'console.log(JSON.parse(require("fs").readFileSync("/tmp/migrate_stmts.json","utf8")).length)')

echo "开始执行 $TOTAL 条 SQL..."

for i in $(seq 1 $TOTAL); do
  SQL=$($NODE -e 'const a=JSON.parse(require("fs").readFileSync("/tmp/migrate_stmts.json","utf8")); process.stdout.write(a[process.argv[1]-1])' $i)
  echo ""
  echo "== [$i/$TOTAL] $(echo "$SQL" | head -c 80)..."
  $TCB db execute -e "$ENV_ID" --sql "$SQL" --json 2>&1 | grep -E 'Error|error|InternalError|RequestId|message' | head -3
  # 判断是否失败
  RESULT=$($TCB db execute -e "$ENV_ID" --sql "$SQL" --json 2>&1)
  if echo "$RESULT" | grep -qiE 'error|InternalError|denied|failed'; then
    echo "!! 失败，重试包装 DO $$ 方式..."
    # 包装为 DO $$ 匿名块重试
    WRAPPED="DO LANGUAGE plpgsql \$\$ BEGIN EXECUTE '$(echo "$SQL" | sed "s/'/''/g")'; END \$\$"
    $TCB db execute -e "$ENV_ID" --sql "$WRAPPED" --json 2>&1 | head -5
  fi
done

echo ""
echo "=== 全部完成 ==="
