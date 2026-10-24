/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import { detectLocale, localizeStory } from "./story-l10n.ts"

const item = {
  series: "미식연구회",
  chapter: "미식연구회",
  title: "미식연구회",
  label: "미식연구회 · 1~4",
  episodes: "1~4",
  summary: "식도락",
  thumbnail: { url: "ko.webp", fit: "cover" as const },
  l10n: {
    en: {
      series: "Gourmet Research Society",
      summary: "Food.",
      thumbnail: { url: "en.png", fit: "contain" as const },
    },
    ja: { series: "美食研究会" },
  },
}

Deno.test("keeps the Korean base for ko and for locales without data", () => {
  assertEquals(localizeStory(item, "ko"), item)
  assertEquals(localizeStory({ ...item, l10n: undefined }, "en"), {
    ...item,
    l10n: undefined,
  })
})

Deno.test("overrides names, summary and image for a locale", () => {
  const en = localizeStory(item, "en")
  assertEquals(
    [en.series, en.chapter, en.title, en.label, en.summary, en.thumbnail.url],
    [
      "Gourmet Research Society",
      "Gourmet Research Society",
      "Gourmet Research Society",
      "Gourmet Research Society · 1~4",
      "Food.",
      "en.png",
    ],
  )
})

Deno.test("falls back per field when a locale lacks a summary or image", () => {
  const ja = localizeStory(item, "ja")
  assertEquals([ja.series, ja.summary, ja.thumbnail.url], [
    "美食研究会",
    "식도락",
    "ko.webp",
  ])
})

Deno.test("detects the saved locale before the browser languages", () => {
  assertEquals(detectLocale("ja", ["en-US"]), "ja")
  assertEquals(detectLocale(null, ["fr-FR", "en-US"]), "en")
  assertEquals(detectLocale("xx", ["ja"]), "ja")
  assertEquals(detectLocale(undefined, ["fr"]), "ko")
})
