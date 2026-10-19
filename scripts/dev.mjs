import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8088);
const host = process.env.HOST || '127.0.0.1';

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

const existingService = await inspectExistingService();
if (existingService.running) {
  console.log(`YOLO Data 已在 http://${host}:${port} 运行，本次不重复启动。`);
  console.log('如需重启，请先停止占用该端口的 node 进程，或设置 PORT 使用其他端口。');
  process.exit(0);
}
if (existingService.occupied) {
  console.error(`端口 ${port} 已被占用，但 /api/health 无法确认是 YOLO Data。请设置 PORT 使用其他端口。`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--watch', 'src/server.js'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
