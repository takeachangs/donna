import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../apps/web/src/i18n/en';
import zh from '../apps/web/src/i18n/zh-CN';
import { callControls } from '../apps/web/src/agency/call';
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : [],
  );
const used = new Set(
  walk('apps/web/src').flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bt\('([^']+)'/g)].map((m) => m[1])),
);
const E = en as Record<string, string>,
  Z = zh as Record<string, string>;
const dynamic = ['queued', 'working', 'waiting', 'review', 'done', 'paused', 'failed']
  .map((s) => 'agency.status_' + s)
  .concat(
    'agency.badge_review',
    ['available', 'ringing', 'on_call', 'reconnecting'].map((s) => 'agency.pill_' + s),
  );
const bools = [false, true],
  ctl = new Set<string>();
for (const socket of bools)
  for (const ringing of bools)
    for (const mic of ['live', 'muted', 'blocked'] as const)
      for (const reconnecting of bools)
        for (const v of Object.values(callControls({ socket, ringing, mic, reconnecting })))
          if (typeof v === 'string' && v.startsWith('agency.')) ctl.add(v);
describe('i18n', () => {
  for (const [n, D] of [
    ['en', E],
    ['zh-CN', Z],
  ] as const) {
    it(`${n} has every literal t('…') key`, () => expect([...used].filter((k) => !(k in D))).toEqual([]));
    it(`${n} has the dynamic and call-control keys`, () =>
      expect([...dynamic, ...ctl].filter((k) => !(k in D))).toEqual([]));
  }
  it('en and zh-CN have the same keys', () => {
    const a = Object.keys(E),
      b = Object.keys(Z);
    expect({ onlyEn: a.filter((k) => !(k in Z)).sort(), onlyZh: b.filter((k) => !(k in E)).sort() }).toEqual({
      onlyEn: [],
      onlyZh: [],
    });
  });
  it('en copy never says secretary', () =>
    expect(
      Object.entries(E)
        .filter(([, v]) => /secretary/i.test(v))
        .map(([k]) => k),
    ).toEqual([]));
});
