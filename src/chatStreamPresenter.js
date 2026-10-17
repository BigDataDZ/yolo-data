const STAGE_RUNNING_TEXT = {
  INTENT: '正在理解问题，识别业务目标与上下文',
  SKILL_AUDIT: '正在按 Skill 检查数据含义、粒度与来源',
  SEMANTIC_RESOLVE: '正在拆解指标、维度、时间和筛选条件',
  SEMANTIC_DISCOVERY: '正在检索最匹配的指标与业务数据集',
  SEMANTIC_CONFIRM: '正在确认口径与字段映射',
  PLAN: '正在生成受控查询计划',
  VALIDATE: '正在校验字段、权限与查询边界',
  EXECUTE: '正在执行只读查询，数据量较大时可能需要稍等',
  RESULT_ANALYST: '结果已返回，正在计算合计、趋势与异常',
  ANALYSIS_CODE: '正在用沙箱代码分析已锁定的数据',
  RESULT_VALIDATION: '正在验证结果一致性与回答证据',
  ANALYZE: '正在提炼关键发现并选择展示方式',
  RESPOND: '正在组织最终回答',
  REFLECT: '正在进行最后一轮质量检查',
};

function normalizedStatus(status) {
  const value = String(status ?? '').toUpperCase();
  if (value === 'RUNNING') {
    return 'running';
  }
  if (value === 'FAILED' || value === 'ERROR') {
    return 'error';
  }
  if (value === 'SUCCESS' || value === 'COMPLETED') {
    return 'done';
  }
  return 'pending';
}

function stageProgress(stage) {
  if (!stage?.code) {
    return null;
  }
  const status = normalizedStatus(stage.status);
  if (status === 'pending') {
    return null;
  }
  const runningText = STAGE_RUNNING_TEXT[stage.code] ?? `正在${stage.name ?? '处理当前步骤'}`;
  const text = status === 'running'
    ? runningText
    : status === 'done'
      ? `已完成${stage.name ?? '当前步骤'}`
      : `${stage.name ?? '当前步骤'}未完成`;
  return {
    type: 'assistant_progress',
    id: `stage-${stage.code}`,
    stageCode: stage.code,
    status,
    text,
    detail: String(stage.summary || stage.detail || '').trim(),
  };
}

function processStepProgress(step) {
  if (!step?.id) {
    return null;
  }
  const status = normalizedStatus(step.status);
  if (status === 'pending') {
    return null;
  }
  return {
    type: 'assistant_progress',
    id: `step-${step.id}`,
    stageCode: step.stageCode ?? null,
    status,
    text: String(step.title || step.name || '执行工具步骤'),
    detail: String(step.detail || '').trim(),
  };
}

export function createChatStreamPresenter() {
  return function present(event) {
    if (!event?.type) {
      return [];
    }
    if (event.type === 'run_started') {
      return [{
        type: 'assistant_progress',
        id: 'stage-INTENT',
        stageCode: 'INTENT',
        status: 'running',
        text: STAGE_RUNNING_TEXT.INTENT,
        detail: '先确认你要查的业务范围，再开始检索和执行',
      }];
    }
    if (event.type === 'workflow_stage') {
      const progress = stageProgress(event.stage);
      return progress ? [progress] : [];
    }
    if (event.type === 'process_step') {
      const progress = processStepProgress(event.step);
      return progress ? [progress] : [];
    }
    if (event.type === 'error') {
      return [{
        type: 'assistant_progress',
        id: 'run-error',
        status: 'error',
        text: '本轮执行遇到问题',
        detail: String(event.message ?? '').trim(),
      }];
    }
    return [];
  };
}

export function assistantTextChunks(message, { targetChunks = 120, minChunkSize = 12 } = {}) {
  const characters = Array.from(String(message ?? ''));
  if (characters.length === 0) {
    return [];
  }
  const count = Math.max(1, Math.min(targetChunks, characters.length));
  const size = Math.max(minChunkSize, Math.ceil(characters.length / count));
  const chunks = [];
  for (let index = 0; index < characters.length; index += size) {
    chunks.push(characters.slice(index, index + size).join(''));
  }
  return chunks;
}
