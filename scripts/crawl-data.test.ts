/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import { buildData, releaseFrom, stringifyJsonc } from "./crawl-data.ts"

const fixtureHtml = /*html*/ `
<table><tr><td>advertisement</td></tr></table>
<table>
  <tr><td>종류</td><td>편</td><td>장</td><td>화</td><td>일본</td><td>글로벌</td></tr>
  <tr>
    <td rowspan="2">메인</td>
    <td rowspan="2"><a href="/w/Series">Vol.1<br>대책위원회 편</a></td>
    <td><a href="/w/Series#Chapter1">1장<br>대책위원회의 기묘한 하루</a></td>
    <td>1~20</td>
    <td>2021. 02. 04.</td>
    <td>2021. 11. 09.<br>KR 더빙 2025. 07. 08.</td>
  </tr>
  <tr>
    <td><a href="/w/Series#Chapter2">2장 잃은 것과 놓지 않은 것</a></td>
    <td>전반<br>1~10</td>
    <td>2021. 03. 11.</td>
    <td>2021. 11. 16.</td>
  </tr>
  <tr><td colspan="6">중요도: 중 | note</td></tr>
</table>
<table>
  <tr><td>종류</td><td>편</td><td>장</td><td>화</td><td>일본</td><td>글로벌</td></tr>
  <tr>
    <td>이벤트</td>
    <td colspan="2"><a href="/w/Event">순백의 예고장</a></td>
    <td>1~16</td>
    <td>2023. 04. 26.</td>
    <td>2023. 10. 31.</td>
  </tr>
  <tr><td colspan="6">선상의 바니 체이서 이후 시점</td></tr>
</table>
<table>
  <tr><td>종류</td><td>편</td><td>장</td><td>화</td><td>일본</td><td>글로벌</td></tr>
  <tr>
    <td>미니</td>
    <td colspan="2">ON AIR : 게헨나</td>
    <td>1~2</td>
    <td>2026. 05. 20.</td>
    <td></td>
  </tr>
</table>
`

Deno.test("builds story data from namuwiki tables", () => {
  const data = buildData(fixtureHtml, "https://namu.wiki/w/source")

  assertEquals(data.items.map((item) => item.label), [
    "Vol.1 대책위원회 편 / 1장 대책위원회의 기묘한 하루 · 1~20",
    "Vol.1 대책위원회 편 / 2장 잃은 것과 놓지 않은 것 · 전반 1~10",
    "순백의 예고장 · 1~16",
    "ON AIR : 게헨나 · 1~2",
  ])
  assertEquals(data.items[0].release, {
    japan: ["2021-02-04"],
    global: ["2021-11-09"],
    krDub: ["2025-07-08"],
  })
  assertEquals(data.items[1].notes, ["중요도: 중 | note"])
  assertEquals(data.items[2].notes, ["선상의 바니 체이서 이후 시점"])
  assertEquals(data.items[0].links, [
    { label: "Vol.1 대책위원회 편", url: "https://namu.wiki/w/Series" },
    {
      label: "1장 대책위원회의 기묘한 하루",
      url: "https://namu.wiki/w/Series#Chapter1",
    },
  ])
  assertEquals(data.tree.children?.map((segment) => segment.children?.length), [
    2,
    1,
    1,
  ])
})

Deno.test("writes jsonc with Deno jsonc trailing commas", () => {
  assertEquals(
    stringifyJsonc({ items: [{ id: "story-001" }] }),
    `{
  "items": [
    {
      "id": "story-001",
    },
  ],
}
`,
  )
})

Deno.test("splits KR dubbing dates out of global releases", () => {
  assertEquals(
    releaseFrom(
      "2026. 01. 20. 최종화 2026. 01. 27.",
      "2026. 05. 19 KR 더빙 2026. 06. 03.",
    ),
    {
      japan: ["2026-01-20", "2026-01-27"],
      global: ["2026-05-19"],
      krDub: ["2026-06-03"],
    },
  )
})
