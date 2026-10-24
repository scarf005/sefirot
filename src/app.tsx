import "./app.css"
import { i18n, type MessageDescriptor } from "@lingui/core"
import { msg, t } from "@lingui/core/macro"
import { computed, signal } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { parse } from "@std/jsonc"
import { isKoreanText } from "./korean-text.ts"
import { locale, localeNames, setLocale } from "./i18n.ts"
import { locales, localizeStory } from "./story-l10n.ts"
import storyOrderJsonc from "./data/blue-archive-story-order.jsonc?raw"
import {
  eraseStoryHistory,
  loadStoryHistory,
  parseStoryHistory,
  saveStoryHistory,
  serializeStoryHistory,
} from "./story-history.ts"
import {
  adjacentVisibleId,
  nextUnreadId,
  readProgress,
  selectionAfterFilter,
} from "./story-navigation.ts"
import {
  importanceOf,
  isMinorStory,
  isUnreleasedInKorea,
  laneForItem,
  type StoryItem as ClassifiedStoryItem,
} from "./story-classification.ts"
import {
  type GraphLink,
  type GraphNode,
  graphTopOffset,
  type LaneColumn,
  layoutStoryGraph,
  narrowLanePitch,
  normalLanePitch,
  rowGap,
} from "./story-graph.ts"
import abydosEmblem from "./assets/school-emblems/abydos.png"
import etcEmblem from "./assets/school-emblems/etc.png"
import gehennaEmblem from "./assets/school-emblems/gehenna.png"
import highlanderEmblem from "./assets/school-emblems/highlander.png"
import hyakkiyakoEmblem from "./assets/school-emblems/hyakkiyako.png"
import millenniumEmblem from "./assets/school-emblems/millennium.png"
import redWinterEmblem from "./assets/school-emblems/redwinter.png"
import shanhaijingEmblem from "./assets/school-emblems/shanhaijing.png"
import srtEmblem from "./assets/school-emblems/srt.png"
import trinityEmblem from "./assets/school-emblems/trinity.png"
import valkyrieEmblem from "./assets/school-emblems/valkyrie.png"
import wildhuntEmblem from "./assets/school-emblems/wildhunt.png"

type StoryRelease = { japan?: string[]; global?: string[]; krDub?: string[] }
type StoryLink = { label: string; url: string }
type StoryThumbnail = { url: string; fit: "cover" | "contain" }
type StoryItem = ClassifiedStoryItem & {
  release: StoryRelease
  links: StoryLink[]
  thumbnail?: StoryThumbnail
  summary?: string
  l10n?: Partial<
    Record<
      "en" | "ja",
      { series?: string; summary?: string; thumbnail?: StoryThumbnail }
    >
  >
}
type StoryTreeNode = { id: string; itemId?: string; children?: StoryTreeNode[] }
type StoryData = {
  generatedAt: string
  extraction: { itemCount: number }
  sources: { label: string; url: string }[]
  tree: StoryTreeNode
  items: StoryItem[]
}
const storyOrder = parse(storyOrderJsonc) as unknown as StoryData
const itemsById = new Map(storyOrder.items.map((item) => [item.id, item]))
const collectTreeItems = (node: StoryTreeNode): StoryItem[] => {
  const current = node.itemId ? itemsById.get(node.itemId) : undefined
  return [
    ...(current ? [current] : []),
    ...(node.children ?? []).flatMap(collectTreeItems),
  ]
}
const treeOrderedItems = collectTreeItems(storyOrder.tree)
const orderedItems = treeOrderedItems.length > 0
  ? treeOrderedItems
  : storyOrder.items.slice().sort((a, b) => a.order - b.order)
const kindOptions = ["전체", ...new Set(orderedItems.map((item) => item.kind))]

