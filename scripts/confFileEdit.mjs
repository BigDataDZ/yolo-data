// yolo-conf.yaml 的原地读写（零 npm 依赖，供 npm install 之前的脚本使用）。
//
// 为什么不直接用 yaml 包：scripts/setup.mjs 需要在 `npm install` 之前就能跑，
// 而重写整份 YAML 会丢掉全部注释。所以这里只做「定位 codeExecution.pythonBin 那一行」的行级替换，
// 文件其余内容（注释、顺序、其它键）原样保留。

import fs from 'node:fs';
import path from 'node:path';

export const CONF_FILE_NAMES = ['yolo-conf.yaml', 'yolo-conf.yml'];

export function resolveConfPath(projectRoot) {
  for (const name of CONF_FILE_NAMES) {
    const candidate = path.join(projectRoot, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

// 解析标量：单引号（YAML 里反斜杠是字面量，Windows 路径直接可读）/ 双引号（需反转义）/ 裸值
function parseScalar(raw) {
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  if (text.startsWith("'") && text.endsWith("'") && text.length >= 2) {
    return text.slice(1, -1).replace(/''/g, "'") || null;
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    try {
      return JSON.parse(text) || null;
    } catch {
      return text.slice(1, -1) || null;
    }
  }
  return text;
}

// 输出成 YAML 单引号标量：反斜杠不做转义，路径原样可读。
function toYamlScalar(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

// 遍历 codeExecution 块，命中回调返回 true 即停止；块内遇到非缩进行视为出块。
function scanPythonBin(lines, onMatch) {
  let inBlock = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^codeExecution:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (!inBlock) {
      continue;
    }
    if (/^\S/.test(line)) {
      break;
    }
    const match = line.match(/^(\s+)pythonBin:(.*)$/);
    if (match && onMatch({ index, indent: match[1], raw: match[2] }) === true) {
      return true;
    }
  }
  return false;
}

export function readPythonBin(confPath) {
  if (!confPath || !fs.existsSync(confPath)) {
    return null;
  }
  const lines = fs.readFileSync(confPath, 'utf8').split(/\r?\n/);
  let value = null;
  scanPythonBin(lines, ({ raw }) => {
    value = parseScalar(raw);
    return true;
  });
  return value;
}

export function writePythonBin(confPath, value) {
  if (!confPath || !fs.existsSync(confPath)) {
    return false;
  }
  const lines = fs.readFileSync(confPath, 'utf8').split(/\r?\n/);
  const written = scanPythonBin(lines, ({ index, indent }) => {
    lines[index] = `${indent}pythonBin: ${toYamlScalar(value)}`;
    return true;
  });
  if (!written) {
    return false;
  }
  fs.writeFileSync(confPath, lines.join('\n'), 'utf8');
  return true;
}
