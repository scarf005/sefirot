/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import {
  importanceOf,
  isMinorStory,
  isUnreleasedInKorea,
  laneForItem,
  nodeSize,
  type StoryItem,
} from "./story-classification.ts"

const story = (item: Partial<StoryItem>): StoryItem => {
  return {
    id: item.id ?? "fixture",
    order: item.order ?? 1,
    segmentName: item.segmentName ?? "fixture",
    kind: item.kind ?? "이벤트",
    series: item.series ?? item.label ?? "fixture",
    chapter: item.chapter ?? item.label ?? "fixture",
    episodes: item.episodes ?? "1",
    title: item.title ?? item.label ?? "fixture",
    label: item.label ?? "fixture",
    notes: item.notes ?? [],
  }
}

Deno.test("classifies representative story lanes", () => {
  assertEquals(
    laneForItem(story({ kind: "메인", label: "프롤로그" })).id,
    "main",
  )
  assertEquals(
    laneForItem(story({ label: "네버랜드에서의 술래잡기" })).id,
    "shanhaijing",
  )
  assertEquals(
    laneForItem(
      story({ label: "선상의 바니 체이서", notes: ["밀레니엄의 C&C 소속"] }),
    ).id,
    "millennium",
  )
  assertEquals(
    laneForItem(story({ label: "227호 온천장 운영일지!" })).id,
    "red-winter",
  )
  assertEquals(
    laneForItem(story({ label: "용무동주 ~마음에 그리는 것은, 하나의 미래~" }))
      .id,
    "shanhaijing",
  )
  assertEquals(
    laneForItem(story({ label: "트레이닝부 · 1~3" })).id,
    "millennium",
  )
  assertEquals(laneForItem(story({ label: "Say-Bing!" })).id, "valkyrie")
  assertEquals(
    laneForItem(
      story({ label: "우리는 오컬트 연구회!", notes: ["와일드헌트 예술학원"] }),
    ).id,
    "wildhunt",
  )
})

Deno.test("sizes main stories larger than event stories and event stories larger than group stories", () => {
  assertEquals(
    nodeSize(story({ kind: "메인" })).width >
      nodeSize(story({ kind: "이벤트" })).width,
    true,
  )
  assertEquals(
    nodeSize(story({ kind: "이벤트" })).width >
      nodeSize(story({ kind: "그룹" })).width,
    true,
  )
})

Deno.test("reads the importance mark from story notes", () => {
  const marked = (note: string) => importanceOf(story({ notes: [note] }))
  assertEquals(marked("중요도: 상 | 메인 스토리와 직결"), "상")
  assertEquals(marked("중요도: 중하 | 수영복 이벤트."), "중하")
  assertEquals(marked("중요도: 하 Sheside Outside 이후로 추정"), "하")
  assertEquals(marked("중요도: 없음 | 단독 이벤트"), "없음")
  assertEquals(importanceOf(story({ notes: [] })), undefined)
})

Deno.test("only explicit low marks count as minor", () => {
  const minor = (notes: string[]) => isMinorStory(story({ notes }))
  assertEquals(minor(["중요도: 하 | 연관성 적음"]), true)
  assertEquals(minor(["중요도: 중하 | 연관성 적음"]), true)
  assertEquals(minor(["중요도: 없음"]), true)
  assertEquals(minor(["중요도: 중 | 첫 방문"]), false)
  assertEquals(minor([]), false)
})

Deno.test("isUnreleasedInKorea is true without a global date or before it", () => {
  assertEquals(
    isUnreleasedInKorea({ release: { global: [] } }, "2026-10-13"),
    true,
  )
  assertEquals(isUnreleasedInKorea({ release: {} }, "2026-10-13"), true)
  assertEquals(
    isUnreleasedInKorea({ release: { global: ["2026-10-14"] } }, "2026-10-13"),
    true,
  )
})

Deno.test("isUnreleasedInKorea is false from the global release day on", () => {
  assertEquals(
    isUnreleasedInKorea({ release: { global: ["2026-10-13"] } }, "2026-10-13"),
    false,
  )
  assertEquals(
    isUnreleasedInKorea({ release: { global: ["2021-11-09"] } }, "2026-10-13"),
    false,
  )
})
