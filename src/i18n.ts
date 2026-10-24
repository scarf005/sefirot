import { i18n } from "@lingui/core"
import { t } from "@lingui/core/macro"
import { signal } from "@preact/signals"
import { messages as en } from "./locales/en.po"
import { messages as ja } from "./locales/ja.po"
import { messages as ko } from "./locales/ko.po"
import { detectLocale, type Locale } from "./story-l10n.ts"

export const localeNames: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
}

const STORAGE_KEY = "sefirot-locale"

const readSaved = () => {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY)
  } catch {
    return undefined
  }
}

// Components read this signal, so they render again when the locale changes.
export const locale = signal<Locale>(
  detectLocale(readSaved(), globalThis.navigator?.languages ?? []),
)

i18n.load({ ko, en, ja })

const activate = (next: Locale) => {
  i18n.activate(next)
  document.documentElement.lang = next
  document.title = t`블루 아카이브 시간순 스토리`
}

activate(locale.value)

export const setLocale = (next: Locale) => {
  activate(next)
  locale.value = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next)
  } catch {
    // The choice then lasts only for this visit.
  }
}