// Data values stay Korean; these map them to the viewer's language.
const kindMessages: Record<string, MessageDescriptor> = {
  전체: msg`전체`,
  메인: msg`메인`,
  이벤트: msg`이벤트`,
  그룹: msg`그룹`,
  미니: msg`미니`,
}
const laneMessages: Record<string, MessageDescriptor> = {
  main: msg`메인 스토리`,
  hyakkiyako: msg`백귀야행`,
  abydos: msg`아비도스`,
  gehenna: msg`게헨나`,
  millennium: msg`밀레니엄`,
  trinity: msg`트리니티`,
  "red-winter": msg`붉은겨울`,
  shanhaijing: msg`산해경`,
  valkyrie: msg`발키리/SRT`,
  highlander: msg`하이랜더`,
  wildhunt: msg`와일드헌트`,
  other: msg`기타/콜라보`,
}
const importanceMessages: Record<string, MessageDescriptor> = {
  상: msg`상`,
  중: msg`중`,
  중하: msg`중하`,
  하: msg`하`,
  없음: msg`없음`,
}
const segmentMessages: Record<string, MessageDescriptor> = {
  "1부 시작~최종편": msg`1부 시작~최종편`,
  "최종편 이후~데카그라마톤": msg`최종편 이후~데카그라마톤`,
  "2부": msg`2부`,
}
const translated = (
  messages: Record<string, MessageDescriptor>,
  key: string,
) => messages[key] ? i18n._(messages[key]) : key
const laneLabel = (item: StoryItem) =>
  translated(laneMessages, laneForItem(item).id)
// Stands in for the link inside a sentence, so translators keep word order.
const linkMarker = "\u0000"
const view = (item: StoryItem) => localizeStory(item, locale.value)
const validItemIds = new Set(orderedItems.map((item) => item.id))

const getHistoryStorage = () => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const loadReadItemIds = () => {
  const storage = getHistoryStorage()
  if (!storage) return new Set<string>()
  try {
    return loadStoryHistory({ storage, validIds: validItemIds })
  } catch {
    return new Set<string>()
  }
}

// View options are per-browser conveniences; storage may be unavailable.
const loadSetting = (key: string, fallback: string) => {
  try {
    return getHistoryStorage()?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const zoomLevels = [1, 0.75, 0.5]
const phoneScreen = globalThis.matchMedia?.("(max-width: 980px)").matches ??
  false
const savedZoom = Number(
  loadSetting("sefirot-graph-zoom", phoneScreen ? "75" : "100"),
) / 100

const selectedKind = signal("전체")
const searchText = signal("")
const hideMinor = signal(false)
const readItemIds = signal<ReadonlySet<string>>(loadReadItemIds())
// Opening the page picks up where the reader left off.
const selectedItemId = signal(
  nextUnreadId(orderedItems.map((item) => item.id), readItemIds.value) ??
    orderedItems[0]?.id ?? "",
)
const settingsOpen = signal(false)
const historyStatus = signal("")
// Summaries of unread stories are hidden unless the viewer turned it off.
const hideSpoilers = signal(
  loadSetting("sefirot-hide-spoilers", "on") !== "off",
)
const graphZoom = signal(zoomLevels.includes(savedZoom) ? savedZoom : 1)
const narrowLanes = signal(
  loadSetting("sefirot-lane-spacing", "normal") === "narrow",
)
const pinMain = signal(loadSetting("sefirot-pin-main", "off") === "on")
const revealedSummaryId = signal("")
const sheetCollapsed = signal(false)
const filtersOpen = signal(false)

const saveSetting = (key: string, value: string) => {
  try {
    getHistoryStorage()?.setItem(key, value)
  } catch {
    historyStatus.value = t`설정을 저장하지 못했습니다.`
  }
}

const setHideSpoilers = (hide: boolean) => {
  hideSpoilers.value = hide
  saveSetting("sefirot-hide-spoilers", hide ? "on" : "off")
}

const setGraphZoom = (zoom: number) => {
  graphZoom.value = zoom
  saveSetting("sefirot-graph-zoom", String(zoom * 100))
}

const setNarrowLanes = (narrow: boolean) => {
  narrowLanes.value = narrow
  saveSetting("sefirot-lane-spacing", narrow ? "narrow" : "normal")
}

const setPinMain = (pin: boolean) => {
  pinMain.value = pin
  saveSetting("sefirot-pin-main", pin ? "on" : "off")
}

const filteredItems = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  return orderedItems.filter((item) => {
    if (hideMinor.value && isMinorStory(item)) return false
    const matchesKind = selectedKind.value === "전체" ||
      item.kind === selectedKind.value
    const shown = view(item)
    const matchesQuery = query.length === 0 || [
      shown.label,
      item.label,
      item.segmentName,
      translated(segmentMessages, item.segmentName),
      item.kind,
      translated(kindMessages, item.kind),
      shown.series,
      item.series,
      shown.chapter,
      item.chapter,
      item.episodes,
      laneForItem(item).label,
      laneLabel(item),
    ].some((value) => value.toLocaleLowerCase().includes(query))
    return matchesKind && matchesQuery
  })
})
// Branches leave the main spine in the gap above the target's row and drop
// into the card from above, so they never pass behind another card.
const linkPath = ({ source, target, kind }: GraphLink<StoryItem>) => {
  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height
  const targetX = target.x + target.width / 2
  if (kind === "branch") {
    return `M ${sourceX} ${sourceY} V ${
      target.y - rowGap / 2
    } H ${targetX} V ${target.y}`
  }
  return `M ${sourceX} ${sourceY} V ${target.y}`
}

