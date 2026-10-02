import "./app.css"
import { computed, signal } from "@preact/signals"
import { useEffect, useRef } from "preact/hooks"
import { parse } from "@std/jsonc"
import { scalePoint } from "d3"
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
  type Lane,
  laneForItem,
  lanes,
  nodeSize,
  type StoryItem as ClassifiedStoryItem,
} from "./story-classification.ts"

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
type GraphNode = StoryItem & {
  lane: Lane
  x: number
  y: number
  width: number
  height: number
}
type GraphLink = {
  source: GraphNode
  target: GraphNode
  kind: "main" | "lane" | "branch"
}
type StoryGraph = {
  nodes: GraphNode[]
  links: GraphLink[]
  width: number
  height: number
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
const layoutStoryGraph = (items: StoryItem[]): StoryGraph => {
  const activeLanes = lanes.filter((lane) =>
    lane.id === "main" || items.some((item) => laneForItem(item).id === lane.id)
  )
  const width = Math.max(1100, activeLanes.length * 150 + 80)
  const xScale = scalePoint(activeLanes.map((lane) => lane.id), [
    80,
    width - 80,
  ]).padding(0.5)
  const nodes = items.map((item, index) => {
    const lane = laneForItem(item)
    const size = nodeSize(item)
    return {
      ...item,
      lane,
      ...size,
      x: (xScale(lane.id) ?? 80) - size.width / 2,
      y: 112 + index * 92 - size.height / 2,
    }
  })
  const links: GraphLink[] = []

  for (const lane of activeLanes) {
    const laneNodes = nodes.filter((node) => node.lane.id === lane.id)
    for (let index = 1; index < laneNodes.length; index += 1) {
      links.push({
        source: laneNodes[index - 1],
        target: laneNodes[index],
        kind: lane.id === "main" ? "main" : "lane",
      })
    }
  }

  for (const node of nodes.filter((item) => item.lane.id !== "main")) {
    const previousMain = nodes
      .filter((candidate) =>
        candidate.lane.id === "main" && candidate.order < node.order
      )
      .pop()
    if (previousMain) {
      links.push({ source: previousMain, target: node, kind: "branch" })
    }
  }

  return { nodes, links, width, height: Math.max(480, nodes.length * 92 + 180) }
}

const curvedPath = (
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
) => {
  const deltaY = targetY - sourceY
  const controlY = Math.max(32, Math.abs(deltaY) * 0.5)
  return `M ${sourceX} ${sourceY} C ${sourceX} ${
    sourceY + controlY
  } ${targetX} ${targetY - controlY} ${targetX} ${targetY}`
}

const linkPath = ({ source, target, kind }: GraphLink) => {
  const sourceX = source.x + source.width / 2
  const sourceY = source.y + source.height
  const targetX = target.x + target.width / 2
  const targetY = target.y
  if (kind === "branch") {
    return curvedPath(sourceX, sourceY, targetX, targetY)
  }
  return `M ${sourceX} ${sourceY} V ${targetY}`
}

// Lane headings live in the sticky HTML header, so skip their old SVG band.
const graphTopOffset = 48

// Main-story nodes split into a small series line and a chapter line.
const graphNodeLines = (item: StoryItem) => {
  if (item.kind !== "메인") return { title: item.title }
  const chapter = `${item.chapter} · ${item.episodes}`
  return item.series === item.chapter
    ? { title: chapter }
    : { series: item.series, title: chapter }
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
const visibleItemIds = computed(() =>
  filteredItems.value.map((item) => item.id)
)
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
  }
  selectItem(id)
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

const storyGraph = computed(() => layoutStoryGraph(filteredItems.value))
const selectedItem = computed(() =>
  itemsById.get(selectedItemId.value) ?? filteredItems.value[0] ??
    orderedItems[0]
)

const readStateLabel = (isRead: boolean) => isRead ? "읽음" : "미독"

const persistReadItemIds = (ids: ReadonlySet<string>) => {
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = "브라우저 저장소를 사용할 수 없습니다."
    return false
  }
  try {
    saveStoryHistory({ storage, readItemIds: ids })
    return true
  } catch {
    historyStatus.value = "기록 저장에 실패했습니다."
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
    historyStatus.value = `${readStateLabel(nextIds.has(id))}으로 표시했습니다.`
  }
}

