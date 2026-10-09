import "./app.css"
import { computed, signal } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { parse } from "@std/jsonc"
import { isKoreanText } from "./korean-text.ts"
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
  laneForItem,
  type StoryItem as ClassifiedStoryItem,
} from "./story-classification.ts"
import {
  type GraphLink,
  graphTopOffset,
  layoutStoryGraph,
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

const selectedKind = signal("전체")
const searchText = signal("")
const selectedItemId = signal(orderedItems[0]?.id ?? "")
const readItemIds = signal<ReadonlySet<string>>(loadReadItemIds())
const settingsOpen = signal(false)
const historyStatus = signal("")

const filteredItems = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase()
  return orderedItems.filter((item) => {
    const matchesKind = selectedKind.value === "전체" ||
      item.kind === selectedKind.value
    const matchesQuery = query.length === 0 || [
      item.label,
      item.segmentName,
      item.kind,
      item.series,
      item.chapter,
      item.episodes,
      laneForItem(item).label,
    ].some((value) => value.toLocaleLowerCase().includes(query))
    return matchesKind && matchesQuery
  })
})
// Branches leave the main spine at the target's own row, so they read as
// "after this main story" without crossing the graph diagonally.
const linkPath = ({ source, target, kind }: GraphLink<StoryItem>) => {
  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height
  if (kind === "branch") {
    return `M ${sourceX} ${sourceY} V ${target.y + target.height / 2} H ${
      target.x + 6
    }`
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
      series: linkedEventPrefix.trim(),
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

const releaseRows = (item: StoryItem) => {
  const rows: [string, string[] | undefined][] = [
    ["일본", item.release.japan],
    ["글로벌", item.release.global],
    ["한국어 더빙", item.release.krDub],
  ]
  return rows.flatMap(([label, values]) =>
    values && values.length > 0 ? [[label, values.join(", ")]] : []
  )
}

const generatedAtLabel = new Date(storyOrder.generatedAt).toLocaleString(
  "ko-KR",
  {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  },
).replace(/\.\s*/g, "-").replace(/-(\d\d:)/, " $1")

const orderedItemIds = orderedItems.map((item) => item.id)
const progress = computed(() => readProgress(orderedItemIds, readItemIds.value))
const hiddenLanes = signal<ReadonlySet<string>>(new Set())
const storyGraph = computed(() =>
  layoutStoryGraph(filteredItems.value, { collapsedLaneIds: hiddenLanes.value })
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
const scrollTick = signal(0)

const prefersReducedMotion = () =>
  globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false

// Scrolls only the tree panel (not the page) so the node sits in the middle of
// the part of the panel that is visible below the sticky lane headings; the
// horizontal position only changes when the node is out of view.
const centerInPanel = (panel: HTMLElement, node: HTMLElement) => {
  const headings = panel.querySelector<HTMLElement>(".lane-headings")
  const headingHeight = headings?.offsetHeight ?? 0
  const coveredBottom =
    parseFloat(getComputedStyle(panel).scrollPaddingBottom) || 0
  const panelBox = panel.getBoundingClientRect()
  const nodeBox = node.getBoundingClientRect()
  const visibleHeight = panel.clientHeight - headingHeight - coveredBottom
  const fitsHorizontally = nodeBox.left >= panelBox.left &&
    nodeBox.right <= panelBox.left + panel.clientWidth
  panel.scrollTo({
    top: panel.scrollTop + nodeBox.top - panelBox.top - headingHeight -
      (visibleHeight - nodeBox.height) / 2,
    left: fitsHorizontally ? panel.scrollLeft : panel.scrollLeft +
      nodeBox.left - panelBox.left - (panel.clientWidth - nodeBox.width) / 2,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  })
}

const selectItem = (id: string) => {
  selectedItemId.value = id
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

const readStateLabel = (isRead: boolean) => isRead ? "읽음" : "안 읽음"

const persistReadItemIds = (ids: ReadonlySet<string>) => {
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = "브라우저에 저장할 수 없습니다."
    return false
  }
  try {
    saveStoryHistory({ storage, readItemIds: ids })
    return true
  } catch {
    historyStatus.value = "저장하지 못했습니다."
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
    historyStatus.value = `${readStateLabel(nextIds.has(id))}으로 바꿨습니다.`
  }
}

const eraseReadHistory = () => {
  if (!globalThis.confirm("읽음 기록을 모두 지울까요?")) return
  readItemIds.value = new Set()
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = "기록을 지웠습니다."
    return
  }
  try {
    eraseStoryHistory({ storage })
    historyStatus.value = "기록을 지웠습니다."
  } catch {
    historyStatus.value = "기록을 지우지 못했습니다."
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
    historyStatus.value = "기록을 내보냈습니다."
  } catch {
    historyStatus.value = "기록을 내보내지 못했습니다."
  }
}

const importReadHistoryFile = async (file?: File) => {
  if (!file) return
  try {
    const importedIds = parseStoryHistory(await file.text(), validItemIds)
    readItemIds.value = importedIds
    if (persistReadItemIds(importedIds)) {
      historyStatus.value = `기록 ${importedIds.size}개를 가져왔습니다.`
    }
  } catch {
    historyStatus.value = "파일을 읽지 못했습니다."
  }
}

export const App = () => {
  const graph = storyGraph.value
  const currentItem = selectedItem.value
  const currentItemRead = readItemIds.value.has(currentItem.id)
  const currentLines = storyLines(currentItem)
  const { read: readCount, total: totalCount } = progress.value
  const treeRef = useRef<HTMLElement>(null)
  const keyboardMoved = useRef(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const step = keyboardSteps[event.key]
      if (
        !step || event.altKey || event.ctrlKey || event.metaKey ||
        isTypingTarget(event.target)
      ) return
      event.preventDefault()
      keyboardMoved.current = true
      moveSelection(step)
    }
    globalThis.addEventListener("keydown", onKeyDown)
    return () => globalThis.removeEventListener("keydown", onKeyDown)
  }, [])

  useEffect(() => {
    if (scrollTick.value === 0) return
    const node = treeRef.current?.querySelector<HTMLElement>(
      `[data-node-id="${selectedItemId.value}"]`,
    )
    if (!node) return
    centerInPanel(treeRef.current!, node)
    if (keyboardMoved.current) {
      keyboardMoved.current = false
      node.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
    }
  }, [scrollTick.value])

  return (
    <main class="story-visualizer">
      <header class="top-bar">
        <h1>스토리</h1>
        <input
          class="search-input"
          type="search"
          aria-label="검색"
          value={searchText.value}
          placeholder="검색"
          onInput={(event) => {
            searchText.value = event.currentTarget.value
            ensureSelectionVisible()
          }}
        />
        <div class="kind-tabs" role="group" aria-label="종류">
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
              {kind}
            </button>
          ))}
        </div>
        <div
          class="progress"
          role="progressbar"
          aria-label="읽음"
          aria-valuemin={0}
          aria-valuemax={totalCount}
          aria-valuenow={readCount}
        >
          <span class="progress-text">
            읽음 <strong>{readCount}</strong> / {totalCount}
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
          이어 보기
        </button>
        <div class="settings">
          <button
            class="settings-button"
            type="button"
            aria-label="설정"
            aria-expanded={settingsOpen.value}
            onClick={() => settingsOpen.value = !settingsOpen.value}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.3 2h3.4l.5 2.6 1.7.7 2.2-1.5 2.4 2.4-1.5 2.2.7 1.7 2.6.5v3.4l-2.6.5-.7 1.7 1.5 2.2-2.4 2.4-2.2-1.5-1.7.7-.5 2.6h-3.4l-.5-2.6-1.7-.7-2.2 1.5-2.4-2.4 1.5-2.2-.7-1.7L2 13.7v-3.4l2.6-.5.7-1.7-1.5-2.2 2.4-2.4 2.2 1.5 1.7-.7zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
            </svg>
          </button>
          {settingsOpen.value && (
            <div class="settings-menu" role="dialog" aria-label="설정">
              <button type="button" onClick={exportReadHistory}>
                기록 내보내기
              </button>
              <label class="settings-file-button">
                기록 가져오기
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
                기록 지우기
              </button>
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
          aria-label="스토리 순서"
        >
          {graph.nodes.length === 0 && (
            <p class="empty-state" role="status">결과 없음</p>
          )}
          {/* Headings stay while lanes are hidden so they can be shown again. */}
          <div
            class="lane-headings"
            hidden={filteredItems.value.length === 0}
            style={{ width: `${graph.width}px` }}
          >
            {graph.lanes.map(({ lane, center, collapsed }) => {
              const count = laneProgress.value.get(lane.id)
              const countLabel = count ? `${count.read}/${count.total}` : ""
              return (
                <button
                  key={lane.id}
                  type="button"
                  class={`lane-heading ${collapsed ? "collapsed" : ""}`}
                  style={{ left: `${center}px` }}
                  aria-label={`${lane.label} ${countLabel}, ${
                    collapsed ? "숨김" : "표시"
                  }`}
                  title={`${lane.label} ${countLabel}`}
                  onClick={() => toggleLane(lane.id)}
                >
                  {(laneEmblems[lane.id] ?? []).map((emblem) => (
                    <span
                      key={emblem}
                      class="lane-emblem"
                      style={{ "--emblem": `url("${emblem}")` }}
                      aria-hidden="true"
                    />
                  ))}
                  {(!collapsed || !laneEmblems[lane.id]) && (
                    <span>{lane.label}</span>
                  )}
                  {!collapsed && <small class="lane-count">{countLabel}</small>}
                </button>
              )
            })}
          </div>
          <svg
            class="story-tree"
            hidden={graph.nodes.length === 0}
            role="img"
            aria-label="스토리 순서도"
            width={graph.width}
            height={graph.height - graphTopOffset}
            viewBox={`0 ${graphTopOffset} ${graph.width} ${
              graph.height - graphTopOffset
            }`}
          >
            <defs>
              {(["main", "lane", "branch"] as const).map((kind) => (
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
            <g class="links">
              {/* Main links paint last so they cover the branch stems. */}
              {(["branch", "lane", "main"] as const).flatMap((kind) =>
                graph.links.filter((link) => link.kind === kind)
              ).map((link) => (
                <path
                  key={`${link.kind}-${link.source.id}-${link.target.id}`}
                  class={link.kind}
                  d={linkPath(link)}
                  marker-end={`url(#arrow-${link.kind})`}
                />
              ))}
            </g>
            <g class="nodes">
              {graph.nodes.map((node) => {
                const selected = node.id === selectedItemId.value
                const isRead = readItemIds.value.has(node.id)
                const lines = graphNodeLines(node)
                return (
                  <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                    <foreignObject width={node.width} height={node.height}>
                      <div
                        class={`story-node ${kindClass(node.kind)} ${
                          selected ? "selected" : ""
                        } ${isRead ? "read" : "unread"} ${
                          node.thumbnail ? `thumb-${node.thumbnail.fit}` : ""
                        }`}
                        data-node-id={node.id}
                        style={thumbnailStyle(node.thumbnail)}
                      >
                        <button
                          class="node-select"
                          type="button"
                          aria-current={selected}
                          aria-label={`${node.label}, ${
                            readStateLabel(isRead)
                          }`}
                          title={node.label}
                          onClick={() => selectItem(node.id)}
                        >
                          {isRead && (
                            <span class="node-tag" aria-hidden="true">
                              읽음
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
              })}
            </g>
          </svg>
        </section>

        <aside class="details-panel" aria-label="스토리 정보">
          <div class="detail-heading">
            <span class={`kind-pill ${kindClass(currentItem.kind)}`}>
              {currentItem.kind}
            </span>
            <span class="detail-state">
              #{currentItem.order} · {readStateLabel(currentItemRead)}
            </span>
          </div>
          {currentItem.thumbnail && (
            <div
              class={`detail-thumbnail thumb-${currentItem.thumbnail.fit}`}
              style={thumbnailStyle(currentItem.thumbnail)}
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
            {currentItemRead ? "읽음 해제" : "읽음 표시"}
          </button>
          {currentItem.summary && isKoreanText(currentItem.summary) && (
            <p class="detail-summary">{currentItem.summary}</p>
          )}
          <dl>
            <div>
              <dt>순서</dt>
              <dd>#{currentItem.order}</dd>
            </div>
            <div>
              <dt>분류</dt>
              <dd>{laneForItem(currentItem).label}</dd>
            </div>
            <div>
              <dt>구간</dt>
              <dd>{currentItem.segmentName}</dd>
            </div>
            <div>
              <dt>시리즈</dt>
              <dd>{currentItem.series}</dd>
            </div>
            <div>
              <dt>장</dt>
              <dd>{currentItem.chapter}</dd>
            </div>
            <div>
              <dt>에피소드</dt>
              <dd>{currentItem.episodes}</dd>
            </div>
            {(releaseRows(currentItem).length > 0
              ? releaseRows(currentItem)
              : [["공개일", "-"]]).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
          </dl>
          {currentItem.links.length > 0 && (
            <div class="detail-links">
              <h3>관련 문서</h3>
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
            <span>데이터 기준 {generatedAtLabel}</span>
          </footer>
        </aside>
      </section>
    </main>
  )
}
