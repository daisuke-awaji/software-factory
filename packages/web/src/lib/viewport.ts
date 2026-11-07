// 画面に見えている範囲（visual viewport）に、アプリの枠を合わせる。
// iOS Safari はキーボードを出しても画面の高さを変えず、ページ全体を持ち上げる（interactive-widget も効かない）。
// そのままだとヘッダーが上に隠れ、キーボードを閉じた後も下に空白が残るので、
// 見えている範囲の高さと位置を CSS 変数（--app-h / --app-top）に入れ、枠をそこに置く。

const KEYBOARD_MIN = 120;

export function trackVisualViewport(root: HTMLElement = document.documentElement): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;
  let frame = 0;
  const apply = () => {
    frame = 0;
    // ピンチで拡大しているときは、枠を合わせない（拡大の中で枠が縮んでしまう）
    if (Math.abs(vv.scale - 1) > 0.01) {
      root.style.removeProperty('--app-h');
      root.style.removeProperty('--app-top');
      delete root.dataset['keyboard'];
      return;
    }
    root.style.setProperty('--app-h', `${Math.round(vv.height)}px`);
    root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`);
    if (window.innerHeight - vv.height > KEYBOARD_MIN) root.dataset['keyboard'] = '';
    else delete root.dataset['keyboard'];
    // 文書は動かさない（iOS が持ち上げた分を戻す）
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  apply();
  vv.addEventListener('resize', schedule);
  vv.addEventListener('scroll', schedule);
  window.addEventListener('scroll', schedule, { passive: true });
  return () => {
    cancelAnimationFrame(frame);
    vv.removeEventListener('resize', schedule);
    vv.removeEventListener('scroll', schedule);
    window.removeEventListener('scroll', schedule);
  };
}