// Splits a story into a small series line and a chapter line, dropping the
// series when it only repeats the chapter.
const storyLines = (item: StoryItem) => {
  const title = `${item.chapter} · ${item.episodes}`
  return item.series === item.chapter
    ? { title }
    : { series: item.series, title }
}

// Main-story cards keep the chapter on its own line and move the episode
// range to the small line; side-story cards are too small for either.
const linkedEventPrefix = "메인 스토리 연계 이벤트 "
const graphNodeLines = (item: StoryItem) => {
  if (item.title.startsWith(linkedEventPrefix)) {
    return {
      series: t`메인 스토리 연계 이벤트`,
      title: item.title.slice(linkedEventPrefix.length),
    }
  }
  if (item.kind !== "메인") return { title: item.title }
  const series = item.series === item.chapter
    ? item.episodes
    : `${item.series} · ${item.episodes}`
  return { series, title: item.chapter }
}

const kindClass = (kind: string) => {
  if (kind === "메인") return "kind-main"
  if (kind === "이벤트") return "kind-event"
  if (kind === "그룹") return "kind-group"
  if (kind === "미니") return "kind-mini"
  return "kind-other"
}

const thumbnailStyle = (thumbnail: StoryThumbnail | undefined) =>
  thumbnail ? { "--thumb": `url("${thumbnail.url}")` } : undefined

const today = new Date().toLocaleDateString("sv-SE")
const isUnreleased = (item: StoryItem) => isUnreleasedInKorea(item, today)

const releaseRows = (item: StoryItem) => {
  const rows: [string, string[] | undefined][] = [
    [t`일본`, item.release.japan],
    [t`글로벌`, isUnreleased(item) ? [t`미출시`] : item.release.global],
    [t`한국어 더빙`, item.release.krDub],
  ]
  return rows.flatMap(([label, values]) =>
    values && values.length > 0 ? [[label, values.join(", ")]] : []
  )
}

