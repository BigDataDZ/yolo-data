import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readPythonBin } from './confFileEdit.mjs';

const VENV_DIRECTORY = '.venv';
const REQUIREMENTS_FILE = 'requirements.txt';
const STAMP_FILE = '.yolo-analysis-requirements';

function canRunPython(bin, args = ['-c', 'print(1)']) {
  if (!bin) {
    return false;
  }
  const result = spawnSync(bin, args, { encoding: 'utf8', stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function venvPythonPath(projectRoot) {
  return process.platform === 'win32'
    ? path.join(projectRoot, VENV_DIRECTORY, 'Scripts', 'python.exe')
    : path.join(projectRoot, VENV_DIRECTORY, 'bin', 'python');
}

function resolveBasePython(confPath) {
  const configured = process.env.PYTHON_BIN || readPythonBin(confPath);
  const candidates = [
    configured,
    process.platform === 'win32' ? 'python' : 'python3',
    process.platform === 'win32' ? 'py' : 'python',
  ].filter(Boolean);
  return [...new Set(candidates)].find((bin) => canRunPython(bin)) ?? null;
}

function requirementsDigest(requirementsPath) {
  return createHash('sha256').update(fs.readFileSync(requirementsPath)).digest('hex');
}

function hasAnalysisDependencies(pythonBin) {
  return canRunPython(pythonBin, ['-c', 'import pandas, openpyxl']);
}

function pythonVersion(pythonBin) {
  const result = spawnSync(
    pythonBin,
    ['-c', 'import sys; print(sys.version.split()[0])'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return result.status === 0 ? String(result.stdout ?? '').trim() || null : null;
}

function pythonMeetsMinimum(pythonBin, minimumMajor = 3, minimumMinor = 9) {
  const result = spawnSync(
    pythonBin,
    ['-c', 'import sys; print("%s.%s" % sys.version_info[:2])'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  if (result.status !== 0) return false;
  const [major, minor] = String(result.stdout ?? '').trim().split('.').map(Number);
  return major > minimumMajor || (major === minimumMajor && minor >= minimumMinor);
}

function createVenv(projectRoot, basePython, onInfo) {
  const venvPath = path.join(projectRoot, VENV_DIRECTORY);
  onInfo(`创建项目 Python 虚拟环境 ${VENV_DIRECTORY}`);
  const result = spawnSync(basePython, ['-m', 'venv', venvPath], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `无法创建 ${VENV_DIRECTORY}：${result.error?.message ?? `退出码 ${result.status}`}。`
      + ' 请确认 Python 3 已安装且包含 venv 模块。',
    );
  }
}

function installRequirements(projectRoot, pythonBin, requirementsPath, onInfo) {
  onInfo('安装 Python 分析依赖 pandas / openpyxl');
  const result = spawnSync(
    pythonBin,
    ['-m', 'pip', 'install', '--disable-pip-version-check', '--upgrade', '-r', requirementsPath],
    { cwd: projectRoot, stdio: 'inherit' },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `Python 依赖安装失败：${result.error?.message ?? `退出码 ${result.status}`}。`
      + ' 请检查网络或 Python 包镜像配置后重新运行 npm run setup。',
    );
  }
}

export function ensurePythonAnalysisRuntime({ projectRoot, confPath, onInfo = () => {} }) {
  const requirementsPath = path.join(projectRoot, REQUIREMENTS_FILE);
  if (!fs.existsSync(requirementsPath)) {
    throw new Error(`缺少 ${REQUIREMENTS_FILE}，无法初始化 Python 分析依赖。`);
  }
  const venvPath = path.join(projectRoot, VENV_DIRECTORY);
  const pythonBin = venvPythonPath(projectRoot);
  if (!canRunPython(pythonBin)) {
    const basePython = resolveBasePython(confPath);
    if (!basePython) {
      throw new Error(
        '未找到可用的 Python 3 解释器。Python 分析能力为完整安装必选项，'
        + '请先安装 Python 3，再重新运行 npm run setup。',
      );
    }
    createVenv(projectRoot, basePython, onInfo);
    if (!canRunPython(pythonBin)) {
      throw new Error(`虚拟环境已创建，但无法运行 ${pythonBin}。`);
    }
  }

  if (!pythonMeetsMinimum(pythonBin)) {
    throw new Error(
      `当前项目虚拟环境使用 Python ${pythonVersion(pythonBin) ?? '未知版本'}，`
      + 'pandas 2.3.2 要求 Python >= 3.9。请先将现有 .venv 移走，'
      + '再用 PYTHON_BIN=/usr/local/python3.11/bin/python3.11 npm run setup 重建。',
    );
  }

  const digest = requirementsDigest(requirementsPath);
  const stampPath = path.join(venvPath, STAMP_FILE);
  const installedDigest = fs.existsSync(stampPath)
    ? fs.readFileSync(stampPath, 'utf8').trim()
    : null;
  const dependenciesReady = hasAnalysisDependencies(pythonBin);
  if (!dependenciesReady || installedDigest !== digest) {
    installRequirements(projectRoot, pythonBin, requirementsPath, onInfo);
    fs.writeFileSync(stampPath, `${digest}\n`, 'utf8');
  }
  if (!hasAnalysisDependencies(pythonBin)) {
    throw new Error('pandas / openpyxl 安装后仍无法导入，请检查虚拟环境。');
  }
  return {
    pythonBin,
    version: pythonVersion(pythonBin),
    installed: !dependenciesReady || installedDigest !== digest,
  };
}
