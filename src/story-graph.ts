import {
  type Lane,
  laneForItem,
  lanes,
  nodeSize,
  type StoryItem,
} from "./story-classification.ts"

export type GraphNode<T extends StoryItem> = T & {
  lane: Lane
  row: number
  x: number
  y: number
  width: number
  height: number
}
export type GraphLink<T extends StoryItem> = {
  source: GraphNode<T>
  target: GraphNode<T>
  kind: "main" | "lane" | "branch"
}
export type LaneColumn = {
  lane: Lane
  center: number
  width: number
  collapsed: boolean
}
export type StoryGraph<T extends StoryItem> = {
  nodes: GraphNode<T>[]
  links: GraphLink<T>[]
  lanes: LaneColumn[]
  width: number
  height: number
}

// The sticky lane headings cover the top band of the graph.
export const graphTopOffset = 48
const lanePitch = 184
const collapsedLanePitch = 72
const graphSidePadding = 40
const rowGap = 28
const graphTop = graphTopOffset + 24

// Rows keep story order top to bottom: a side story shares the previous row
// unless that row holds a main story or a story of its own lane.
const assignRows = (items: StoryItem[]) => {
  const laneLastRow = new Map<string, number>()
  let previousRow = -1
  let previousMain = false
  return items.map((item) => {
    const lane = laneForItem(item)
    const main = lane.id === "main"
    const row = Math.max(
      main || previousMain ? previousRow + 1 : Math.max(previousRow, 0),
      (laneLastRow.get(lane.id) ?? -1) + 1,
    )
    laneLastRow.set(lane.id, row)
    previousRow = row
    previousMain = main
    return row
  })
}

// Collapsed lanes keep a narrow column so their heading stays in place.
const layoutLanes = (
  items: StoryItem[],
  collapsedLaneIds: ReadonlySet<string>,
) =>
  lanes
    .filter((lane) =>
      lane.id === "main" ||
      items.some((item) => laneForItem(item).id === lane.id)
    )
    .reduce<LaneColumn[]>((columns, lane) => {
      const collapsed = collapsedLaneIds.has(lane.id)
      const width = collapsed ? collapsedLanePitch : lanePitch
      const previous = columns.at(-1)
      const left = previous
        ? previous.center + previous.width / 2
        : graphSidePadding
      return [...columns, { lane, center: left + width / 2, width, collapsed }]
    }, [])

export const layoutStoryGraph = <T extends StoryItem>(
  allItems: T[],
  { collapsedLaneIds = new Set<string>() }: {
    collapsedLaneIds?: ReadonlySet<string>
  } = {},
): StoryGraph<T> => {
  const columns = layoutLanes(allItems, collapsedLaneIds)
  const centers = new Map(
    columns.map((column) => [column.lane.id, column.center]),
  )
  const lastColumn = columns.at(-1)!
  const width = lastColumn.center + lastColumn.width / 2 + graphSidePadding
  const items = allItems.filter((item) =>
    !collapsedLaneIds.has(laneForItem(item).id)
  )
  const rows = assignRows(items)
  const rowHeights: number[] = []
  items.forEach((item, index) => {
    rowHeights[rows[index]] = Math.max(
      rowHeights[rows[index]] ?? 0,
      nodeSize(item).height,
    )
  })
  const rowTops = rowHeights.reduce<number[]>(
    (tops, height, row) => [...tops, tops[row] + height + rowGap],
    [graphTop],
  )
  const nodes = items.map((item, index) => {
    const lane = laneForItem(item)
    const size = nodeSize(item)
    const row = rows[index]
    return {
      ...item,
      lane,
      row,
      ...size,
      x: centers.get(lane.id)! - size.width / 2,
      y: rowTops[row] + (rowHeights[row] - size.height) / 2,
    }
  })
  const links: GraphLink<T>[] = []
  const lanePrevious = new Map<string, number>()
  let lastMain = -1
  nodes.forEach((node, index) => {
    const previous = lanePrevious.get(node.lane.id)
    if (previous !== undefined) {
      links.push({
        source: nodes[previous],
        target: node,
        kind: node.lane.id === "main" ? "main" : "lane",
      })
    }
    if (node.lane.id === "main") {
      lastMain = index
    } else if (lastMain >= 0 && (previous ?? -1) < lastMain) {
      links.push({ source: nodes[lastMain], target: node, kind: "branch" })
    }
    lanePrevious.set(node.lane.id, index)
  })

  return {
    nodes,
    links,
    lanes: columns,
    width,
    height: rowTops[rowHeights.length] - rowGap + 48,
  }
}
