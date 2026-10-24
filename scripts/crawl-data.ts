#!/usr/bin/env -S deno -A
/// <reference lib="deno.ns" />

import { HTMLElement, type Node, parse } from "node-html-parser"
import { type Browser, chromium } from "playwright-core"
import { isKoreanText } from "../src/korean-text.ts"

const SOURCE_URL = "https://namu.wiki/w/틀:블루 아카이브 스토리 시점순"
const OUTPUT_PATH = "src/data/blue-archive-story-order.jsonc"
const STORY_KINDS = new Set(["메인", "이벤트", "그룹", "미니"])
const SCHALEDB_LOCALIZATION_URL = (lang: string) =>
  `https://schaledb.com/data/${lang}/localization.min.json`
const WIKI_API_URL = "https://bluearchive.wiki/w/api.php"
const EVENT_LOGO_URL = (id: string, lang = "Kr") =>
  `https://schaledb.com/images/eventlogo/${id}_${lang}.webp`
const EVENT_PROMO_QUERY =
  '{{#invoke:BlueBucket|get|events|select = Id, PageName, Promo|where = Server = "JP"|order by = Id ASC|limit = 1000|format = json|default = []}}'
const EVENT_ROWS_QUERY =
  '{{#invoke:BlueBucket|get|events|select = Id, OriginalId, Server, NameEN, NameJP, Banner, Description|where = Server = "JP" OR Server = "GL"|limit = 2000|format = json|default = []}}'
const MIN_CONTAINED_NAME_LENGTH = 4
const IMAGEINFO_BATCH_SIZE = 50
const SUMMARY_KINDS = new Set(["메인", "이벤트", "그룹"])
const NAMU_FETCH_DELAY_MS = 1000
const SEGMENTS = [
  { id: "part-1-to-final", name: "1부 시작~최종편", sourceTableIndex: 1 },
  {
    id: "post-final-to-decagrammaton",
    name: "최종편 이후~데카그라마톤",
    sourceTableIndex: 2,
  },
  { id: "part-2", name: "2부", sourceTableIndex: 3 },
]

type Link = { label: string; url: string }
type StoryItem = {
  id: string
  order: number
  segmentId: string
  segmentName: string
  kind: string
  series: string
  chapter: string
  episodes: string
  title: string
  label: string
  release: { japan: string[]; global: string[]; krDub: string[] }
  notes: string[]
  links: Link[]
  thumbnail?: Thumbnail
  summary?: string
  l10n?: Partial<Record<Locale, Localized>>
}
type Thumbnail = { url: string; fit: "cover" | "contain" }
// Korean is the base text; other locales override only what the wiki has.
type Locale = "en" | "ja"
type Localized = { series?: string; summary?: string; thumbnail?: Thumbnail }
type StoryTreeNode = {
  id: string
  name?: string
  sourceTableIndex?: number
  itemId?: string
  children?: StoryTreeNode[]
}

type StoryData = {
  generatedAt: string
  tree: StoryTreeNode
  items: StoryItem[]
}

type CellSpan = { cell: HTMLElement; remainingRows: number }

type CliOptions = { source: string; output: string; fromFile?: string }

