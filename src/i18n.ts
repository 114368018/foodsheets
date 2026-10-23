// Chinese is the source language: UI text is written in Chinese and looked up here for English.
// Placeholders: {name} for named values, {0} {1} … for positional ones.
import { EN } from './i18n-en.ts'

export type Lang = 'zh' | 'en'

const fill = (text: string, params?: Record<string, string | number> | Array<string | number>): string => {
  if (!params) {
    return text
  }
  return text.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = Array.isArray(params) ? params[Number(key)] : params[key]
    return value === undefined ? match : String(value)
  })
}

export const translate = (
  lang: Lang,
  text: string,
  params?: Record<string, string | number> | Array<string | number>,
): string => {
  const filled = fill(lang === 'en' ? (EN[text] ?? text) : text, params)
  // "1 ingredients" -> "1 ingredient"
  return lang === 'en'
    ? filled.replace(
        /(^|[^\d.])1 (?:(ingredient|item|tool|photo|group|store|row)s|(dish)es)\b/g,
        (_match, before: string, noun?: string, dish?: string) => `${before}1 ${noun ?? dish}`,
      )
    : filled
}

export const hasTranslation = (text: string) => text in EN
