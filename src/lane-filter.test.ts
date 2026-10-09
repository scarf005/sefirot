/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import { collapsedLanes, cycleLane, type LaneFilter } from "./lane-filter.ts"

const open: LaneFilter = { focused: null, hidden: new Set() }
const laneIds = ["main", "gehenna", "millennium", "trinity"]

Deno.test("clicking a lane cycles focus, hidden, then shown", () => {
  const focused = cycleLane(open, "gehenna")
  assertEquals(focused.focused, "gehenna")
  const hidden = cycleLane(focused, "gehenna")
  assertEquals([hidden.focused, [...hidden.hidden]], [null, ["gehenna"]])
  const shown = cycleLane(hidden, "gehenna")
  assertEquals([shown.focused, [...shown.hidden]], [null, []])
})

Deno.test("focus keeps only the main story and the focused lane open", () => {
  const filter = cycleLane(open, "millennium")
  assertEquals([...collapsedLanes(filter, laneIds)], ["gehenna", "trinity"])
})

Deno.test("clicking another lane moves the focus", () => {
  const filter = cycleLane(cycleLane(open, "gehenna"), "trinity")
  assertEquals(filter.focused, "trinity")
  assertEquals([...collapsedLanes(filter, laneIds)], ["gehenna", "millennium"])
})

Deno.test("hidden lanes stay collapsed without a focus", () => {
  const filter = cycleLane(cycleLane(open, "gehenna"), "gehenna")
  assertEquals([...collapsedLanes(filter, laneIds)], ["gehenna"])
})