const parseArgs = (args: string[]): CliOptions => {
  const options: CliOptions = { source: SOURCE_URL, output: OUTPUT_PATH }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if (arg === "--source" && next) {
      options.source = next
      index += 1
    } else if (arg === "--output" && next) {
      options.output = next
      index += 1
    } else if (arg === "--from-file" && next) {
      options.fromFile = next
      index += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  return options
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// namu.wiki is read through one headless browser for the whole crawl,
// launched on first use and visited sequentially with a pause in between.
type NamuBrowser = {
  load: (url: string) => Promise<{ html: string; url: string }>
  close: () => Promise<void>
}

const createNamuBrowser = (): NamuBrowser => {
  let browser: Browser | undefined
  let page: Awaited<ReturnType<Browser["newPage"]>> | undefined
  let visited = false
  return {
    load: async (url) => {
      if (!page) {
        browser = await chromium.launch()
        page = await (await browser.newContext({ locale: "ko-KR" })).newPage()
      }
      if (visited) await delay(NAMU_FETCH_DELAY_MS)
      visited = true
      const response = await page.goto(url, { waitUntil: "domcontentloaded" })
      if (!response?.ok()) {
        throw new Error(`Failed to fetch ${url}: ${response?.status()}`)
      }
      await page.waitForSelector("h1")
      return { html: await page.content(), url: page.url() }
    },
    close: async () => {
      await browser?.close()
    },
  }
}

const fetchHtml = async (options: CliOptions, namu: NamuBrowser) =>
  options.fromFile
    ? await Deno.readTextFile(options.fromFile)
    : (await namu.load(options.source)).html

const textOf = (element: HTMLElement) => {
  const htmlWithBreaks = element.innerHTML
    .replace(/<br\b[^>]*>/gi, " ")
    .replace(/<\/(?:div|p|li|span|a|strong)>/gi, " ")
  return parse(htmlWithBreaks).textContent.replace(/\s+/g, " ").trim()
}

const uniqueLinks = (cells: HTMLElement[], sourceUrl: string) => {
  const links = new Map<string, Link>()
  for (const cell of new Set(cells)) {
    for (const anchor of cell.querySelectorAll("a")) {
      const href = anchor.getAttribute("href")
      if (!href || href.startsWith("#")) continue
      const label = textOf(anchor) || anchor.getAttribute("title") || href
      const url = new URL(href, sourceUrl).href
      links.set(`${label}\u0000${url}`, { label, url })
    }
  }
  return [...links.values()]
}

const expandedRows = (table: HTMLElement) => {
  const activeSpans = new Map<number, CellSpan>()
  const rows: HTMLElement[][] = []

  for (const tr of table.querySelectorAll("tr")) {
    const row: HTMLElement[] = []
    let column = 0

    for (const cell of tr.querySelectorAll("td")) {
      column = fillActiveSpans({ row, activeSpans, column })

      const rowspan = Number(cell.getAttribute("rowspan") ?? 1)
      const colspan = Number(cell.getAttribute("colspan") ?? 1)
      for (let offset = 0; offset < colspan; offset += 1) {
        row[column + offset] = cell
        if (rowspan > 1) {
          activeSpans.set(column + offset, {
            cell,
            remainingRows: rowspan - 1,
          })
        }
      }
      column += colspan
    }

    fillActiveSpans({ row, activeSpans, column })
    rows.push(row)
  }

  return rows
}

const fillActiveSpans = (options: {
  row: HTMLElement[]
  activeSpans: Map<number, CellSpan>
  column: number
}) => {
  let { column } = options
  const { activeSpans, row } = options
  while (activeSpans.has(column)) {
    const span = activeSpans.get(column)!
    row[column] = span.cell
    span.remainingRows -= 1
    if (span.remainingRows === 0) activeSpans.delete(column)
    column += 1
  }
  return column
}

const storyTables = (html: string) => {
  const root = parse(html)
  return root.querySelectorAll("table").filter((table) => {
    const header = expandedRows(table)[0]?.slice(0, 6).map(textOf).join("|")
    return header === "종류|편|장|화|일본|글로벌"
  })
}

const parseDates = (text: string) => {
  return [...text.matchAll(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/g)]
    .map(([, year, month, day]) =>
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`
    )
}

export const releaseFrom = (japanRaw: string, globalRaw: string) => {
  const krDub = parseDates(
    [...globalRaw.matchAll(/KR\s*더빙\s*(\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)/g)]
      .map((match) => match[1])
      .join(" "),
  )
  const globalWithoutDub = globalRaw.replace(
    /KR\s*더빙\s*\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?/g,
    " ",
  )
  return {
    japan: parseDates(japanRaw),
    global: parseDates(globalWithoutDub),
    krDub,
  }
}

const titleFor = (kind: string, series: string, chapter: string) => {
  if (kind === "메인") return `${series} / ${chapter}`
  return series
}

const assertText = (value: string, label: string) => {
  if (value.length === 0) throw new Error(`Missing ${label}`)
  return value
}

const parseTable = (options: {
  table: HTMLElement
  segment: (typeof SEGMENTS)[number]
  sourceUrl: string
  startOrder: number
}) => {
  const items: StoryItem[] = []

  for (const row of expandedRows(options.table).slice(1)) {
    const first = textOf(row[0])
    if (STORY_KINDS.has(first)) {
      if (row.length < 6) throw new Error(`Story row has ${row.length} columns`)
      const order = options.startOrder + items.length
      const kind = first
      const series = assertText(textOf(row[1]), `series for order ${order}`)
      const chapter = textOf(row[2]) || series
      const episodes = assertText(textOf(row[3]), `episodes for order ${order}`)
      const title = titleFor(kind, series, chapter)
      const release = releaseFrom(textOf(row[4]), textOf(row[5]))
      if (release.japan.length === 0) {
        throw new Error(`Missing Japan release date for order ${order}`)
      }
      const id = `story-${String(order).padStart(3, "0")}`

      items.push({
        id,
        order,
        segmentId: options.segment.id,
        segmentName: options.segment.name,
        kind,
        series,
        chapter,
        episodes,
        title,
        label: `${title} · ${episodes}`,
        release,
        notes: [],
        links: uniqueLinks([row[1], row[2]], options.sourceUrl),
      })
      continue
    }

    const note = first
    if (note.length > 0 && items.length > 0) items.at(-1)!.notes.push(note)
  }

  return items
}

export const buildData = (html: string, sourceUrl: string): StoryData => {
  const tables = storyTables(html)
  if (tables.length < SEGMENTS.length) {
    throw new Error(
      `Expected ${SEGMENTS.length} story tables, found ${tables.length}`,
    )
  }

  const segmentItems: StoryItem[][] = []
  let nextOrder = 1
  for (let index = 0; index < SEGMENTS.length; index += 1) {
    const items = parseTable({
      table: tables[index],
      segment: SEGMENTS[index],
      sourceUrl,
      startOrder: nextOrder,
    })
    segmentItems.push(items)
    nextOrder += items.length
  }
  const items = segmentItems.flat()
  if (items.length === 0) throw new Error("No story items were parsed")

  return {
    generatedAt: new Date().toISOString(),
    tree: {
      id: "blue-archive-story-order-tree",
      name: "Blue Archive story order",
      children: SEGMENTS.map((segment, index) => ({
        id: segment.id,
        name: segment.name,
        sourceTableIndex: segment.sourceTableIndex,
        children: segmentItems[index].map((item) => ({
          id: `${item.id}-node`,
          itemId: item.id,
        })),
      })),
    },
    items,
  }
}

export const stringifyJsonc = (value: unknown) => {
  const lines = JSON.stringify(value, null, 2).split("\n")
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1].trimEnd()
    const current = lines[index].trim()
    const closesBlock = /^[}\]],?$/.test(current)
    if (
      closesBlock && !previous.endsWith(",") && !previous.endsWith("[") &&
      !previous.endsWith("{")
    ) {
      lines[index - 1] += ","
    }
  }
  return `${lines.join("\n")}\n`
}

type ThumbnailFit = Thumbnail["fit"]
// A file is a wiki title resolved to a thumbnail url; a url is used as is.
type ThumbnailCandidate =
  | { file: string; fit: ThumbnailFit }
  | { url: string; fit: ThumbnailFit }
type ThumbnailKind = "메인" | "이벤트" | "그룹"

export const normalizeName = (name: string) =>
  name.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "")

// Exact normalized match first, then the longest candidate contained in the
// query (a subtitle was added), then a candidate containing the query (a
// subtitle was dropped). Ambiguous matches return undefined instead of guessing.
export const matchName = (name: string, candidates: Record<string, string>) => {
  const target = normalizeName(name)
  const entries = Object.entries(candidates)
    .map(([key, value]) => ({ key, name: normalizeName(value) }))
    .filter((entry) => entry.name.length > 0)
  const unique = (matches: typeof entries) =>
    matches.length === 1 ? matches[0].key : undefined
  if (target.length === 0) return undefined

  const exact = entries.filter((entry) => entry.name === target)
  if (exact.length > 0) return unique(exact)

  const contained = entries.filter((entry) =>
    entry.name.length >= MIN_CONTAINED_NAME_LENGTH &&
    target.includes(entry.name)
  )
  if (contained.length > 0) {
    const longest = Math.max(...contained.map((entry) => entry.name.length))
    return unique(contained.filter((entry) => entry.name.length === longest))
  }

  if (target.length < MIN_CONTAINED_NAME_LENGTH) return undefined
  return unique(entries.filter((entry) => entry.name.includes(target)))
}

const stripHtml = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (_, entity: string) => {
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
      }
      const lower = entity.toLowerCase()
      if (lower in named) return named[lower]
      return String.fromCodePoint(
        lower.startsWith("#x")
          ? parseInt(lower.slice(2), 16)
          : Number(lower.slice(1)),
      )
    },
  )

// Event id -> promo file title from the rendered BlueBucket JSON rows.
export const parseEventPromos = (renderedHtml: string) => {
  const rows = JSON.parse(stripHtml(renderedHtml).trim()) as {
    Id?: number
    Promo?: string
  }[]
  return new Map(
    rows.flatMap((row) =>
      row.Id !== undefined && row.Promo
        ? [[String(row.Id), row.Promo] as const]
        : []
    ),
  )
}

export const eventCandidates = (options: {
  series: string
  eventNames: Record<string, string>
  promos: ReadonlyMap<string, string>
}): ThumbnailCandidate[] => {
  const id = matchName(options.series, options.eventNames)
  if (id === undefined) return []
  const promo = options.promos.get(id)
  return [
    ...(promo ? [{ file: promo, fit: "cover" as const }] : []),
    { url: EVENT_LOGO_URL(id), fit: "contain" },
  ]
}

const EVENT_PAGE_PREFIX = "/w/블루 아카이브/이벤트/"
const STORY_PAGE_URL = "https://namu.wiki/w/블루 아카이브/스토리"

const namuPath = (link: Link) => decodeURIComponent(new URL(link.url).pathname)
const LINKED_EVENT_PREFIX = "메인 스토리 연계 이벤트 "

// Event page title -> Korean in-game banner from the event navbox at the
// bottom of every namu event page; Japanese-only banners are skipped.
export const parseEventBanners = (root: HTMLElement) => {
  const banners = new Map<string, string>()
  for (const image of root.querySelectorAll("img")) {
    const alt = image.getAttribute("alt") ?? ""
    if (!/^BA(?:메인|미니|스페셜)이벤트배너[\d-]+(?:JP)?KR$/.test(alt)) continue
    const href = decodeURIComponent(
      image.closest("a")?.getAttribute("href") ?? "",
    )
    const src = [image.getAttribute("data-src"), image.getAttribute("src")]
      .find((value) => value?.startsWith("//"))
    if (!href.startsWith(EVENT_PAGE_PREFIX) || !src) continue
    const title = href.slice(EVENT_PAGE_PREFIX.length)
    if (!banners.has(title)) banners.set(title, `https:${src}`)
  }
  return banners
}

// The story's own namu event link first; renamed pages fall back to the name.
export const eventBannerFor = (
  item: { series: string; links: Link[] },
  banners: ReadonlyMap<string, string>,
) => {
  for (const link of item.links) {
    const path = namuPath(link)
    const banner = path.startsWith(EVENT_PAGE_PREFIX)
      ? banners.get(path.slice(EVENT_PAGE_PREFIX.length))
      : undefined
    if (banner) return banner
  }
  const titles = Object.fromEntries([...banners.keys()].map((t) => [t, t]))
  const title = matchName(item.series.replace(LINKED_EVENT_PREFIX, ""), titles)
  return title === undefined ? undefined : banners.get(title)
}

type StoryCard = { image: string; summary?: string }

// Mini and group story cards on the namu story page: image, bold title, a
// rule, then the in-game blurb. Mini cards start with an anchor named after
// the story; group cards are keyed by their title.
export const parseStoryCards = (root: HTMLElement) => {
  const cards = new Map<string, StoryCard>()
  for (const image of root.querySelectorAll("img")) {
    if (!/^BA (?:미니|그룹)스토리\d+$/.test(image.getAttribute("alt") ?? "")) {
      continue
    }
    const table = image.closest("table")
    const key = image.closest("td")?.querySelector("a[id]")?.id ??
      table?.querySelector("strong")?.textContent.trim()
    const src = image.getAttribute("src")
    if (!table || !key || !src?.startsWith("//") || cards.has(key)) continue
    const blurb = table.querySelectorAll("td").at(-1)
    const rule = blurb?.childNodes.map(isRule).lastIndexOf(true) ?? -1
    const summary = blurb && rule >= 0
      ? proseOf(blurb.childNodes.slice(rule + 1))
      : ""
    cards.set(key, {
      image: `https:${src}`,
      summary: isKoreanText(summary) ? summary : undefined,
    })
  }
  return cards
}

// The story's own anchor link first, then the name.
export const storyCardFor = (
  item: { series: string; links: Link[] },
  cards: ReadonlyMap<string, StoryCard>,
) => {
  for (const link of item.links) {
    const card = cards.get(decodeURIComponent(new URL(link.url).hash.slice(1)))
    if (card) return card
  }
  const titles = Object.fromEntries([...cards.keys()].map((t) => [t, t]))
  const title = matchName(item.series, titles)
  return title === undefined ? undefined : cards.get(title)
}

// Same key as mainBackgrounds: "<act>:<volume token>".
export const mainVolumeKey = (series: string, segmentId: string) => {
  const act = segmentId === "part-2" ? 2 : 1
  const volume = series.match(/^Vol\.(\d+)/)?.[1] ??
    (series.startsWith("프롤로그") ? (act === 2 ? "P" : "0") : undefined) ??
    (series.startsWith("Final.") ? "F" : undefined) ??
    (series.startsWith("Ex.") ? "EX" : undefined)
  return volume === undefined ? undefined : `${act}:${volume}`
}

// Body lines under each volume heading of the Main Story page, keyed like
// mainVolumeKey: "<act>:<volume token>".
const volumeSections = (wikitext: string) => {
  const sections = new Map<string, string[]>()
  let act = 0
  let lines: string[] | undefined
  for (const line of wikitext.split("\n")) {
    const heading = line.match(/^(={2,3})\s*(.*?)\s*\1\s*$/)
    if (heading?.[1] === "==") {
      act = Number(heading[2].match(/^Act (\d+)/)?.[1] ?? 0)
      lines = undefined
    } else if (heading) {
      const volume = heading[2].match(/^\[\[\/(?:Act \d+\/)?Volume ([^|\]]+)\|/)
        ?.[1] ?? heading[2].match(/^Volume (\w+)/)?.[1]
      lines = volume === undefined ? undefined : []
      if (volume !== undefined) sections.set(`${act}:${volume.trim()}`, lines!)
    } else lines?.push(line)
  }
  return sections
}

// Volume headings of the Main Story page and the file that follows each one.
export const mainBackgrounds = (wikitext: string) =>
  new Map(
    [...volumeSections(wikitext)].map(([key, lines]) => [
      key,
      lines.map((line) => line.match(/\[\[(File:[^|\]]+)/)?.[1]).find(Boolean),
    ]),
  )

export const plainWikitext = (text: string) =>
  text.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}|<[^>]+>/g, "").replace(/\s+/g, " ").trim()

// The English blurb that follows each volume heading.
export const mainBlurbs = (wikitext: string) =>
  new Map(
    [...volumeSections(wikitext)].flatMap(([key, lines]) => {
      const blurb = lines.find((line) => /^[A-Z]/.test(line))
      return blurb ? [[key, plainWikitext(blurb)] as const] : []
    }),
  )

export const firstFile = (wikitext: string) =>
  wikitext.match(/\[\[(File:[^|\]]+)/)?.[1]?.trim()

// First background of a story script, skipping plain black fades.
export const firstBackground = (wikitext: string) =>
  [...wikitext.matchAll(/\bbackground\d*\s*=\s*([^\n|}]+)/g)]
    .map((match) => match[1].trim())
    .find((background) => !/^BG_Black$/i.test(background))

// Story backgrounds are named BG_*.jpg, with a few .png exceptions.
export const backgroundCandidates = (background: string | undefined) =>
  background === undefined ? [] : [".jpg", ".png"].map((extension) => ({
    file: `File:${background}${extension}`,
    fit: "cover" as const,
  }))

export const fileCandidates = (file: string | undefined) =>
  file === undefined ? [] : [{ file, fit: "cover" as const }]

const titleKey = (title: string) => title.replaceAll("_", " ").trim()

// First candidate that resolved to an image: a wiki file with a thumbnail url
// or a direct url that responded.
export const pickThumbnail = (options: {
  candidates: ThumbnailCandidate[]
  thumbUrls: ReadonlyMap<string, string>
  liveUrls: ReadonlySet<string>
}): Thumbnail | undefined => {
  for (const candidate of options.candidates) {
    const url = "file" in candidate
      ? options.thumbUrls.get(titleKey(candidate.file))
      : options.liveUrls.has(candidate.url)
      ? candidate.url
      : undefined
    if (url !== undefined) return { url, fit: candidate.fit }
  }
  return undefined
}

// Title -> thumbnail url from an action=query&prop=imageinfo response.
export const parseImageInfo = (response: {
  query?: {
    normalized?: { from: string; to: string }[]
    pages?: Record<
      string,
      { title: string; imageinfo?: { thumburl?: string }[] }
    >
  }
}) => {
  const thumbUrls = new Map<string, string>()
  const aliases = new Map(
    (response.query?.normalized ?? []).map((entry) => [entry.to, entry.from]),
  )
  for (const page of Object.values(response.query?.pages ?? {})) {
    const url = page.imageinfo?.[0]?.thumburl
    if (!url) continue
    thumbUrls.set(titleKey(page.title), url)
    const alias = aliases.get(page.title)
    if (alias) thumbUrls.set(titleKey(alias), url)
  }
  return thumbUrls
}

export const thumbnailCoverage = (items: StoryItem[]) => {
  const kinds = new Map<
    string,
    { series: Set<string>; matched: Set<string> }
  >()
  for (const item of items) {
    const entry = kinds.get(item.kind) ??
      { series: new Set<string>(), matched: new Set<string>() }
    entry.series.add(item.series)
    if (item.thumbnail) entry.matched.add(item.series)
    kinds.set(item.kind, entry)
  }
  return [...kinds].map(([kind, { series, matched }]) => ({
    kind,
    series: series.size,
    matched: matched.size,
    unmatched: [...series].filter((name) => !matched.has(name)),
  }))
}

const wikiHeaders = {
  "user-agent": "Mozilla/5.0 (compatible; sefirot-story-order-crawler/1.0)",
}

const fetchJson = async <T>(url: string | URL): Promise<T> => {
  const response = await fetch(url, { headers: wikiHeaders })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`)
  }
  return await response.json() as T
}

const wikiApi = <T>(params: Record<string, string>) =>
  fetchJson<T>(
    `${WIKI_API_URL}?${new URLSearchParams({ format: "json", ...params })}`,
  )

const fetchWikitext = async (page: string) => {
  const response = await wikiApi<{ parse?: { wikitext?: string } }>({
    action: "parse",
    page,
    prop: "wikitext",
    formatversion: "2",
  })
  return response.parse?.wikitext
}

type Localization = {
  EventName: Record<string, string>
  Club: Record<string, string>
}

const fetchLocalization = (lang: string) =>
  fetchJson<Localization>(SCHALEDB_LOCALIZATION_URL(lang))

const fetchEventPromos = async () => {
  const response = await wikiApi<{ parse: { text: { "*": string } } }>({
    action: "parse",
    contentmodel: "wikitext",
    prop: "text",
    text: EVENT_PROMO_QUERY,
  })
  return parseEventPromos(response.parse.text["*"])
}

const fetchThumbUrls = async (titles: string[]) => {
  const thumbUrls = new Map<string, string>()
  const unique = [...new Set(titles.map(titleKey))]
  for (let index = 0; index < unique.length; index += IMAGEINFO_BATCH_SIZE) {
    const response = await wikiApi<Parameters<typeof parseImageInfo>[0]>({
      action: "query",
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: "480",
      titles: unique.slice(index, index + IMAGEINFO_BATCH_SIZE).join("|"),
    })
    for (const [title, url] of parseImageInfo(response)) {
      thumbUrls.set(title, url)
    }
  }
  return thumbUrls
}

const fetchLiveUrls = async (urls: string[]) => {
  const live = await Promise.all([...new Set(urls)].map(async (url) => {
    const response = await fetch(url, { method: "HEAD", headers: wikiHeaders })
    return response.ok ? url : undefined
  }))
  return new Set(live.filter((url) => url !== undefined))
}

// Act 2 volume pages carry no image; fall back to the first episode's
// background.
const act2Candidates = async (volume: string) => {
  const page = `Main Story/Act 2/Volume ${volume}`
  const volumeText = await fetchWikitext(page)
  const fromVolume = fileCandidates(volumeText && firstFile(volumeText))
  if (fromVolume.length > 0) return fromVolume
  const episodeText = await fetchWikitext(`${page}/Chapter 1/Episode 1`)
  return backgroundCandidates(episodeText && firstBackground(episodeText))
}

const settle = async <T>(label: string, task: Promise<T>, fallback: T) => {
  try {
    return await task
  } catch (error) {
    console.warn(`Skipping ${label}: ${error}`)
    return fallback
  }
}

export const enrichThumbnails = async (items: StoryItem[]) => {
  const seriesOf = (kind: ThumbnailKind) => [
    ...new Set(
      items.filter((item) => item.kind === kind)
        .map((item) => item.series),
    ),
  ]
  const [localization, promos, mainText] = await Promise.all([
    settle(
      "SchaleDB localization",
      fetchLocalization("kr"),
      { EventName: {}, Club: {} },
    ),
    settle("event promos", fetchEventPromos(), new Map<string, string>()),
    settle("main story page", fetchWikitext("Main_Story"), undefined),
  ])

  const byKey = new Map<string, ThumbnailCandidate[]>()
  for (const series of seriesOf("이벤트")) {
    byKey.set(
      `이벤트|${series}`,
      eventCandidates({ series, eventNames: localization.EventName, promos }),
    )
  }

  const backgrounds = mainText ? mainBackgrounds(mainText) : new Map()
  const mainKeys = new Set(
    items.filter((item) => item.kind === "메인")
      .map((item) => mainVolumeKey(item.series, item.segmentId)),
  )
  await Promise.all([...mainKeys].map(async (key) => {
    if (key === undefined) return
    const file = backgrounds.get(key)
    const [act, volume] = key.split(":")
    byKey.set(
      `메인|${key}`,
      file || act === "1"
        ? fileCandidates(file)
        : await settle(`act 2 volume ${volume}`, act2Candidates(volume), []),
    )
  }))

  await Promise.all(
    seriesOf("그룹").map(async (series) => {
      const code = matchName(series, localization.Club)
      const text = code === undefined ? undefined : await settle(
        `group ${code}`,
        fetchWikitext(`Group Story/${code}/1`),
        undefined,
      )
      byKey.set(
        `그룹|${series}`,
        backgroundCandidates(text && firstBackground(text)),
      )
    }),
  )

  const candidatesFor = (item: StoryItem) =>
    byKey.get(
      item.kind === "메인"
        ? `메인|${mainVolumeKey(item.series, item.segmentId)}`
        : `${item.kind}|${item.series}`,
    ) ?? []
  const all = items.flatMap(candidatesFor)
  const [thumbUrls, liveUrls] = await Promise.all([
    settle(
      "image info",
      fetchThumbUrls(all.flatMap((c) => "file" in c ? [c.file] : [])),
      new Map<string, string>(),
    ),
    settle(
      "event logos",
      fetchLiveUrls(all.flatMap((c) => "url" in c ? [c.url] : [])),
      new Set<string>(),
    ),
  ])

  return items.map((item) => {
    const thumbnail = pickThumbnail({
      candidates: candidatesFor(item),
      thumbUrls,
      liveUrls,
    })
    return thumbnail ? { ...item, thumbnail } : item
  })
}

const HEADINGS = "h1, h2, h3, h4, h5, h6"

const isHeading = (element: HTMLElement) => /^H[1-6]$/.test(element.tagName)

const isRule = (node: Node) =>
  node instanceof HTMLElement && node.tagName === "HR"

const headingTitle = (heading: HTMLElement) =>
  textOf(heading).replace(/\[편집\]$/, "").replace(/^\d+(?:\.\d+)*\.\s*/, "")
    .trim()

const compact = (element: HTMLElement) =>
  element.textContent.replace(/[\s\u00a0]+/g, "")

// Namu renders a section as sibling blocks after the heading's wrapper. The
// wrapper is the outermost ancestor holding nothing but the heading (and
// blank spacers).
const sectionBlocks = (heading: HTMLElement) => {
  let wrapper = heading
  while (
    wrapper.parentNode && compact(wrapper.parentNode) === compact(heading)
  ) wrapper = wrapper.parentNode
  const blocks: HTMLElement[] = []
  for (
    let block = wrapper.nextElementSibling;
    block && !isHeading(block) && !block.querySelector(HEADINGS);
    block = block.nextElementSibling
  ) blocks.push(block)
  return blocks
}

// Plain text of nodes without footnote markers, edit links and media; line
// breaks become spaces but inline tags add none, keeping Korean particles
// attached to the linked names.
const proseOf = (nodes: { toString(): string }[]) => {
  const copy = parse(nodes.join("").replace(/<br\b[^>]*>/gi, " "))
  for (
    const noise of copy.querySelectorAll(
      "a[href^='#fn'], sup, script, style, noscript, img, iframe",
    )
  ) noise.remove()
  return copy.textContent.replace(/\s*\[(?:\d+|편집)\]/g, "").replace(
    /\s+/g,
    " ",
  )
    .trim()
}

const isInside = (element: HTMLElement, tagName: string) => {
  for (let node = element.parentNode; node; node = node.parentNode) {
    if (node.tagName === tagName) return true
  }
  return false
}

// Official overview text: a quote, a text cell above a label rule, or (for
// volume pages, where the info box ends in the in-game blurb) a plain text
// cell. Title rows (bold), media rows, service dates and wiki prose never
// match; event pages caption their videos in plain cells, so they opt out.
export const overviewSynopsis = (
  root: HTMLElement,
  options: { plainCell: boolean },
) => {
  const heading = root.querySelectorAll(HEADINGS)
    .find((candidate) => headingTitle(candidate) === "개요")
  if (!heading) return undefined
  for (const block of sectionBlocks(heading)) {
    for (const element of block.querySelectorAll("blockquote, td")) {
      if (isInside(element, "DETAILS")) continue
      const rule = element.childNodes.findIndex(isRule)
      if (
        element.tagName === "TD" &&
        (element.querySelector("strong, img, iframe, details, table") ||
          (rule < 0 && !options.plainCell))
      ) continue
      const text = proseOf(
        rule < 0 ? [element] : element.childNodes.slice(0, rule),
      )
      if (text) return text
    }
  }
  return undefined
}

// The banner image in the info box of a page's 개요 section.
export const overviewImage = (root: HTMLElement) => {
  const heading = root.querySelectorAll(HEADINGS)
    .find((candidate) => headingTitle(candidate) === "개요")
  if (!heading) return undefined
  for (const block of sectionBlocks(heading)) {
    const src = block.querySelectorAll("td img")
      .map((image) => image.getAttribute("src"))
      .find((src) => src?.startsWith("//") && !src.endsWith(".svg"))
    if (src) return `https:${src}`
  }
  return undefined
}

// A chapter heading is followed by a box: chapter number, a rule, then the
// bold chapter title and the in-game intro lines.
export const chapterIntro = (root: HTMLElement, anchor: string) => {
  const wanted = anchor.replace(/\s+/g, " ").trim()
  const heading = root.querySelectorAll(HEADINGS)
    .find((candidate) => headingTitle(candidate) === wanted)
  if (!heading) return undefined
  for (const block of sectionBlocks(heading)) {
    for (const cell of block.querySelectorAll("td")) {
      const head = cell.childNodes.map(isRule).lastIndexOf(true)
      if (head < 0) continue
      const intro = parse(cell.childNodes.slice(head + 1).join(""))
      for (const title of intro.querySelectorAll("strong")) title.remove()
      const text = proseOf([intro])
      if (text) return text
    }
  }
  return undefined
}

const pageUrl = (url: string) => {
  const page = new URL(url)
  page.hash = ""
  return page.href
}

const hasFragment = (link: Link) => new URL(link.url).hash !== ""

// Pages to read for an item: events and groups use the first link without a
// fragment; main chapters also use the chapter link's anchor on its page.
export const summarySources = (item: Pick<StoryItem, "kind" | "links">) => {
  if (!SUMMARY_KINDS.has(item.kind)) return undefined
  const page = item.links.find((link) => !hasFragment(link))
  const chapter = item.kind === "메인"
    ? item.links.find(hasFragment)
    : undefined
  if (!page && !chapter) return undefined
  return {
    urls: [
      ...new Set(
        [page, chapter].flatMap((link) => link ? [pageUrl(link.url)] : []),
      ),
    ],
    overviewUrl: page && pageUrl(page.url),
    chapter: chapter && {
      url: pageUrl(chapter.url),
      anchor: decodeURIComponent(new URL(chapter.url).hash.slice(1)),
    },
  }
}

export const itemSummary = (
  sources: NonNullable<ReturnType<typeof summarySources>>,
  pages: ReadonlyMap<string, HTMLElement | undefined>,
) => {
  const chapterPage = sources.chapter && pages.get(sources.chapter.url)
  const fromChapter = sources.chapter && chapterPage
    ? chapterIntro(chapterPage, sources.chapter.anchor)
    : undefined
  const overviewPage = sources.overviewUrl && pages.get(sources.overviewUrl)
  // Pages without a chapter (events, groups) keep the in-game blurb in the
  // box under their "스토리" heading when the overview has none.
  const summary = fromChapter ??
    (overviewPage
      ? overviewSynopsis(overviewPage, {
        plainCell: sources.chapter !== undefined,
      }) ?? (sources.chapter ? undefined : chapterIntro(overviewPage, "스토리"))
      : undefined)
  return summary && isKoreanText(summary) ? summary : undefined
}

// Every kind: mini and group summaries come from the story cards.
export const summaryCoverage = (items: Pick<StoryItem, "kind" | "summary">[]) =>
  [...STORY_KINDS].map((kind) => {
    const ofKind = items.filter((item) => item.kind === kind)
    return {
      kind,
      total: ofKind.length,
      matched: ofKind.filter((item) => item.summary).length,
    }
  })

// A redirect into a section of a larger page means the page is not this
// story's own, so it is skipped.
const loadSummaryPages = async (urls: string[], namu: NamuBrowser) => {
  const pages = new Map<string, HTMLElement | undefined>()
  for (const url of urls) {
    try {
      const loaded = await namu.load(url)
      if (new URL(loaded.url).hash) throw new Error("redirected to a section")
      pages.set(url, parse(loaded.html))
    } catch (error) {
      console.warn(`Skipping summary page ${url}: ${error}`)
      pages.set(url, undefined)
    }
  }
  return pages
}

export const enrichSummaries = async (
  items: StoryItem[],
  namu: NamuBrowser,
) => {
  const sourcesOf = items.map(summarySources)
  const pages = await loadSummaryPages([
    ...new Set(sourcesOf.flatMap((sources) => sources?.urls ?? [])),
  ], namu)
  return items.map((item, index) => {
    const sources = sourcesOf[index]
    const summary = sources && itemSummary(sources, pages)
    return summary ? { ...item, summary } : item
  })
}

// One namu page lists every image of a kind, so it is loaded once.
const loadNamuMap = <T>(
  namu: NamuBrowser,
  label: string,
  url: string,
  read: (root: HTMLElement) => Map<string, T>,
) =>
  settle(
    label,
    namu.load(url).then((loaded) => read(parse(loaded.html))),
    new Map<string, T>(),
  )

const withCover = (item: StoryItem, url: string | undefined) =>
  url ? { ...item, thumbnail: { url, fit: "cover" as const } } : item

// Every namu event page carries the same navbox; a Korean banner replaces the
// wiki's Japanese promo art.
export const enrichEventBanners = async (
  items: StoryItem[],
  namu: NamuBrowser,
) => {
  const link = items.filter((item) => item.kind === "이벤트")
    .flatMap((item) => item.links)
    .find((link) => namuPath(link).startsWith(EVENT_PAGE_PREFIX))
  if (!link) return items
  const banners = await loadNamuMap(
    namu,
    "event banners",
    pageUrl(link.url),
    parseEventBanners,
  )
  return items.map((item) =>
    item.kind === "이벤트"
      ? withCover(item, eventBannerFor(item, banners))
      : item
  )
}

// The info box on an event page announces the global service period, which the
// story-order table lags behind on.
export const parseGlobalServiceDate = (root: HTMLElement) => {
  const match = root.textContent.match(
    /글로벌 서비스:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/,
  )
  return match
    ? `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`
    : undefined
}

export const enrichGlobalReleases = async (
  items: StoryItem[],
  namu: NamuBrowser,
) => {
  const dated = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== "이벤트" || item.release.global.length > 0) continue
    const link = item.links.find((link) =>
      namuPath(link).startsWith(EVENT_PAGE_PREFIX)
    )
    if (!link) continue
    const date = await settle(
      `global release ${item.title}`,
      namu.load(pageUrl(link.url)).then((loaded) =>
        parseGlobalServiceDate(parse(loaded.html))
      ),
      undefined,
    )
    if (date) dated.set(item.id, date)
  }
  return items.map((item) => {
    const date = dated.get(item.id)
    return date
      ? { ...item, release: { ...item.release, global: [date] } }
      : item
  })
}

