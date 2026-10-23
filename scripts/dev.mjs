import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadConfig } from '../src/config.js';

// 端口/监听地址以配置面为准（yolo-conf.yaml + 环境变量），不再假设默认值。
const config = loadConfig();
const port = config.port;
const host = config.host;
const projectRoot = path.resolve(config.projectRoot);
const serverEntry = path.resolve(projectRoot, 'src', 'server.js');
const execFileAsync = promisify(execFile);

async function inspectExistingService() {
  try {
    const response = await fetch(`http://${host}:${port}/api/health`, {
      signal: AbortSignal.timeout(1200),
    });
    if (!response.ok) return { running: false, occupied: true };
    const body = await response.json();
    return { running: body?.status === 'ok', occupied: true };
  } catch {
    return { running: false, occupied: false };
  }
}

async function findPortOwners() {
  if (process.platform === 'win32') {
    const script = [
      `$port = ${Number(port)}`,
      '$owners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique)',
      'foreach ($owner in $owners) {',
      '  $proc = Get-CimInstance Win32_Process -Filter "ProcessId = $owner" -ErrorAction SilentlyContinue',
      '  if ($proc) { Write-Output (ConvertTo-Json -InputObject @{ pid = [int]$owner; commandLine = [string]$proc.CommandLine; processName = [string]$proc.Name } -Compress) }',
      '}',
    ].join('; ');
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 });
    const output = stdout.trim().replace(/^\uFEFF/, '');
    if (!output) return [];
    return (output.startsWith('[') ? JSON.parse(output) : [JSON.parse(output)]);
  }

  const { stdout } = await execFileAsync('lsof', [
    '-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN',
  ], { maxBuffer: 1024 * 1024 }).catch((error) => {
    if (error.code === 1) return { stdout: '' };
    throw error;
  });
  const pids = [...new Set(stdout.split(/\s+/).filter(Boolean))];
  const owners = [];
  for (const pid of pids) {
    const { stdout: commandLine } = await execFileAsync('ps', ['-p', pid, '-o', 'args=']);
    owners.push({ pid: Number(pid), commandLine: commandLine.trim() });
  }
  return owners;
}

function isProjectServer(owner) {
  const commandLine = String(owner.commandLine ?? '').replaceAll('\\', '/');
  const normalizedEntry = serverEntry.replaceAll('\\', '/');
  return String(owner.projectRoot ?? '').replaceAll('\\', '/').toLowerCase()
    === projectRoot.replaceAll('\\', '/').toLowerCase()
    || (String(owner.processName ?? '').toLowerCase() === 'node.exe'
      && /(?:^|\s)src\/server\.js(?:\s|$)/i.test(commandLine))
    || commandLine.includes(normalizedEntry)
    || (commandLine.includes('src/server.js')
      && commandLine.toLowerCase().includes(projectRoot.replaceAll('\\', '/').toLowerCase()));
}

async function stopProjectServers(owners) {
  const ownServers = owners.filter(isProjectServer);
  const unrelated = owners.filter((owner) => !isProjectServer(owner));
  if (unrelated.length > 0) {
    throw new Error(`端口 ${port} 被非本项目进程占用（PID ${unrelated.map((owner) => owner.pid).join(', ')}），为安全起见不终止。`);
  }
  if (ownServers.length === 0) return;
  console.log(`正在停止本项目占用端口 ${port} 的服务（PID ${ownServers.map((owner) => owner.pid).join(', ')}）……`);
  for (const owner of ownServers) {
    if (process.platform === 'win32') {
      await execFileAsync('taskkill.exe', ['/PID', String(owner.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(owner.pid, 'SIGTERM');
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const remaining = await findPortOwners();
    if (remaining.length === 0) return;
    if (remaining.some((owner) => !isProjectServer(owner))) {
      throw new Error(`端口 ${port} 在停止旧服务后仍被其他进程占用。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待本项目旧服务释放端口 ${port} 超时。`);
}

try {
  const owners = await findPortOwners();
  if (owners.length > 0) {
    await stopProjectServers(owners);
  } else {
    const existingService = await inspectExistingService();
    if (existingService.occupied) {
      throw new Error(`端口 ${port} 已被占用，但无法确认所属进程。为安全起见未终止，请设置 PORT 使用其他端口。`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const child = spawn(process.execPath, ['--watch', serverEntry], {
  stdio: 'inherit',
  env: { ...process.env, YOLO_DATA_PROJECT_ROOT: projectRoot },
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
