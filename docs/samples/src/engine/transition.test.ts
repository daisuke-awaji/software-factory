import { describe, expect, it } from 'vitest';
import { Line } from '../contracts/index.js';
import { findStage, nextStage } from './transition.js';

// lines/build-verify.yaml と同じ形（Zod で既定値を埋めてから使う）
const line = Line.parse({
  name: 'build-verify', version: 3,
  stages: [
    { id: 'implement', type: 'agent', image: 'web@5', gates: ['plan-approval'], next: 'verify' },
    { id: 'verify', type: 'agent', image: 'qa-playwright@2', on: { pass: 'review', fail: { goto: 'implement', maxLoops: 2 } } },
    { id: 'review', type: 'agent', image: 'base@7', on: { pass: 'deliver', fail: { goto: 'implement', maxLoops: 1 } } },
    { id: 'deliver', type: 'system', action: 'create-pull-request' },
  ],
});
const pass = { verdict: 'pass' as const, summary: '', outputs: {} };
const fail = { verdict: 'fail' as const, summary: '', outputs: {} };

describe('nextStage', () => {
  it('pass なら on.pass、なければ next に進む', () => {
    expect(nextStage(findStage(line, 'implement'), pass, {})).toBe('verify');
    expect(nextStage(findStage(line, 'verify'), pass, {})).toBe('review');
    expect(nextStage(findStage(line, 'deliver'), pass, {})).toBeUndefined();
  });
  it('fail は maxLoops 回まで goto に戻り、超えたら終了する', () => {
    const loops: Record<string, number> = {};
    const verify = findStage(line, 'verify');
    expect(nextStage(verify, fail, loops)).toBe('implement');
    expect(nextStage(verify, fail, loops)).toBe('implement');
    expect(nextStage(verify, fail, loops)).toBeUndefined();
  });
  it('既定値が契約で埋まる（timeoutHours=6, keepVm=false）', () => {
    expect(findStage(line, 'verify')).toMatchObject({ timeoutHours: 6, keepVm: false, gates: [] });
  });
});