const eraseReadHistory = () => {
  if (!globalThis.confirm("읽음 기록을 모두 지울까요?")) return
  readItemIds.value = new Set()
  const storage = getHistoryStorage()
  if (!storage) {
    historyStatus.value = "읽음 기록을 지웠습니다."
    return
  }
  try {
    eraseStoryHistory({ storage })
    historyStatus.value = "읽음 기록을 지웠습니다."
  } catch {
    historyStatus.value = "기록 삭제에 실패했습니다."
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
    historyStatus.value = "읽음 기록을 내보냈습니다."
  } catch {
    historyStatus.value = "기록 내보내기에 실패했습니다."
  }
}

const importReadHistoryFile = async (file?: File) => {
  if (!file) return
  try {
    const importedIds = parseStoryHistory(await file.text(), validItemIds)
    readItemIds.value = importedIds
    if (persistReadItemIds(importedIds)) {
      historyStatus.value = `${importedIds.size}개 읽음 기록을 가져왔습니다.`
    }
  } catch {
    historyStatus.value = "기록 파일을 읽을 수 없습니다."
  }
}

export const App = () => {
  const graph = storyGraph.value
  const currentItem = selectedItem.value
  const currentItemRead = readItemIds.value.has(currentItem.id)
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
      <section class="toolbar" aria-label="스토리 필터">
        <label class="search-field">
          <span class="field-head">
            검색
            <small role="status">{filteredItems.value.length}개 표시</small>
          </span>
          <input
            type="search"
            value={searchText.value}
            placeholder="스토리, 장, 학원, 종류"
            onInput={(event) => {
              searchText.value = event.currentTarget.value
              ensureSelectionVisible()
            }}
          />
        </label>
        <label class="kind-field">
          <span class="field-head">종류</span>
          <select
            value={selectedKind.value}
            onInput={(event) => {
              selectedKind.value = event.currentTarget.value
              ensureSelectionVisible()
            }}
          >
            {kindOptions.map((kind) => <option key={kind}>{kind}</option>)}
          </select>
        </label>
        <div
          class="progress"
          role="progressbar"
          aria-label="읽음 진행도"
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
        <div class="toolbar-actions">
          <button
            class="next-unread-button"
            type="button"
            disabled={readCount === totalCount}
            onClick={selectNextUnread}
          >
            다음 미독
          </button>
          <button
            class="settings-button"
            type="button"
            aria-label="기록 설정"
            aria-expanded={settingsOpen.value}
            onClick={() => settingsOpen.value = !settingsOpen.value}
          >
            ⚙
          </button>
          {settingsOpen.value && (
            <div class="settings-menu" role="dialog" aria-label="기록 설정">
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
                {historyStatus.value || `읽음 ${readCount} / ${totalCount}`}
              </p>
            </div>
          )}
        </div>
      </section>

      <section class="content-grid">
        <section
          class="tree-panel"
          ref={treeRef}
          aria-label="프롤로그부터 최신까지의 스토리 트리"
        >
          {graph.nodes.length === 0 && (
            <p class="empty-state" role="status">검색 결과가 없습니다</p>
          )}
          <div
            class="lane-headings"
            hidden={graph.nodes.length === 0}
            style={{ width: `${graph.width}px` }}
          >
            {lanes.map((lane) => {
              const sample = graph.nodes.find((node) =>
                node.lane.id === lane.id
              )
              if (!sample && lane.id !== "main") return null
              return (
                <span
                  key={lane.id}
                  class={`lane-heading ${lane.id === "main" ? "main" : ""}`}
                  style={{
                    left: `${(sample?.x ?? 80) + (sample?.width ?? 240) / 2}px`,
                  }}
                >
                  {lane.label}
                </span>
              )
            })}
          </div>
          <svg
            class="story-tree"
            hidden={graph.nodes.length === 0}
            role="img"
            aria-label="블루 아카이브 스토리 순서 트리, 프롤로그부터 위에서 아래로"
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
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              ))}
            </defs>
            <g class="links">
              {graph.links.map((link) => (
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

        <aside class="details-panel" aria-label="선택한 스토리 상세">
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
          <h2>{currentItem.label}</h2>
          <button
            class={`detail-read-toggle ${currentItemRead ? "read" : "unread"}`}
            type="button"
            onClick={() => toggleReadItem(currentItem.id)}
          >
            {currentItemRead ? "읽음 취소" : "읽음으로 표시"}
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
