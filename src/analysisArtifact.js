// 代码驱动分析的产物读取与契约校验（ANALYSIS_CODE 阶段，门禁 ANALYSIS-002）。
//
// 平台不实现任何分析方法：归因、结构、量价拆解……都由大模型生成 Python 代码，
// 在沙箱里作用于已锁定的结果快照完成。本文件只负责三件事——定位产物、读出内容、
// 按契约校验——然后把结论（含可执行的修正意见）回传给模型，由它决定改代码重跑
// 还是说明能力缺口，平台绝不替它猜一个答案。
//
// 与 analysisContract.js 的分工：
//   - analysisContract.js 是纯契约与纯函数校验，不碰 I/O，可独立测试；
//   - 本文件负责 I/O（定位产物、读文本、解析 JSON），校验仍委托给契约模块。

import {
  ANALYSIS_RESULT_FILE,
  summarizeAnalysisResult,
  validateAnalysisResult,
} from './analysisContract.js';

// 失败也返回完整形状，调用方无需区分字段是否缺失。
function fail(code, message) {
  return {
    file: ANALYSIS_RESULT_FILE,
    valid: false,
    issues: [{ code, level: 'error', message }],
    claims: [],
    summary: '',
  };
}

// 沙箱一轮可能产生多个输出文件，只认契约约定名字的那一个。
function findAnalysisOutput(outputs) {
  return (outputs ?? []).find((output) => (
    String(output?.fileName ?? '').toLowerCase() === ANALYSIS_RESULT_FILE
  )) ?? null;
}

function readArtifactText(workspace, artifactId) {
  if (!workspace?.getArtifact || !artifactId) {
    return null;
  }
  let artifact = null;
  try {
    artifact = workspace.getArtifact({ artifactId });
  } catch {
    return null;
  }
  const content = artifact?.payload?.content ?? artifact?.content ?? null;
  return content === null || content === undefined ? null : String(content);
}

async function readArtifactTextAsync(workspace, artifactId) {
  if (!workspace || !artifactId) return null;
  try {
    const artifact = workspace.getArtifactAsync
      ? await workspace.getArtifactAsync({ artifactId })
      : workspace.getArtifact({ artifactId });
    const content = artifact?.payload?.content ?? artifact?.content ?? null;
    return content === null || content === undefined ? null : String(content);
  } catch {
    return null;
  }
}

// outputs 里没有契约产物时返回 null：表示"本轮没有可校验的分析结果"，
// 与"有产物但校验不通过"是两回事，调用方据此区分是否要告警。
export function validateAnalysisOutputs({ workspace, outputs }) {
  const target = findAnalysisOutput(outputs);
  if (!target) {
    return null;
  }
  const content = readArtifactText(workspace, target.artifactId);
  if (!content) {
    return fail(
      'ANALYSIS-UNREADABLE',
      `无法读取 ${ANALYSIS_RESULT_FILE} 内容，无法完成契约校验。`,
    );
  }
  let payload = null;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    return fail(
      'ANALYSIS-INVALID-JSON',
      `${ANALYSIS_RESULT_FILE} 不是合法 JSON：${error.message}`,
    );
  }
  const validation = validateAnalysisResult(payload);
  return {
    file: ANALYSIS_RESULT_FILE,
    valid: validation.valid,
    issues: validation.issues,
    claims: validation.claims,
    summary: validation.valid ? summarizeAnalysisResult(validation) : '',
  };
}

export async function validateAnalysisOutputsAsync({ workspace, outputs }) {
  const target = findAnalysisOutput(outputs);
  if (!target) return null;
  const content = await readArtifactTextAsync(workspace, target.artifactId);
  if (!content) return fail('ANALYSIS-UNREADABLE', `无法读取 ${ANALYSIS_RESULT_FILE} 内容，无法完成契约校验。`);
  let payload;
  try {
    payload = JSON.parse(content);
  } catch (error) {
    return fail('ANALYSIS-INVALID-JSON', `${ANALYSIS_RESULT_FILE} 不是合法 JSON：${error.message}`);
  }
  const validation = validateAnalysisResult(payload);
  return { file: ANALYSIS_RESULT_FILE, valid: validation.valid, issues: validation.issues, claims: validation.claims, summary: validation.valid ? summarizeAnalysisResult(validation) : '' };
}
