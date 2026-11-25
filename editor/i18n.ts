// English strings with {{name}} placeholders (UP used Paseo's translation helper).
import en from "./locales/en";
import type { Translate } from "./canvas";

export type TextKey = keyof typeof en;

export const t: Translate = (key, values) => {
  const text = (en as Record<string, string>)[key] ?? key;
  return values ? text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => values[name] ?? match) : text;
};