// Mini and group stories have no pages of their own; their official cards
// (image and blurb) live on the namu story page.
export const enrichStoryCards = async (
  items: StoryItem[],
  namu: NamuBrowser,
) => {
  const cards = await loadNamuMap(
    namu,
    "story cards",
    STORY_PAGE_URL,
    parseStoryCards,
  )
  return items.map((item) => {
    if (item.kind !== "미니" && item.kind !== "그룹") return item
    const card = storyCardFor(item, cards)
    if (!card) return item
    const summary = item.summary ?? card.summary
    return { ...withCover(item, card.image), ...(summary ? { summary } : {}) }
  })
}

// Volumes the wiki has no image for yet fall back to the banner in their namu
// page's info box.
export const enrichVolumeImages = async (
  items: StoryItem[],
  namu: NamuBrowser,
) => {
  const urls = [
    ...new Set(
      items.filter((item) => item.kind === "메인" && !item.thumbnail)
        .flatMap((item) => summarySources(item)?.overviewUrl ?? []),
    ),
  ]
  const images = new Map<string, string | undefined>()
  for (const url of urls) {
    images.set(
      url,
      await settle(
        `volume image ${url}`,
        namu.load(url).then((loaded) => overviewImage(parse(loaded.html))),
        undefined,
      ),
    )
  }
  return items.map((item) => {
    const url = item.kind === "메인" && !item.thumbnail
      ? summarySources(item)?.overviewUrl
      : undefined
    return withCover(item, url && images.get(url))
  })
}

