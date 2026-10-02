/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import {
  adjacentVisibleId,
  nextUnreadId,
  readProgress,
  selectionAfterFilter,
} from "./story-navigation.ts"

const ids = ["a", "b", "c", "d"]

Deno.test("counts read stories over all ids", () => {
  assertEquals(readProgress(ids, new Set(["a", "c"])), { read: 2, total: 4 })
  assertEquals(readProgress(ids, new Set(["x"])), { read: 0, total: 4 })
  assertEquals(readProgress([], new Set(["a"])), { read: 0, total: 0 })
})

Deno.test("finds the first unread story in order", () => {
  assertEquals(nextUnreadId(ids, new Set()), "a")
  assertEquals(nextUnreadId(ids, new Set(["a", "b", "d"])), "c")
  assertEquals(nextUnreadId(ids, new Set(ids)), undefined)
  assertEquals(nextUnreadId([], new Set()), undefined)
})

Deno.test("moves to the previous and next visible story", () => {
  assertEquals(adjacentVisibleId(ids, "b", 1), "c")
  assertEquals(adjacentVisibleId(ids, "b", -1), "a")
})

Deno.test("stays at the ends of the visible list", () => {
  assertEquals(adjacentVisibleId(ids, "d", 1), "d")
  assertEquals(adjacentVisibleId(ids, "a", -1), "a")
  assertEquals(adjacentVisibleId(["a"], "a", 1), "a")
})

Deno.test("moves a filtered-out selection to the first visible story", () => {
  assertEquals(adjacentVisibleId(["b", "c"], "a", 1), "b")
  assertEquals(adjacentVisibleId(["b", "c"], "d", -1), "b")
  assertEquals(adjacentVisibleId([], "a", 1), undefined)
})

Deno.test("keeps a visible selection and replaces a filtered-out one", () => {
  assertEquals(selectionAfterFilter(["b", "c"], "c"), "c")
  assertEquals(selectionAfterFilter(["b", "c"], "a"), "b")
  assertEquals(selectionAfterFilter([], "a"), "a")
})
