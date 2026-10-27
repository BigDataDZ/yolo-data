// Artifact I/O is separate from shared analysis contract validation.
export function readArtifactText(workspace, artifactId) {
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

export async function readArtifactTextAsync(workspace, artifactId) {
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

