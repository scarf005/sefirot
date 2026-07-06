import "./app.css"
import { computed, signal } from "@preact/signals"
import { parse } from "@std/jsonc"
import { scalePoint } from "d3"
import storyOrderJsonc from "./data/blue-archive-story-order.jsonc?raw"
import {
  eraseStoryHistory,
  loadStoryHistory,
  parseStoryHistory,
  saveStoryHistory,
  serializeStoryHistory,
} from "./story-history.ts"
import {
  type Lane,
  laneForItem,
  lanes,
  nodeSize,
  type StoryItem as ClassifiedStoryItem,
} from "./story-classification.ts"

type StoryRelease = { japan?: string[]; global?: string[]; krDub?: string[] }
type StoryLink = { label: string; url: string }
type StoryItem = ClassifiedStoryItem & {
  release: StoryRelease
  links: StoryLink[]
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

const graphNodeTitle = (item: StoryItem) => {
  return item.kind === "메인" ? item.label : item.title
}

const kindClass = (kind: string) => {
  if (kind === "메인") return "kind-main"
  if (kind === "이벤트") return "kind-event"
  if (kind === "그룹") return "kind-group"
  if (kind === "미니") return "kind-mini"
  return "kind-other"
}

const releaseText = (item: StoryItem) => {
  return [
    ["JP", item.release.japan],
    ["GL", item.release.global],
    ["KR dub", item.release.krDub],
  ]
    .filter(([, values]) => Array.isArray(values) && values.length > 0)
    .map(([label, values]) => `${label}: ${(values as string[]).join(", ")}`)
    .join(" · ")
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

  return (
    <main class="story-visualizer">
      <section class="toolbar" aria-label="Story filters">
        <label>
          <span>검색</span>
          <input
            type="search"
            value={searchText.value}
            placeholder="스토리, 장, 학원, 종류"
            onInput={(event) => searchText.value = event.currentTarget.value}
          />
        </label>
        <div class="kind-settings">
          <label>
            <span>종류</span>
            <select
              value={selectedKind.value}
              onInput={(event) =>
                selectedKind.value = event.currentTarget.value}
            >
              {kindOptions.map((kind) => <option key={kind}>{kind}</option>)}
            </select>
          </label>
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
                {historyStatus.value || `${readItemIds.value.size}개 읽음`}
              </p>
            </div>
          )}
        </div>
      </section>

      <section class="content-grid">
        <section
          class="tree-panel"
          aria-label="Story tree from prologue to latest"
        >
          <svg
            class="story-tree"
            role="img"
            aria-label="Blue Archive story order tree, top to bottom from prologue"
            viewBox={`0 0 ${graph.width} ${graph.height}`}
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
            <g class="lane-headings">
              {lanes.map((lane) => {
                const sample = graph.nodes.find((node) =>
                  node.lane.id === lane.id
                )
                if (!sample && lane.id !== "main") return null
                return (
                  <text
                    key={lane.id}
                    x={(sample?.x ?? 80) + (sample?.width ?? 240) / 2}
                    y="36"
                  >
                    {lane.label}
                  </text>
                )
              })}
            </g>
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
                return (
                  <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
                    <foreignObject width={node.width} height={node.height}>
                      <div
                        class={`story-node ${kindClass(node.kind)} ${
                          selected ? "selected" : ""
                        } ${isRead ? "read" : "unread"}`}
                      >
                        <button
                          class="node-select"
                          type="button"
                          onClick={() => {
                            selectedItemId.value = node.id
                          }}
                        >
                          <span class="read-symbol" aria-hidden="true">
                            {isRead ? "●" : "○"}
                          </span>
                          <span class="node-title">{graphNodeTitle(node)}</span>
                        </button>
                        <button
                          class="node-read-toggle"
                          type="button"
                          aria-pressed={isRead}
                          aria-label={`${node.label} ${
                            isRead ? "미독" : "읽음"
                          }으로 표시`}
                          title={`${readStateLabel(isRead)} 상태`}
                          onClick={() =>
                            toggleReadItem(node.id)}
                        >
                          {isRead ? "✓" : "○"}
                        </button>
                      </div>
                    </foreignObject>
                  </g>
                )
              })}
            </g>
          </svg>
        </section>

        <aside class="details-panel" aria-label="Selected story details">
          <div class="detail-heading">
            <span class={`kind-pill ${kindClass(currentItem.kind)}`}>
              {currentItem.kind}
            </span>
            <button
              class={`detail-read-toggle ${
                currentItemRead ? "read" : "unread"
              }`}
              type="button"
              aria-pressed={currentItemRead}
              onClick={() => toggleReadItem(currentItem.id)}
            >
              {currentItemRead ? "✓ 읽음" : "○ 미독"}
            </button>
          </div>
          <h2>{currentItem.label}</h2>
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
            <div>
              <dt>공개일</dt>
              <dd>{releaseText(currentItem) || "-"}</dd>
            </div>
          </dl>
          {currentItem.links.length > 0 && (
            <div class="detail-links">
              <h3>Links</h3>
              {currentItem.links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {link.label}
                </a>
              ))}
            </div>
          )}
          <footer>
            <span>
              Data: {new Date(storyOrder.generatedAt).toLocaleString()}
            </span>
          </footer>
        </aside>
      </section>
    </main>
  )
}