const generatedAtLabel = new Date(storyOrder.generatedAt).toLocaleString(
  "sv-SE",
  {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
)

const orderedItemIds = orderedItems.map((item) => item.id)
const progress = computed(() => readProgress(orderedItemIds, readItemIds.value))
const hiddenLanes = signal<ReadonlySet<string>>(new Set())
const storyGraph = computed(() =>
  layoutStoryGraph(filteredItems.value, {
    collapsedLaneIds: hiddenLanes.value,
    lanePitch: narrowLanes.value ? narrowLanePitch : normalLanePitch,
  })
)
const visibleItemIds = computed(() =>
  storyGraph.value.nodes.map((node) => node.id)
)

// Read counts per school over every story, regardless of filters.
const laneProgress = computed(() => {
  const counts = new Map<string, { read: number; total: number }>()
  for (const item of orderedItems) {
    const id = laneForItem(item).id
    const count = counts.get(id) ?? { read: 0, total: 0 }
    count.total += 1
    if (readItemIds.value.has(item.id)) count.read += 1
    counts.set(id, count)
  }
  return counts
})

// The main story has no school, so its heading stays text only.
const laneEmblems: Record<string, string[]> = {
  hyakkiyako: [hyakkiyakoEmblem],
  abydos: [abydosEmblem],
  gehenna: [gehennaEmblem],
  millennium: [millenniumEmblem],
  trinity: [trinityEmblem],
  "red-winter": [redWinterEmblem],
  shanhaijing: [shanhaijingEmblem],
  valkyrie: [valkyrieEmblem, srtEmblem],
  highlander: [highlanderEmblem],
  wildhunt: [wildhuntEmblem],
  other: [etcEmblem],
}
// Starts at 1 so the first render scrolls to the initial selection.
const scrollTick = signal(1)

const prefersReducedMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

// Scrolls only the tree panel (not the page) so the node sits in the middle of
// the part of the panel that is visible below the sticky lane headings; the
// horizontal position only changes when the node is out of view.
const centerInPanel = (
  panel: HTMLElement,
  node: HTMLElement,
  instant: boolean,
) => {
  const headings = panel.querySelector<HTMLElement>(".lane-headings")
  const headingHeight = headings?.offsetHeight ?? 0
  const coveredBottom =
    parseFloat(getComputedStyle(panel).scrollPaddingBottom) || 0
  const panelBox = panel.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  const visibleHeight = panel.clientHeight - headingHeight - coveredBottom
  // A pinned main lane covers the left edge for every other card.
  const coveredLeft = node.closest(".main-layer")
    ? 0
    : panel.querySelector(".main-layer.pinned")?.getBoundingClientRect()
      .width ?? 0
  const visibleWidth = panel.clientWidth - coveredLeft
  const fitsHorizontally = nodeBox.left >= panelBox.left + coveredLeft &&
    nodeBox.right <= panelBox.left + panel.clientWidth
  panel.scrollTo({
    top: panel.scrollTop + nodeBox.top - panelBox.top - headingHeight -
      (visibleHeight - nodeBox.height) / 2,
    left: fitsHorizontally ? panel.scrollLeft : panel.scrollLeft +
      nodeBox.left - panelBox.left - coveredLeft -
      (visibleWidth - nodeBox.width) / 2,
    behavior: instant || prefersReducedMotion() ? "auto" : "smooth",
  })
}

const selectItem = (id: string) => {
  selectedItemId.value = id
  sheetCollapsed.value = false
  scrollTick.value += 1
}

const ensureSelectionVisible = () => {
  const id = selectionAfterFilter(visibleItemIds.value, selectedItemId.value)
  if (id !== selectedItemId.value) selectItem(id)
}

const selectNextUnread = () => {
  const id = nextUnreadId(orderedItemIds, readItemIds.value)
  if (!id) return
  if (!visibleItemIds.value.includes(id)) {
    searchText.value = ""
    selectedKind.value = "전체"
    hideMinor.value = false
    hiddenLanes.value = new Set()
  }
  selectItem(id)
}

const toggleLane = (id: string) => {
  const next = new Set(hiddenLanes.value)
  if (!next.delete(id)) next.add(id)
  hiddenLanes.value = next
  ensureSelectionVisible()
}

const moveSelection = (step: 1 | -1) => {
  const id = adjacentVisibleId(visibleItemIds.value, selectedItemId.value, step)
  if (id) selectItem(id)
}

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName))

const keyboardSteps: Record<string, 1 | -1> = {
  ArrowDown: 1,
  j: 1,
  ArrowUp: -1,
  k: -1,
}

const selectedItem = computed(() =>
  itemsById.get(selectedItemId.value) ?? filteredItems.value[0] ??
    orderedItems[0]
)

const readStateLabel = (isRead: boolean) => isRead ? t`읽음` : t`안 읽음`

const persistReadItemIds = (ids: ReadonlySet<string>) => {
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = t`브라우저에 저장할 수 없습니다.`
    return false
  }
  try {
    saveStoryHistory({ storage, readItemIds: ids })
    return true
  } catch {
    historyStatus.value = t`저장하지 못했습니다.`
    return false
  }
}

const toggleReadItem = (id: string) => {
  const nextIds = new Set(readItemIds.value)
  if (nextIds.has(id)) {
    nextIds.delete(id)
  } else {
    nextIds.add(id)
  }
  readItemIds.value = nextIds
  if (persistReadItemIds(nextIds)) {
    historyStatus.value = nextIds.has(id)
      ? t`읽음으로 바꿨습니다.`
      : t`안 읽음으로 바꿨습니다.`
  }
}

const eraseReadHistory = () => {
  if (!globalThis.confirm(t`읽음 기록을 모두 지울까요?`)) return
  readItemIds.value = new Set()
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = t`기록을 지웠습니다.`
    return
  }
  try {
    eraseStoryHistory({ storage })
    historyStatus.value = t`기록을 지웠습니다.`
  } catch {
    historyStatus.value = t`기록을 지우지 못했습니다.`
  }
}

