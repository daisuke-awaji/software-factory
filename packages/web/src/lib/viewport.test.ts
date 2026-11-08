import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackVisualViewport } from './viewport';

class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;
}

describe('trackVisualViewport', () => {
  afterEach(() => vi.unstubAllGlobals());

  const setup = () => {
    const vv = new FakeViewport();
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    const root = document.createElement('div');
    const stop = trackVisualViewport(root);
    return { vv, root, stop };
  };

  it('見えている範囲の高さと位置を CSS 変数に入れる', () => {
    const { root, stop } = setup();
    expect(root.style.getPropertyValue('--app-h')).toBe('800px');
    expect(root.style.getPropertyValue('--app-top')).toBe('0px');
    expect(root.dataset['keyboard']).toBeUndefined();
    stop();
  });

  it('キーボードで縮んだら、高さを合わせて data-keyboard を付ける', () => {
    const { vv, root, stop } = setup();
    vv.height = 460;
    vv.offsetTop = 120;
    vv.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--app-h')).toBe('460px');
    expect(root.style.getPropertyValue('--app-top')).toBe('120px');
    expect(root.dataset['keyboard']).toBe('');
    vv.height = 800;
    vv.offsetTop = 0;
    vv.dispatchEvent(new Event('resize'));
    expect(root.dataset['keyboard']).toBeUndefined();
    stop();
  });

  it('ピンチで拡大しているときは、枠を合わせない', () => {
    const { vv, root, stop } = setup();
    vv.scale = 2;
    vv.height = 400;
    vv.dispatchEvent(new Event('resize'));
    expect(root.style.getPropertyValue('--app-h')).toBe('');
    stop();
  });
});
