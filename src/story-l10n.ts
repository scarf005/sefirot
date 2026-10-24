export const locales = ["ko", "en", "ja"] as const
export type Locale = (typeof locales)[number]

type Thumbnail = { url: string; fit: "cover" | "contain" }
type Localized = { series?: string; summary?: string; thumbnail?: Thumbnail }
type Localizable = {
  series: string
  chapter: string
  title: string
  label: string
  episodes: string
  summary?: string
  thumbnail?: Thumbnail
  l10n?: Partial<Record<Exclude<Locale, "ko">, Localized>>
}

// Korean is the base text. Other locales override only what the crawl found,
// so lane classification (which reads the Korean names) must use the base item.
export const localizeStory = <T extends Localizable>(
  item: T,
  locale: Locale,
): T => {
  const local = locale === "ko" ? undefined : item.l10n?.[locale]
  if (!local) return item
  const { series } = local
  return {
    ...item,
    ...(series
      ? {
        series,
        chapter: series,
        title: series,
        label: `${series} · ${item.episodes}`,
      }
      : {}),
    ...(local.summary ? { summary: local.summary } : {}),
    ...(local.thumbnail ? { thumbnail: local.thumbnail } : {}),
  }
}

export const detectLocale = (
  saved: string | null | undefined,
  languages: readonly string[],
): Locale => {
  const find = (tag: string) => locales.find((locale) => locale === tag)
  return find(saved ?? "") ??
    languages.flatMap((language) => find(language.slice(0, 2)) ?? []).at(0) ??
    "ko"
}