type EventRow = {
  Id: number
  OriginalId: number
  Server: "JP" | "GL"
  NameEN?: string
  NameJP?: string
  Banner?: string
  Description?: string
}

export const parseEventRows = (renderedHtml: string) =>
  JSON.parse(stripHtml(renderedHtml).trim()) as EventRow[]

// The wiki lists an event once per server and per reissue (permanent, rerun);
// the row whose Id is the original id comes first.
const eventRow = (rows: EventRow[], id: string, server: EventRow["Server"]) => {
  const own = rows.filter((row) =>
    String(row.OriginalId) === id && row.Server === server
  )
  return own.find((row) => String(row.Id) === id) ?? own[0]
}

const bannerFile = (file: string | undefined) =>
  file ? [{ file, fit: "cover" as const }] : []

// English banners exist on the wiki for a handful of events only; every
// other event falls back to the in-game logo.
export const eventLocalization = (options: {
  id: string
  rows: EventRow[]
  names: Record<Locale, Record<string, string>>
}): Record<Locale, Localized & { candidates: ThumbnailCandidate[] }> => {
  const { id, rows, names } = options
  const jp = eventRow(rows, id, "JP")
  const gl = eventRow(rows, id, "GL")
  return {
    en: {
      series: names.en[id] ?? gl?.NameEN ?? jp?.NameEN,
      summary: jp?.Description?.replace(/\s+/g, " ").trim(),
      candidates: [
        ...["En", "en"].flatMap((tag) =>
          bannerFile(`File:Event Banner ${id} ${tag}.png`)
        ),
        { url: EVENT_LOGO_URL(id, "En"), fit: "contain" },
      ],
    },
    ja: {
      series: names.ja[id] ?? jp?.NameJP,
      candidates: [
        ...bannerFile(jp?.Banner),
        { url: EVENT_LOGO_URL(id, "Jp"), fit: "contain" },
      ],
    },
  }
}

