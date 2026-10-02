/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import { isKoreanText } from "./korean-text.ts"

Deno.test("accepts Korean prose", () => {
  assertEquals(
    isKoreanText("트리니티 종합학원의 발굴구역, 어느 날 거기서."),
    true,
  )
})

Deno.test("accepts Korean prose quoting a Japanese title", () => {
  assertEquals(
    isKoreanText(
      "「ブルーアーカイブ」의 이야기가 시작된다. 선생님은 학원으로 향한다.",
    ),
    true,
  )
})

Deno.test("rejects Japanese prose", () => {
  assertEquals(
    isKoreanText(
      "在りし日の影がゲヘナ学園を覆う。後輩たちは、大切な先輩たちを取り戻せるのでしょうか？",
    ),
    false,
  )
})

Deno.test("rejects a Japanese sentence followed by its Korean translation", () => {
  assertEquals(
    isKoreanText(
      '先生のために、歌ってもいいですか？ "선생님을 위해, 노래해도 괜찮을까요? 정말로 괜찮은 걸까요?"',
    ),
    false,
  )
})

Deno.test("rejects empty, Latin-only and Han-only text", () => {
  assertEquals(isKoreanText(""), false)
  assertEquals(isKoreanText("1~15 !!!"), false)
  assertEquals(isKoreanText("Trip-Trap-Train"), false)
  assertEquals(isKoreanText("先生"), false)
})

Deno.test("rejects text where Hangul is not the majority of letters", () => {
  assertEquals(isKoreanText("선생님 Trip-Trap-Train Say-Bing"), false)
})
