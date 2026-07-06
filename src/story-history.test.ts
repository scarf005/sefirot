/// <reference lib="deno.ns" />

import { assertEquals, assertThrows } from "@std/assert"
import {
  eraseStoryHistory,
  loadStoryHistory,
  parseStoryHistory,
  saveStoryHistory,
  serializeStoryHistory,
  type StoryHistoryStorage,
  storyHistoryStorageKey,
} from "./story-history.ts"

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  } satisfies StoryHistoryStorage
}

Deno.test("serializes and parses read story history", () => {
  const source = serializeStoryHistory(["story-b", "story-a", "story-b"])

  assertEquals(
    [...parseStoryHistory(source, new Set(["story-a", "story-b"]))],
    ["story-a", "story-b"],
  )
})

Deno.test("ignores imported history IDs that are not in the story list", () => {
  assertEquals(
    [...parseStoryHistory(
      JSON.stringify({ readItemIds: ["known", "missing"] }),
      new Set(["known"]),
    )],
    ["known"],
  )
})

Deno.test("persists and erases read story history", () => {
  const storage = memoryStorage()

  saveStoryHistory({ storage, readItemIds: ["story-a"] })
  assertEquals([...loadStoryHistory({ storage })], ["story-a"])

  eraseStoryHistory({ storage })
  assertEquals(storage.getItem(storyHistoryStorageKey), null)
})

Deno.test("rejects malformed imported history", () => {
  assertThrows(
    () => parseStoryHistory(JSON.stringify({ readItemIds: [1] })),
    Error,
    "Invalid story history IDs",
  )
})