const fetchEventRows = async () => {
  const response = await wikiApi<{ parse: { text: { "*": string } } }>({
    action: "parse",
    contentmodel: "wikitext",
    prop: "text",
    text: EVENT_ROWS_QUERY,
  })
  return parseEventRows(response.parse.text["*"])
}

// English and Japanese names, English summaries and banner images from
// SchaleDB and the Blue Archive wiki. No source has Japanese summaries.
export const enrichLocalizations = async (items: StoryItem[]) => {
  const [kr, en, ja, rows, mainText] = await Promise.all([
    settle("kr names", fetchLocalization("kr"), undefined),
    settle("en names", fetchLocalization("en"), undefined),
    settle("ja names", fetchLocalization("jp"), undefined),
    settle("event rows", fetchEventRows(), [] as EventRow[]),
    settle("main story page", fetchWikitext("Main_Story"), undefined),
  ])
  const names = {
    en: en?.EventName ?? {},
    ja: ja?.EventName ?? {},
  }
  const clubs = { en: en?.Club ?? {}, ja: ja?.Club ?? {} }
  const blurbs = mainText ? mainBlurbs(mainText) : new Map<string, string>()

  const pending = items.map((item) => {
    const parts: Partial<
      Record<Locale, Localized & { candidates?: ThumbnailCandidate[] }>
    > = {}
    if (item.kind === "이벤트" && kr) {
      const id = matchName(item.series, kr.EventName)
      if (id !== undefined) {
        Object.assign(parts, eventLocalization({ id, rows, names }))
      }
    } else if (item.kind === "그룹" && kr) {
      const code = matchName(item.series, kr.Club)
      if (code !== undefined) {
        parts.en = { series: clubs.en[code] }
        parts.ja = { series: clubs.ja[code] }
      }
    } else if (item.kind === "메인") {
      const summary = blurbs.get(
        mainVolumeKey(item.series, item.segmentId) ?? "",
      )
      if (summary) parts.en = { summary }
    }
    return parts
  })

  const candidates = pending.flatMap((parts) =>
    Object.values(parts).flatMap((part) => part.candidates ?? [])
  )
  const [thumbUrls, liveUrls] = await Promise.all([
    settle(
      "localized image info",
      fetchThumbUrls(candidates.flatMap((c) => "file" in c ? [c.file] : [])),
      new Map<string, string>(),
    ),
    settle(
      "localized event logos",
      fetchLiveUrls(candidates.flatMap((c) => "url" in c ? [c.url] : [])),
      new Set<string>(),
    ),
  ])

  return items.map((item, index) => {
    const l10n: StoryItem["l10n"] = {}
    for (const locale of ["en", "ja"] as const) {
      const part = pending[index][locale]
      if (!part) continue
      const { candidates = [], ...text } = part
      const thumbnail = pickThumbnail({ candidates, thumbUrls, liveUrls })
      const localized = { ...text, ...(thumbnail ? { thumbnail } : {}) }
      if (Object.values(localized).some(Boolean)) l10n[locale] = localized
    }
    return Object.keys(l10n).length > 0 ? { ...item, l10n } : item
  })
}

