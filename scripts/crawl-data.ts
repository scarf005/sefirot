#!/usr/bin/env -S deno -A
/// <reference lib="deno.ns" />

import { HTMLElement, parse } from "node-html-parser"

const SOURCE_URL = "https://namu.wiki/w/틀:블루 아카이브 스토리 시점순"
const OUTPUT_PATH = "src/data/blue-archive-story-order.jsonc"
const STORY_KINDS = new Set(["메인", "이벤트", "그룹", "미니"])
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
}
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

const main = async () => {
  const options = parseArgs(Deno.args)
  const html = await fetchHtml(options)
  const data = buildData(html, options.source)
  await Deno.writeTextFile(options.output, stringifyJsonc(data))
  console.log(`Wrote ${data.items.length} stories to ${options.output}`)
}

if (import.meta.main) await main()
