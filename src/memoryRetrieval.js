export async function resolveMemoryPreInject({
  config,
  userMemories,
  userId,
  themeId,
  question,
} = {}) {
  const cfg = config?.userMemory?.retrieval?.preInject;
  if (!cfg || !cfg.enabled || !userMemories) {
    return null;
  }
  const q = String(question ?? '').trim();
  if (!q) {
    return null;
  }
  const hits = await userMemories.searchAsync(userId, themeId, q, cfg.topN);
  if (!hits || hits.length === 0) {
    return null;
  }
  const maxChars = Number(cfg.maxChars) || 1200;
  const blocks = [];
  let total = 0;
  for (const hit of hits) {
    const line = `[${hit.scopeLabel}] ${String(hit.excerpt ?? '').trim()}`;
    if (!line.trim() || total + line.length > maxChars) {
      break;
    }
    blocks.push(line);
    total += line.length;
  }
  return blocks.length > 0 ? blocks.join('\n\n') : null;
}

export function resolveSupersonicEnabled(service) {
  const stored = service?.database?.getPlatformSetting?.('supersonic.enabled', true);
  return service?.getSupersonicEnabled?.() ?? Boolean(stored?.value ?? stored);
}
