// ダウンロード: presigned URL を fetch して Blob にしてから保存する（モックでは MSW が応答するため、<a href> の遷移を使わない）
export async function saveFromUrl(url: string, fileName: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('ダウンロードに失敗しました');
  const blob = await res.blob();
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
