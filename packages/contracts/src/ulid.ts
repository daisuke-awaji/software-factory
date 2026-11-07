// ULID の生成と、時刻の取り出し（依存を増やさないため自前で持つ）
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

let lastTime = -1;
let lastRandom: number[] = [];

/** 単調増加の ULID（同じミリ秒の中でも順番が保たれる） */
export function ulid(now: number = Date.now()): string {
  if (now === lastTime) {
    // 下位の桁から 1 を足す
    for (let i = lastRandom.length - 1; i >= 0; i--) {
      if (lastRandom[i]! < 31) {
        lastRandom[i]!++;
        break;
      }
      lastRandom[i] = 0;
    }
  } else {
    lastTime = now;
    lastRandom = Array.from({ length: 16 }, () => Math.floor(Math.random() * 32));
  }
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  return time + lastRandom.map((n) => ALPHABET[n]).join('');
}

/** ULID に入っている時刻（ミリ秒） */
export function ulidTime(id: string): number {
  let t = 0;
  for (const ch of id.slice(0, 10)) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return Number.NaN;
    t = t * 32 + v;
  }
  return t;
}