const exportReadHistory = () => {
  try {
    const blob = new Blob([serializeStoryHistory(readItemIds.value)], {
      type: "application/json",
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "sefirot-story-history.json"
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
    historyStatus.value = t`기록을 내보냈습니다.`
  } catch {
    historyStatus.value = t`기록을 내보내지 못했습니다.`
  }
}

const importReadHistoryFile = async (file?: File) => {
  if (!file) return
  try {
    const importedIds = parseStoryHistory(await file.text(), validItemIds)
    readItemIds.value = importedIds
    if (persistReadItemIds(importedIds)) {
      historyStatus.value = t`기록 ${importedIds.size}개를 가져왔습니다.`
    }
  } catch {
    historyStatus.value = t`파일을 읽지 못했습니다.`
  }
}

export const App = () => {
  const graph = storyGraph.value
  const currentItem = selectedItem.value
  const shownItem = view(currentItem)
  const currentItemRead = readItemIds.value.has(currentItem.id)
  const currentLines = storyLines(shownItem)
  const summary = shownItem.summary &&
      (locale.value !== "ko" || isKoreanText(shownItem.summary))
    ? shownItem.summary
    : undefined
  const { read: readCount, total: totalCount } = progress.value
  const treeRef = useRef<HTMLElement>(null)
  const keyboardMoved = useRef(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && settingsOpen.value) {
        settingsOpen.value = false
        return
      }
      const step = keyboardSteps[event.key]
      if (
        !step || event.altKey || event.ctrlKey || event.metaKey ||
        isTypingTarget(event.target)
      ) return
      event.preventDefault()
      keyboardMoved.current = true
      moveSelection(step)
    }
    // A press anywhere outside the settings closes its menu.
    const onPointerDown = (event: PointerEvent) => {
      if (
        settingsOpen.value &&
        !(event.target instanceof Element && event.target.closest(".settings"))
      ) settingsOpen.value = false
    }
    globalThis.addEventListener("keydown", onKeyDown)
    globalThis.addEventListener("pointerdown", onPointerDown)
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown)
      globalThis.removeEventListener("pointerdown", onPointerDown)
    }
  }, [])

  useEffect(() => {
    const node = treeRef.current?.querySelector<HTMLElement>(
      `[data-node-id="${selectedItemId.value}"]`,
    )
    if (!node) return
    centerInPanel(treeRef.current!, node, scrollTick.value === 1)
    if (keyboardMoved.current) {
      keyboardMoved.current = false
      node.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
    }
  }, [scrollTick.value])

  const sourceNotice =
    t`스토리 순서와 메모는 ${linkMarker}(CC BY-NC-SA 2.0 KR)에서 가져왔습니다. 권리자 요청시 해당 자료를 내리겠습니다.`
      .split(linkMarker)
  const zoom = graphZoom.value
  const graphHeight = graph.height - graphTopOffset
  const mainColumn = graph.lanes.find((column) =>
    column.lane.id === "main" && !column.collapsed
  )
  // Main cards are wider than their column; the layer keeps room for them
  // and for the selection glow.
  const mainRight = mainColumn
    ? Math.max(
      mainColumn.center + mainColumn.width / 2,
      ...graph.nodes.filter((node) => node.lane.id === "main")
        .map((node) => node.x + node.width + 8),
    )
    : 0
  // Zoomed out, lanes are too close for names, so headings keep emblem and count.
  const compactHeadings =
    (narrowLanes.value ? narrowLanePitch : normalLanePitch) *
        zoom < 150

  const laneHeading = (column: LaneColumn, left?: number) => {
    const { lane, collapsed } = column
    const count = laneProgress.value.get(lane.id)
    const countLabel = count ? `${count.read}/${count.total}` : ""
    const label = translated(laneMessages, lane.id)
    const emblems = laneEmblems[lane.id] ?? []
    return (
      <button
        key={lane.id}
        type="button"
        class={`lane-heading ${collapsed ? "collapsed" : ""}`}
        style={left === undefined ? undefined : { left: `${left}px` }}
        aria-label={`${label} ${countLabel}, ${collapsed ? t`숨김` : t`표시`}`}
        title={`${label} ${countLabel}`}
        onClick={() => toggleLane(lane.id)}
      >
        {emblems.map((emblem) => (
          <span
            key={emblem}
            class="lane-emblem"
            style={{ "--emblem": `url("${emblem}")` }}
            aria-hidden="true"
          />
        ))}
        {(emblems.length === 0 || (!collapsed && !compactHeadings)) && (
          <span>{label}</span>
        )}
        {!collapsed && (emblems.length > 0 || !compactHeadings) && (
          <small class="lane-count">{countLabel}</small>
        )}
      </button>
    )
  }

  const arrowMarkers = (kinds: GraphLink<StoryItem>["kind"][]) => (
    <defs>
      {kinds.map((kind) => (
        <marker
          id={`arrow-${kind}`}
          key={kind}
          class={`link-arrow ${kind}`}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          markerHeight="10"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      ))}
    </defs>
  )

  const linkView = (link: GraphLink<StoryItem>) => (
    <path
      key={`${link.kind}-${link.source.id}-${link.target.id}`}
      class={link.kind}
      d={linkPath(link)}
      marker-end={`url(#arrow-${link.kind})`}
    />
  )

  const nodeView = (node: GraphNode<StoryItem>) => {
    const selected = node.id === selectedItemId.value
    const isRead = readItemIds.value.has(node.id)
    const shown = view(node)
    const lines = graphNodeLines(shown)
    return (
      <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
        <foreignObject width={node.width} height={node.height}>
          <div
            class={`story-node ${kindClass(node.kind)} ${
              selected ? "selected" : ""
            } ${isRead ? "read" : "unread"} ${
              shown.thumbnail ? `thumb-${shown.thumbnail.fit}` : ""
            }`}
            data-node-id={node.id}
          >
            <button
              class="node-select"
              type="button"
              aria-current={selected}
              aria-label={`${shown.label}, ${readStateLabel(isRead)}${
                isUnreleased(node) ? `, ${t`미출시`}` : ""
              }`}
              title={shown.label}
              onClick={() => selectItem(node.id)}
            >
              {/* Lazy so only cards near the view download art. */}
              {shown.thumbnail && (
                <img
                  class="node-art"
                  src={shown.thumbnail.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              )}
              {(isRead || isUnreleased(node)) && (
                <span
                  class={`node-tag ${isRead ? "" : "unreleased"}`}
                  aria-hidden="true"
                >
                  {isRead ? t`읽음` : t`미출시`}
                </span>
              )}
              <span class="node-title">
                {lines.series && (
                  <small class="node-series">{lines.series}</small>
                )}
                <span class="node-name">{lines.title}</span>
              </span>
            </button>
          </div>
        </foreignObject>
      </g>
    )
  }

  return (
    <main class="story-visualizer">
      <header class={`top-bar ${filtersOpen.value ? "filters-open" : ""}`}>
        <h1>{t`스토리`}</h1>
        {/* Phones fold search and filters behind this toggle. */}
        <button
          class={`filter-toggle ${
            searchText.value || selectedKind.value !== "전체" ||
              hideMinor.value
              ? "active"
              : ""
          }`}
          type="button"
          aria-label={t`필터`}
          aria-expanded={filtersOpen.value}
          onClick={() => filtersOpen.value = !filtersOpen.value}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.74 4.74-1.41 1.41-4.74-4.74A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" />
          </svg>
        </button>
        <input
          class="search-input"
          type="search"
          aria-label={t`검색`}
          value={searchText.value}
          placeholder={t`검색`}
          onInput={(event) => {
            searchText.value = event.currentTarget.value
            ensureSelectionVisible()
          }}
        />
        <div class="filters">
          <div class="kind-tabs" role="group" aria-label={t`종류`}>
            {kindOptions.map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={selectedKind.value === kind}
                onClick={() => {
                  selectedKind.value = kind
                  ensureSelectionVisible()
                }}
              >
                {translated(kindMessages, kind)}
              </button>
            ))}
          </div>
          <button
            class="minor-toggle"
            type="button"
            aria-pressed={hideMinor.value}
            title={t`중요도 하·중하·없음 숨기기`}
            onClick={() => {
              hideMinor.value = !hideMinor.value
              ensureSelectionVisible()
            }}
          >
            {t`중요한 것만`}
          </button>
        </div>
        <div
          class="progress"
          role="progressbar"
          aria-label={t`읽음`}
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={readCount}
        >
          <span class="progress-text">
            {t`읽음`} <strong>{readCount}</strong> / {totalCount}
          </span>
          <span class="progress-track">
            <span
              class="progress-fill"
              style={{
                width: `${totalCount ? (readCount / totalCount) * 100 : 0}%`,
              }}
            />
          </span>
        </div>
        <button
          class="next-unread-button"
          type="button"
          disabled={readCount === totalCount}
          onClick={selectNextUnread}
        >
          {t`이어 보기`}
        </button>
        <div class="settings">
          <button
            class="settings-button"
            type="button"
            aria-label={t`설정`}
            aria-expanded={settingsOpen.value}
            onClick={() => settingsOpen.value = !settingsOpen.value}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.3 2h3.4l.5 2.6 1.7.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.7 2.6.5v3.4l-2.6.5-.7 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.7-.5 2.6h-3.4l-.5-2.6-1.7-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.7L2 13.7v-3.4l2.6-.5.7-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.7zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
            </svg>
          </button>
          {settingsOpen.value && (
            <div class="settings-menu" role="dialog" aria-label={t`설정`}>
              <div class="settings-row">
                <span>{t`언어`}</span>
                <div class="segmented" role="group" aria-label={t`언어`}>
                  {locales.map((code) => (
                    <button
                      key={code}
                      type="button"
                      lang={code}
                      aria-pressed={locale.value === code}
                      onClick={() => setLocale(code)}
                    >
                      {localeNames[code]}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={exportReadHistory}>
                {t`기록 내보내기`}
              </button>
              <label class="settings-file-button">
                {t`기록 가져오기`}
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    event.currentTarget.value = ""
                    void importReadHistoryFile(file)
                  }}
                />
              </label>
              <button class="danger" type="button" onClick={eraseReadHistory}>
                {t`기록 지우기`}
              </button>
              <label class="settings-check">
                <input
                  type="checkbox"
                  checked={hideSpoilers.value}
                  onChange={(event) =>
                    setHideSpoilers(event.currentTarget.checked)}
                />
                {t`안 읽은 줄거리 가리기`}
              </label>
              <div class="settings-row">
                <span>{t`확대`}</span>
                <div class="segmented" role="group" aria-label={t`확대`}>
                  {zoomLevels.map((level) => (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={graphZoom.value === level}
                      onClick={() => setGraphZoom(level)}
                    >
                      {level * 100}%
                    </button>
                  ))}
                </div>
              </div>
              <div class="settings-row">
                <span>{t`레인 간격`}</span>
                <div class="segmented" role="group" aria-label={t`레인 간격`}>
                  <button
                    type="button"
                    aria-pressed={!narrowLanes.value}
                    onClick={() =>
                      setNarrowLanes(false)}
                  >
                    {t`보통`}
                  </button>
                  <button
                    type="button"
                    aria-pressed={narrowLanes.value}
                    onClick={() =>
                      setNarrowLanes(true)}
                  >
                    {t`좁게`}
                  </button>
                </div>
              </div>
              <label class="settings-check">
                <input
                  type="checkbox"
                  checked={pinMain.value}
                  onChange={(event) =>
                    setPinMain(event.currentTarget.checked)}
                />
                {t`메인 스토리 고정`}
              </label>
              <p role="status">
                {historyStatus.value}
              </p>
            </div>
          )}
        </div>
      </header>

      <section class="content-grid">
        <section
          class="tree-panel"
          ref={treeRef}
          aria-label={t`스토리 순서`}
        >
          {graph.nodes.length === 0 && (
            <p class="empty-state" role="status">{t`결과 없음`}</p>
          )}
          {/* Headings stay while lanes are hidden so they can be shown again. */}
          <div
            class={`lane-headings ${compactHeadings ? "compact" : ""}`}
            hidden={filteredItems.value.length === 0}
            style={{ width: `${graph.width * zoom}px` }}
          >
            {mainColumn && (
              <div
                class={`main-heading ${pinMain.value ? "pinned" : ""}`}
                style={{
                  width: `${mainRight * zoom}px`,
                  paddingLeft: `${
                    (mainColumn.center - mainColumn.width / 2) * zoom
                  }px`,
                }}
              >
                {laneHeading(mainColumn)}
              </div>
            )}
            {graph.lanes.filter((column) => column !== mainColumn).map((
              column,
            ) => laneHeading(column, column.center * zoom))}
          </div>
          <div
            class="graph-layers"
            hidden={graph.nodes.length === 0}
            style={{
              width: `${graph.width * zoom}px`,
              height: `${graphHeight * zoom}px`,
            }}
          >
            <svg
              class="story-tree"
              role="group"
              aria-label={t`스토리 순서도`}
              width={graph.width * zoom}
              height={graphHeight * zoom}
              viewBox={`0 ${graphTopOffset} ${graph.width} ${graphHeight}`}
            >
              {arrowMarkers(["lane", "branch"])}
              <g class="links">
                {/* Branches first so lane links cover their stems. */}
                {(["branch", "lane"] as const).flatMap((kind) =>
                  graph.links.filter((link) => link.kind === kind)
                ).map(linkView)}
              </g>
              <g class="nodes">
                {graph.nodes.filter((node) => node.lane.id !== "main").map(
                  nodeView,
                )}
              </g>
            </svg>
            {/* The main lane is its own layer so it can stay pinned left. */}
            {mainColumn && (
              <svg
                class={`story-tree main-layer ${pinMain.value ? "pinned" : ""}`}
                role="group"
                aria-label={t`메인 스토리`}
                width={mainRight * zoom}
                height={graphHeight * zoom}
                viewBox={`0 ${graphTopOffset} ${mainRight} ${graphHeight}`}
              >
                {arrowMarkers(["main"])}
                <g class="links">
                  {graph.links.filter((link) => link.kind === "main").map(
                    linkView,
                  )}
                </g>
                <g class="nodes">
                  {graph.nodes.filter((node) => node.lane.id === "main").map(
                    nodeView,
                  )}
                </g>
              </svg>
            )}
          </div>
        </section>

        <aside
          class={`details-panel ${sheetCollapsed.value ? "collapsed" : ""}`}
          aria-label={t`스토리 정보`}
        >
          {/* Bottom-sheet handle, shown on narrow screens only. */}
          <button
            class="sheet-handle"
            type="button"
            aria-label={sheetCollapsed.value ? t`펼치기` : t`접기`}
            aria-expanded={!sheetCollapsed.value}
            onClick={() => sheetCollapsed.value = !sheetCollapsed.value}
          />
          <div class="detail-heading">
            <span class={`kind-pill ${kindClass(currentItem.kind)}`}>
              {translated(kindMessages, currentItem.kind)}
            </span>
            <span class="detail-state">
              #{currentItem.order} · {readStateLabel(currentItemRead)}
            </span>
          </div>
          {shownItem.thumbnail && (
            <div
              class={`detail-thumbnail thumb-${shownItem.thumbnail.fit}`}
              style={thumbnailStyle(shownItem.thumbnail)}
            />
          )}
          <h2>
            {currentLines.series && <small>{currentLines.series}</small>}
            {currentLines.title}
          </h2>
          <button
            class={`detail-read-toggle ${currentItemRead ? "read" : "unread"}`}
            type="button"
            onClick={() => toggleReadItem(currentItem.id)}
          >
            {currentItemRead ? t`읽음 해제` : t`읽음 표시`}
          </button>
          {summary && (
            hideSpoilers.value && !currentItemRead &&
              revealedSummaryId.value !== currentItem.id
              ? (
                <button
                  class="detail-summary spoiler"
                  type="button"
                  onClick={() => revealedSummaryId.value = currentItem.id}
                >
                  <span aria-hidden="true">{summary}</span>
                  <strong>{t`줄거리 보기`}</strong>
                </button>
              )
              : <p class="detail-summary">{summary}</p>
          )}
          <dl>
            {importanceOf(currentItem) && (
              <div>
                <dt>{t`중요도`}</dt>
                <dd>
                  {translated(importanceMessages, importanceOf(currentItem)!)}
                </dd>
              </div>
            )}
            <div>
              <dt>{t`분류`}</dt>
              <dd>{laneLabel(currentItem)}</dd>
            </div>
            <div>
              <dt>{t`구간`}</dt>
              <dd>{translated(segmentMessages, currentItem.segmentName)}</dd>
            </div>
            {(releaseRows(currentItem).length > 0
              ? releaseRows(currentItem)
              : [[t`공개일`, "-"]]).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {currentItem.links.length > 0 && (
            <div class="detail-links">
              <h3>{t`관련 문서`}</h3>
              <ul>
                {currentItem.links.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <footer>
            <span>
              {t`데이터 기준 ${generatedAtLabel}`} ·{" "}
              <a
                href="https://github.com/scarf005/sefirot"
                target="_blank"
                rel="noreferrer"
              >
                GitHub
              </a>
            </span>
            <p class="disclaimer">
              {t`블루 아카이브 © 2021 NEXON Korea Corp. & NEXON Games Co., Ltd. 게임 이미지와 텍스트의 권리는 각 권리자에게 있습니다. 이 사이트는 팬이 만든 비공식 비영리 사이트이며 넥슨, NEXON Games, Yostar와 관련이 없습니다.`}
              {" "}
              {sourceNotice[0]}
              <a href="https://namu.wiki" target="_blank" rel="noreferrer">
                {t`나무위키`}
              </a>
              {sourceNotice[1]}{" "}
              <a
                href="https://github.com/scarf005/sefirot/issues"
                target="_blank"
                rel="noreferrer"
              >
                {t`문의`}
              </a>
            </p>
          </footer>
        </aside>
      </section>
    </main>
  )
}
