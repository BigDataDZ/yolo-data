export function extensionOf(name) {
  const match = String(name ?? '').match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : '';
}

export function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('本地文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function describeUpload(result) {
  if (!result?.table) {
    const note = result?.warnings?.[0] ? ` · ${result.warnings[0]}` : ' · 已保存';
    return `${result.file.name}${note}`;
  }
  const sheet = result.table.sheetName ? `工作表「${result.table.sheetName}」· ` : '';
  return `${result.file.name} · ${sheet}${result.table.rowCount} 行 / ${result.table.columnCount} 列`;
}

