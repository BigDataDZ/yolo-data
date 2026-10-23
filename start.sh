#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "YOLO Data Linux 启动向导"
echo "项目目录：$PROJECT_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js >= 22.5 和 npm。" >&2
  exit 1
fi
if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=5)?0:1)'; then
  echo "Node.js 版本过低：$(node --version)，需要 >= 22.5。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请修复 Node.js/npm 安装或 PATH 后重试。" >&2
  exit 1
fi

node_ready=false
node -e "Promise.all([import('@modelcontextprotocol/sdk'),import('mysql2/promise'),import('knex'),import('yaml'),import('zod')]).catch(()=>process.exit(1))" \
  >/dev/null 2>&1 && node_ready=true
python_ready=false
venv_python="$PROJECT_ROOT/.venv/bin/python"
if [[ -x "$venv_python" ]] && "$venv_python" -c 'import pandas, openpyxl' >/dev/null 2>&1; then
  python_ready=true
fi

if [[ "$node_ready" != true || "$python_ready" != true ]]; then
  echo "首次启动或检测到依赖缺失，需要初始化运行环境。"
  read -r -p "npm registry（回车沿用当前配置，输入 m 使用 npmmirror）： " npm_choice
  if [[ "$npm_choice" == "m" || "$npm_choice" == "M" ]]; then
    export npm_config_registry="https://registry.npmmirror.com"
  fi
  read -r -p "Python 包源（回车沿用当前配置，输入 a 使用阿里云镜像）： " pip_choice
  if [[ "$pip_choice" == "a" || "$pip_choice" == "A" ]]; then
    export PIP_INDEX_URL="https://mirrors.aliyun.com/pypi/simple/"
  fi
  npm run setup
else
  echo "运行依赖已就绪，跳过安装。"
fi

echo "正在启动……"
npm run dev
