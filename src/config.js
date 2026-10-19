import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAuthMode } from './auth.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Python 沙箱解释器的兜底候选。Windows 装的是 `python`，macOS/Linux 上是 `python3`；
// 必须和 .env.example 的 `PYTHON_BIN=python3` 及 scripts/setup.mjs 探测顺序一致，避免缺少别名时失败。
export const DEFAULT_PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';

function readInt(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function parsePathList(value, fallback = []) {
  const items = String(value ?? '')
    .split(new RegExp(`[${path.delimiter},;]+`))
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set(items.length > 0 ? items : fallback)];
}

export function loadConfig(env = process.env) {
  const envFilePath = path.resolve(projectRoot, '.env');
  if (env === process.env && fs.existsSync(envFilePath)) {
    const existing = { ...process.env };
    process.loadEnvFile(envFilePath);
    Object.assign(process.env, existing);
  }
  const nodeEnv = String(env.NODE_ENV ?? '').trim().toLowerCase();
  const authMode = resolveAuthMode({ authMode: env.AUTH_MODE ?? '', nodeEnv });
  const host = String(env.HOST ?? '').trim() || (authMode === 'dev' ? '127.0.0.1' : '0.0.0.0');
  const dbPath = String(env.PLATFORM_DB_PATH ?? './data/platform.db').trim();
  const skillDirectories = parsePathList(
    env.AGENT_SKILL_DIRECTORIES,
    [
      path.join(projectRoot, 'skills'),
      path.join(os.homedir(), '.codex', 'skills'),
    ],
  ).map((directory) => {
    const expanded = directory === '~' || directory.startsWith('~/') || directory.startsWith('~\\')
      ? path.join(os.homedir(), directory.slice(1))
      : directory;
    return path.isAbsolute(expanded)
      ? expanded
      : path.resolve(projectRoot, expanded);
  });

  return {
    projectRoot,
    port: readInt(env.PORT, 8088),
    host,
    dbPath: path.isAbsolute(dbPath) ? dbPath : path.resolve(projectRoot, dbPath),
    supersonic: {
      baseUrl: normalizeBaseUrl(env.SUPERSONIC_BASE_URL),
      token: String(env.SUPERSONIC_TOKEN ?? '').trim(),
      appKey: String(env.SUPERSONIC_APP_KEY ?? '').trim(),
      serviceClientId: String(env.SUPERSONIC_SERVICE_CLIENT_ID ?? '').trim(),
      serviceClientSecret: String(
        env.SUPERSONIC_SERVICE_CLIENT_SECRET ?? '',
      ).trim(),
      timeoutMs: readInt(env.SUPERSONIC_TIMEOUT_MS, 30_000),
    },
    deepseek: {
      // 通用环境变量优先；保留旧变量作为兼容回退。
      baseUrl: normalizeBaseUrl(env.API_BASE_URL || env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'),
      apiKey: String(env.API_KEY ?? env.DEEPSEEK_API_KEY ?? '').trim(),
      model: String(env.MODEL || env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
      temperature: Number.isFinite(Number(env.TEMPERATURE ?? env.DEEPSEEK_TEMPERATURE))
        ? Number(env.TEMPERATURE ?? env.DEEPSEEK_TEMPERATURE)
        : 0,
      maxTokens: readInt(env.MAX_TOKENS ?? env.DEEPSEEK_MAX_TOKENS, 0),
      timeoutMs: readInt(env.TIMEOUT_MS ?? env.DEEPSEEK_TIMEOUT_MS, 180_000),
      maxToolRounds: readInt(env.MAX_TOOL_ROUNDS ?? env.DEEPSEEK_MAX_TOOL_ROUNDS, 12),
    },
    chatMemoryMessageLimit: readInt(env.CHAT_MEMORY_MESSAGE_LIMIT, 20),
    // 长期记忆的自动整理：攒够多少条笔记自动合并、正文到预算多少比例自动压缩、
    // 后台巡检间隔（0 表示关闭巡检，只保留每轮问答后的顺带整理）。
    userMemory: {
      autoConsolidateAt: Math.max(1, readInt(env.USER_MEMORY_AUTO_CONSOLIDATE_AT, 8)),
      compactRatio: Math.min(1, Math.max(0.2, Number(env.USER_MEMORY_COMPACT_RATIO ?? 0.8) || 0.8)),
      maintenanceIntervalMs: Math.max(0, readInt(env.USER_MEMORY_MAINTENANCE_INTERVAL_MS, 900_000)),
      maintenanceStartupDelayMs: Math.max(0, readInt(env.USER_MEMORY_MAINTENANCE_STARTUP_DELAY_MS, 60_000)),
      maintenanceBatchSize: Math.max(1, readInt(env.USER_MEMORY_MAINTENANCE_BATCH_SIZE, 20)),
      // 问数前置注入：用当前问题确定性检索用户长期记忆，把命中片段直接注入上下文，
      // 替代「只注入摘要 + 依赖模型主动调 search_user_memory 工具」的弱召回，确保记忆对提问真正生效。
      // 检索走 userMemory.search 的精确/关键词匹配，不引入向量近似，守住平台确定性命根。
      retrieval: {
        preInject: {
          enabled: (env.USER_MEMORY_PREINJECT_ENABLED ?? 'true') !== 'false',
          topN: Math.max(1, readInt(env.USER_MEMORY_PREINJECT_TOPN, 6)),
          maxChars: Math.max(200, readInt(env.USER_MEMORY_PREINJECT_MAXCHARS, 1200)),
        },
      },
    },
    reflection: {
      enabled: (env.REFLECTION_ENABLED ?? 'true') !== 'false',
      maxReplan: Math.max(0, Math.min(3, readInt(env.REFLECTION_MAX_REPLAN, 2))),
      judgeTimeoutMs: Math.max(1_000, readInt(env.REFLECTION_JUDGE_TIMEOUT_MS, 20_000)),
    },
    codeExecutionRoot: path.resolve(
      projectRoot,
      String(env.CODE_EXECUTION_ROOT ?? './data/code-runs').trim(),
    ),
    pythonBin: String(env.PYTHON_BIN ?? '').trim() || DEFAULT_PYTHON_BIN,
    uploads: {
      maxBytes: Math.max(1, readInt(env.UPLOAD_MAX_BYTES, 8 * 1024 * 1024)),
      maxFilesPerSession: Math.max(1, readInt(env.UPLOAD_MAX_FILES_PER_SESSION, 20)),
      maxTotalBytesPerSession: Math.max(1, readInt(
        env.UPLOAD_MAX_TOTAL_BYTES_PER_SESSION,
        40 * 1024 * 1024,
      )),
      maxTableRows: Math.max(1, readInt(env.UPLOAD_MAX_TABLE_ROWS, 50_000)),
      allowedExtensions: parsePathList(
        env.UPLOAD_ALLOWED_EXTENSIONS,
        ['csv', 'xls', 'xlsx'],
      ),
    },
    nodeEnv,
    authMode,
    sessionTtlHours: Math.max(1, readInt(env.SESSION_TTL_HOURS, 12)),
    secureCookies: String(env.SESSION_COOKIE_SECURE ?? '').toLowerCase() === 'true'
      || nodeEnv === 'production',
    skillDirectories,
    datasourceSecretKey: String(env.DATASOURCE_SECRET_KEY ?? '').trim(),
    datasourceSecretKeyPath: path.resolve(projectRoot, 'data', '.datasource-key'),
    bootstrapDatasource: {
      enabled: String(env.DORIS_BOOTSTRAP_ENABLED ?? '').toLowerCase() === 'true',
      host: String(env.DORIS_BOOTSTRAP_HOST ?? '').trim(),
      port: readInt(env.DORIS_BOOTSTRAP_PORT, 9030),
      username: String(env.DORIS_BOOTSTRAP_USER ?? '').trim(),
      password: String(env.DORIS_BOOTSTRAP_PASSWORD ?? ''),
      database: String(env.DORIS_BOOTSTRAP_DATABASE ?? '').trim(),
      salesTable: String(env.DORIS_BOOTSTRAP_SALES_TABLE ?? '').trim(),
      goodsTable: String(env.DORIS_BOOTSTRAP_GOODS_TABLE ?? '').trim(),
    },
  };
}

export { projectRoot };