const main = async () => {
  const options = parseArgs(Deno.args)
  const namu = createNamuBrowser()
  try {
    const data = buildData(await fetchHtml(options, namu), options.source)
    data.items = await enrichThumbnails(data.items)
    data.items = await enrichEventBanners(data.items, namu)
    data.items = await enrichGlobalReleases(data.items, namu)
    data.items = await enrichStoryCards(data.items, namu)
    data.items = await enrichVolumeImages(data.items, namu)
    data.items = await enrichSummaries(data.items, namu)
    data.items = await enrichLocalizations(data.items)
    for (
      const { kind, series, matched, unmatched } of thumbnailCoverage(
        data.items,
      )
    ) {
      console.log(
        `Thumbnails ${kind}: ${matched}/${series} series` +
          (unmatched.length > 0 ? ` (missing: ${unmatched.join(", ")})` : ""),
      )
    }
    for (const { kind, matched, total } of summaryCoverage(data.items)) {
      console.log(`Summaries ${kind}: ${matched}/${total} items`)
    }
    for (const locale of ["en", "ja"] as const) {
      const counts = (["series", "summary", "thumbnail"] as const).map((key) =>
        `${key} ${
          data.items.filter((item) => item.l10n?.[locale]?.[key]).length
        }`
      )
      console.log(
        `Localized ${locale}: ${counts.join(", ")} of ${data.items.length}`,
      )
    }
    await Deno.writeTextFile(options.output, stringifyJsonc(data))
    console.log(`Wrote ${data.items.length} stories to ${options.output}`)
  } finally {
    await namu.close()
  }
}

if (import.meta.main) await main()
