/// <reference lib="deno.ns" />

import { assert, assertEquals } from "@std/assert"
import { layoutStoryGraph, narrowLanePitch } from "./story-graph.ts"
import type { StoryItem } from "./story-classification.ts"

const story = (id: string, kind: string, label: string): StoryItem => ({
  id,
  order: Number(id),
  segmentName: "fixture",
  kind,
  series: label,
  chapter: label,
  episodes: "1",
  title: label,
  label,
  notes: [],
})

const main = (id: string) => story(id, "메인", "프롤로그")
const gehenna = (id: string) => story(id, "그룹", "미식연구회")
const millennium = (id: string) => story(id, "그룹", "게임개발부")
const trinity = (id: string) => story(id, "그룹", "구호기사단")

const nodeById = (items: StoryItem[]) =>
  new Map(layoutStoryGraph(items).nodes.map((node) => [node.id, node]))

Deno.test("side stories from different lanes share one row", () => {
  const nodes = nodeById([main("1"), gehenna("2"), millennium("3")])
  assertEquals(nodes.get("2")!.row, nodes.get("3")!.row)
})

Deno.test("main stories never share a row", () => {
  const nodes = nodeById([main("1"), gehenna("2"), main("3"), millennium("4")])
  assert(nodes.get("2")!.row > nodes.get("1")!.row)
  assert(nodes.get("3")!.row > nodes.get("2")!.row)
  assert(nodes.get("4")!.row > nodes.get("3")!.row)
})

Deno.test("stories in one lane stack downward", () => {
  const nodes = nodeById([main("1"), gehenna("2"), gehenna("3")])
  assert(nodes.get("3")!.row > nodes.get("2")!.row)
  assert(nodes.get("3")!.y >= nodes.get("2")!.y + nodes.get("2")!.height)
})

Deno.test("rows follow story order", () => {
  const items = [
    main("1"),
    gehenna("2"),
    millennium("3"),
    gehenna("4"),
    trinity("5"),
    main("6"),
  ]
  const rows = layoutStoryGraph(items).nodes.map((node) => node.row)
  assertEquals(rows, [0, 1, 1, 2, 2, 3])
})

Deno.test("collapsed lanes keep a narrow column but no stories", () => {
  const graph = layoutStoryGraph([main("1"), gehenna("2"), millennium("3")], {
    collapsedLaneIds: new Set(["gehenna"]),
  })
  assertEquals(graph.nodes.map((node) => node.id), ["1", "3"])
  const columns = new Map(graph.lanes.map((column) => [column.lane.id, column]))
  assert(columns.get("gehenna")!.collapsed)
  assert(columns.get("gehenna")!.width < columns.get("millennium")!.width)
})

Deno.test("lane columns follow the lane order without overlapping", () => {
  const { lanes } = layoutStoryGraph([main("1"), trinity("2"), gehenna("3")])
  assertEquals(lanes.map((column) => column.lane.id), [
    "main",
    "gehenna",
    "trinity",
  ])
  lanes.slice(1).forEach((column, index) =>
    assert(
      column.center - column.width / 2 >=
        lanes[index].center + lanes[index].width / 2,
    )
  )
})

Deno.test("branches only reach lanes without a story since the last main", () => {
  const { links } = layoutStoryGraph([
    main("1"),
    gehenna("2"),
    gehenna("3"),
    main("4"),
    gehenna("5"),
  ])
  const branches = links
    .filter((link) => link.kind === "branch")
    .map((link) => `${link.source.id}>${link.target.id}`)
  assertEquals(branches, ["1>2", "4>5"])
})

Deno.test("narrow lane spacing shrinks the graph without overlapping cards", () => {
  const items = [main("1"), gehenna("2"), millennium("3"), trinity("4")]
  const normal = layoutStoryGraph(items)
  const narrow = layoutStoryGraph(items, { lanePitch: narrowLanePitch })
  assert(narrow.width < normal.width)
  const side = narrow.nodes.filter((node) => node.lane.id !== "main")
  side.slice(1).forEach((node, index) =>
    assert(node.x >= side[index].x + side[index].width)
  )
})
