import en from './en';
import zhCN from './zh-CN';

const locales: Record<string, Record<string, string>> = { en, 'zh-CN': zhCN };
let current = 'en';
export function initLocale() {
  current = 'en';
}
export function setLocale(locale: string) {
  if (locales[locale]) current = locale;
}
export function t(key: string, vars?: Record<string, string>): string {
  let text = locales[current][key] ?? locales.en[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, value);
  return text;
}
