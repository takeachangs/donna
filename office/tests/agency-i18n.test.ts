import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../apps/web/src/i18n/en';
import zh from '../apps/web/src/i18n/zh-CN';
const walk = (d: string): string[] =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.ts') ? [join(d, e.name)] : [],
  );
const used = new Set(
  walk('apps/web/src').flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/\bt\('([^']+)'/g)].map((m) => m[1])),
);
const E = en as Record<string, string>,
  Z = zh as Record<string, string>;
// Keys main.ts passes to t() through a variable.
const dynamic = ['queued', 'working', 'waiting', 'review', 'done', 'paused', 'failed']
  .map((s) => 'agency.status_' + s)
  .concat(
    'agency.badge_review',
    'agency.read',
    'agency.unread',
    'agency.latest',
    'agency.checkpoint',
    'agency.next_step',
    'agency.call_donna',
    'agency.hang_up',
    'agency.phone_absent',
  );
describe('i18n', () => {
  for (const [n, D] of [
    ['en', E],
    ['zh-CN', Z],
  ] as const) {
    it(`${n} has every literal t('…') key`, () => expect([...used].filter((k) => !(k in D))).toEqual([]));
    it(`${n} has the dynamic keys`, () => expect(dynamic.filter((k) => !(k in D))).toEqual([]));
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
