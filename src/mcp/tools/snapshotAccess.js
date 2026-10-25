import { callPlatformDatabase } from '../../platformDatabaseAccess.js';
import { assertTenantScope, MCP_ERROR, fail } from './shared.js';

export async function buildAuthorizedSnapshot(ctx, artifact, userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw fail(MCP_ERROR.FORBIDDEN, '无权限访问此产物');
  }
  const workspace = await callPlatformDatabase(ctx.database, 'getWorkspaceAsync', 'getWorkspace', artifact.workspaceId, userId);
  if (!workspace || workspace.themeId == null) throw fail(MCP_ERROR.FORBIDDEN, '无权限访问此产物');
  assertTenantScope(ctx, workspace.themeId);
  let resolved;
  try {
    resolved = ctx.agent.resolveContextAsync
      ? await ctx.agent.resolveContextAsync(userId, workspace.themeId)
      : ctx.agent.resolveContext(userId, workspace.themeId);
  } catch {
    throw fail(MCP_ERROR.FORBIDDEN, '无权限访问此产物');
  }
  if (!resolved?.scope || resolved.scope.allowed === false) throw fail(MCP_ERROR.FORBIDDEN, '无权限访问此产物');
  return trimArtifact(artifact);
}

function trimArtifact(artifact) {
  const out = {
    id: artifact.id,
    kind: artifact.kind ?? artifact.type,
    title: artifact.title ?? artifact.subject ?? null,
    createdAt: artifact.createdAt ?? null,
  };
  const payload = artifact.payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.columns)) out.columns = payload.columns.slice(0, 50);
    if (Array.isArray(payload.rows)) {
      out.rowCount = payload.rows.length;
      out.previewRows = payload.rows.slice(0, 20);
    }
    if (typeof payload.text === 'string') out.textExcerpt = payload.text.slice(0, 1000);
  }
  return out;
}
