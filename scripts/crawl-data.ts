#!/usr/bin/env -S deno -A
/// <reference lib="deno.ns" />

import { HTMLElement, parse } from "node-html-parser"

const SOURCE_URL = "https://namu.wiki/w/틀:블루 아카이브 스토리 시점순"
const OUTPUT_PATH = "src/data/blue-archive-story-order.jsonc"
const STORY_KINDS = new Set(["메인", "이벤트", "그룹", "미니"])
const SCHALEDB_LOCALIZATION_URL =
  "https://schaledb.com/data/kr/localization.min.json"
const WIKI_API_URL = "https://bluearchive.wiki/w/api.php"
const EVENT_LOGO_URL = (id: string) =>
  `https://schaledb.com/images/eventlogo/${id}_Kr.webp`
const EVENT_PROMO_QUERY =
  '{{#invoke:BlueBucket|get|events|select = Id, PageName, Promo|where = Server = "JP"|order by = Id ASC|limit = 1000|format = json|default = []}}'
const MIN_CONTAINED_NAME_LENGTH = 4
const IMAGEINFO_BATCH_SIZE = 50
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
}
type Thumbnail = { url: string; fit: "cover" | "contain" }
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

const fetchHtml = async (options: CliOptions) => {
  if (options.fromFile) return await Deno.readTextFile(options.fromFile)

  const response = await fetch(options.source, {
    headers: {
      "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.6,en;q=0.5",
      "user-agent": "Mozilla/5.0 (compatible; sefirot-story-order-crawler/1.0)",
    },
  })
  if (!response.ok) {
    throw new Error(`Failed to fetch ${options.source}: ${response.status}`)
  }
  return await response.text()
}

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

// Same key as mainBackgrounds: "<act>:<volume token>".
export const mainVolumeKey = (series: string, segmentId: string) => {
  const act = segmentId === "part-2" ? 2 : 1
  const volume = series.match(/^Vol\.(\d+)/)?.[1] ??
    (series.startsWith("프롤로그") ? (act === 2 ? "P" : "0") : undefined) ??
    (series.startsWith("Final.") ? "F" : undefined) ??
    (series.startsWith("Ex.") ? "EX" : undefined)
  return volume === undefined ? undefined : `${act}:${volume}`
}

// Volume headings of the Main Story page and the file that follows each one.
export const mainBackgrounds = (wikitext: string) => {
  const backgrounds = new Map<string, string | undefined>()
  let act = 0
  let key: string | undefined
  for (const line of wikitext.split("\n")) {
    const heading = line.match(/^(={2,3})\s*(.*?)\s*\1\s*$/)
    if (heading?.[1] === "==") {
      act = Number(heading[2].match(/^Act (\d+)/)?.[1] ?? 0)
      key = undefined
    } else if (heading) {
      const volume = heading[2].match(/^\[\[\/(?:Act \d+\/)?Volume ([^|\]]+)\|/)
        ?.[1] ?? heading[2].match(/^Volume (\w+)/)?.[1]
      key = volume === undefined ? undefined : `${act}:${volume.trim()}`
      if (key !== undefined) backgrounds.set(key, undefined)
    } else if (key !== undefined && backgrounds.get(key) === undefined) {
      const file = line.match(/\[\[(File:[^|\]]+)/)?.[1]
      if (file) backgrounds.set(key, file)
    }
  }
  return backgrounds
}

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

const wikiApi = (params: Record<string, string>) =>
  fetchJson<any>(
    `${WIKI_API_URL}?${new URLSearchParams({ format: "json", ...params })}`,
  )

const fetchWikitext = async (page: string) => {
  const response = await wikiApi({
    action: "parse",
    page,
    prop: "wikitext",
    formatversion: "2",
  })
  return response.parse?.wikitext as string | undefined
}

const fetchEventPromos = async () => {
  const response = await wikiApi({
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
    const response = await wikiApi({
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
      fetchJson<
        { EventName: Record<string, string>; Club: Record<string, string> }
      >(
        SCHALEDB_LOCALIZATION_URL,
      ),
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

const main = async () => {
  const options = parseArgs(Deno.args)
  const html = await fetchHtml(options)
  const data = buildData(html, options.source)
  data.items = await enrichThumbnails(data.items)
  for (
    const { kind, series, matched, unmatched } of thumbnailCoverage(data.items)
  ) {
    console.log(
      `Thumbnails ${kind}: ${matched}/${series} series` +
        (unmatched.length > 0 ? ` (missing: ${unmatched.join(", ")})` : ""),
    )
  }
  await Deno.writeTextFile(options.output, stringifyJsonc(data))
  console.log(`Wrote ${data.items.length} stories to ${options.output}`)
}

if (import.meta.main) await main()
