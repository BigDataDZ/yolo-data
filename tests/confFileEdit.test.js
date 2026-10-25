// 配置回写：npm run setup 把虚拟环境解释器路径写回 yolo-conf.yaml。
// 这里守住两件事：只动 codeExecution.pythonBin 一行（注释与顺序原样保留），
// 且 Windows 反斜杠路径写入后能被读回同一值。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readPythonBin, writePythonBin, resolveConfPath } from '../scripts/confFileEdit.mjs';

function withTempConf(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-conf-'));
  const confPath = path.join(dir, 'yolo-conf.yaml');
  fs.writeFileSync(confPath, text, 'utf8');
  return { dir, confPath };
}

const SAMPLE = [
  'server:',
  '  port: 8088',
  '',
  'codeExecution:',
  '  root: ./data/code-runs',
  '  # 留空按平台自动探测',
  '  pythonBin: ""',
  '  sandbox:',
  '    backend: inprocess',
  '',
  'tokenBudget:',
  '  userDaily: 0',
  '',
].join('\n');

test('回写 pythonBin：只替换目标行，其余注释与结构原样保留', () => {
  const { dir, confPath } = withTempConf(SAMPLE);
  const value = process.platform === 'win32'
    ? 'D:\\workspace\\metric-ask-platform\\.venv\\Scripts\\python.exe'
    : '/workspace/metric-ask-platform/.venv/bin/python';
  assert.equal(writePythonBin(confPath, value), true);
  const after = fs.readFileSync(confPath, 'utf8');
  assert.match(after, /# 留空按平台自动探测/);
  assert.match(after, /^ {2}sandbox:$/m);
  assert.equal(after.split('\n').filter((line) => line.includes('pythonBin')).length, 1);
  assert.equal(readPythonBin(confPath), value);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('回写 pythonBin：不影响同名键出现在其他块中的场景', () => {
  const { dir, confPath } = withTempConf([
    'codeExecution:',
    '  pythonBin: ""',
    '',
    'other:',
    '  pythonBin: keep-me',
    '',
  ].join('\n'));
  assert.equal(writePythonBin(confPath, '/venv/bin/python'), true);
  const after = fs.readFileSync(confPath, 'utf8');
  assert.match(after, /^ {2}pythonBin: '\/venv\/bin\/python'$/m);
  assert.match(after, /^ {2}pythonBin: keep-me$/m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('回写 pythonBin：缺少该键时返回 false 而不是改写文件', () => {
  const { dir, confPath } = withTempConf(['server:', '  port: 8088', ''].join('\n'));
  assert.equal(writePythonBin(confPath, '/venv/bin/python'), false);
  assert.equal(fs.readFileSync(confPath, 'utf8'), 'server:\n  port: 8088\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('空值与缺文件时读回 null', () => {
  const { dir, confPath } = withTempConf(SAMPLE);
  assert.equal(readPythonBin(confPath), null);
  assert.equal(readPythonBin(path.join(dir, 'missing.yaml')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolveConfPath 优先 yaml，缺失时返回 null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yolo-conf-'));
  assert.equal(resolveConfPath(dir), null);
  fs.writeFileSync(path.join(dir, 'yolo-conf.yml'), 'server:\n  port: 1\n', 'utf8');
  assert.equal(resolveConfPath(dir), path.join(dir, 'yolo-conf.yml'));
  fs.writeFileSync(path.join(dir, 'yolo-conf.yaml'), 'server:\n  port: 2\n', 'utf8');
  assert.equal(resolveConfPath(dir), path.join(dir, 'yolo-conf.yaml'));
  fs.rmSync(dir, { recursive: true, force: true });
});
