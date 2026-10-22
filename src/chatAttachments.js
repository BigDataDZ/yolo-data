// 提问附件：把用户在输入框上方选择的本地文件绑定到当轮用户提问。
// 只做归属校验、提问绑定和展示投影，不包含任何业务口径判断。

// 单轮提问最多携带的附件数，防止一次请求把整个会话的产物都挂上来。
const MAX_ATTACHMENTS_PER_QUESTION = 20;

// 只接受当前用户、当前会话下、状态正常的 FILE 产物；其余一律忽略而不是报错。
function attachmentIds(artifactIds) {
  return [...new Set((artifactIds ?? []).map((item) => String(item ?? '').trim()).filter(Boolean))]
    .slice(0, MAX_ATTACHMENTS_PER_QUESTION);
}

function projectAttachment(artifact, sessionId) {
  if (!artifact || artifact.artifactType !== 'FILE' || Number(artifact.sessionId) !== Number(sessionId)) return null;
  const source = artifact.metadata?.source ?? {};
  return { artifactId: artifact.id, artifactType: artifact.artifactType, title: artifact.title, name: source.name ?? artifact.title, extension: source.extension ?? null, size: source.size ?? null, sha256: source.sha256 ?? null };
}

function resolveQuestionAttachments({ workspace, userId, sessionId, artifactIds }) {
  const ids = attachmentIds(artifactIds);
  if (ids.length === 0 || !workspace) return [];
  return ids.flatMap((artifactId) => {
    try { return projectAttachment(workspace.getArtifact({ artifactId, userId }), sessionId) ?? []; }
    catch { return []; }
  });
}

async function resolveQuestionAttachmentsAsync({ workspace, userId, sessionId, artifactIds }) {
  const ids = attachmentIds(artifactIds);
  if (ids.length === 0 || !workspace) {
    return [];
  }
  const session = Number(sessionId);
  const attachments = [];
  for (const artifactId of ids) {
    let artifact = null;
    try {
      artifact = workspace.getArtifactAsync
        ? await workspace.getArtifactAsync({ artifactId, userId })
        : workspace.getArtifact({ artifactId, userId });
    } catch {
      continue;
    }
    const projected = projectAttachment(artifact, session);
    if (projected) attachments.push(projected);
  }
  return attachments;
}

// 落库用户提问并绑定附件：一次调用同时完成 appendUserMessage 和 message 绑定，
// 使「这一问引用了哪些文件」可被追溯，并在提问气泡中展示。
export function appendUserQuestionWithAttachments({
  memory,
  workspace,
  session,
  user,
  question,
  displayQuestion = '',
  artifactIds = [],
}) {
  const attachments = resolveQuestionAttachments({
    workspace,
    userId: user.id,
    sessionId: session.id,
    artifactIds,
  });
  const message = memory.appendUserMessage(
    session.id,
    user.id,
    String(displayQuestion ?? '').trim() || question,
    {
      attachments,
      question,
    },
  );
  if (attachments.length > 0 && workspace) {
    const input = {
      artifactIds: attachments.map((item) => item.artifactId),
      userId: user.id,
      messageId: message.id,
    };
    if (workspace.bindArtifactsToMessage) workspace.bindArtifactsToMessage(input);
  }
  return { message, attachments };
}

export async function appendUserQuestionWithAttachmentsAsync(args) {
  const attachments = await resolveQuestionAttachmentsAsync({ workspace: args.workspace, userId: args.user.id, sessionId: args.session.id, artifactIds: args.artifactIds });
  const message = args.memory.appendUserMessage(args.session.id, args.user.id, String(args.displayQuestion ?? '').trim() || args.question, { attachments, question: args.question });
  if (attachments.length > 0 && args.workspace) {
    const input = { artifactIds: attachments.map((item) => item.artifactId), userId: args.user.id, messageId: message.id };
    if (args.workspace.bindArtifactsToMessageAsync) await args.workspace.bindArtifactsToMessageAsync(input);
    else if (args.workspace.bindArtifactsToMessage) args.workspace.bindArtifactsToMessage(input);
  }
  return { message, attachments };
}

export { resolveQuestionAttachments, resolveQuestionAttachmentsAsync, MAX_ATTACHMENTS_PER_QUESTION };
