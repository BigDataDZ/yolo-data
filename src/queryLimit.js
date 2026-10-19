export function resolveQueryLimit(question) {
  const rankMatch = String(question ?? '').match(
    /(?:top\s*(\d+)|前\s*(\d+)|返回\s*(\d+)\s*行)/i,
  );
  const requested = Number(rankMatch?.[1] ?? rankMatch?.[2] ?? rankMatch?.[3]);
  return Number.isFinite(requested) && requested > 0
    ? Math.max(1, Math.min(requested, 2000))
    : 200;
}
