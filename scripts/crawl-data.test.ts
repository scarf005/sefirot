/// <reference lib="deno.ns" />

import { assertEquals } from "@std/assert"
import { parse } from "node-html-parser"
import {
  backgroundCandidates,
  buildData,
  chapterIntro,
  eventCandidates,
  fileCandidates,
  firstBackground,
  firstFile,
  itemSummary,
  mainBackgrounds,
  mainVolumeKey,
  matchName,
  normalizeName,
  overviewSynopsis,
  parseEventPromos,
  parseImageInfo,
  pickThumbnail,
  releaseFrom,
  stringifyJsonc,
  summaryCoverage,
  summarySources,
  thumbnailCoverage,
} from "./crawl-data.ts"

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

Deno.test("normalizes names across punctuation, width and case", () => {
  assertEquals(
    normalizeName("Sheside Outside!"),
    normalizeName("Sheside outside"),
  )
  assertEquals(
    normalizeName("ON YOUR MARK ＠ MILLENNIUM ~키보토스~"),
    "onyourmarkmillennium키보토스",
  )
  assertEquals(
    normalizeName("샬레의 해피♡발렌타인 순찰"),
    "샬레의해피발렌타인순찰",
  )
  assertEquals(normalizeName(" ~!・ "), "")
})

Deno.test("matches names exactly, by subtitle and never ambiguously", () => {
  const names = {
    "1": "강철대륙 공략전",
    "2": "순백의 예고장 ~허식의 저택~",
    "3": "순백의 예고장 ~다른 저택~",
    "4": "비밀의 미드나잇 파티 ~종이 울리는 술래잡기~",
    "5": "특수작전: 로어추적 편",
    "6": "특수작전: 로어추적 편",
    "7": "Trip-Trap-Train",
  }
  assertEquals(matchName("Trip Trap Train!", names), "7")
  assertEquals(matchName("메인 스토리 연계 이벤트 강철대륙 공략전", names), "1")
  assertEquals(matchName("비밀의 미드나잇 파티", names), "4")
  assertEquals(matchName("순백의 예고장", names), undefined)
  assertEquals(matchName("순백의 예고장: 허식의 저택", names), "2")
  assertEquals(matchName("특수작전: 로어추적 편", names), undefined)
  assertEquals(matchName("없는 이야기", names), undefined)
  assertEquals(matchName("~!", names), undefined)
  assertEquals(matchName("파티", names), undefined)
})

Deno.test("parses event promo rows out of rendered bucket html", () => {
  const html =
    '<div class="mw-parser-output"><p>[{"_index":1,"PageName":"Reward campaigns"},' +
    '{"Id":812,"Promo":"File:Slapstick &amp; Sister.png"},{"Id":813},' +
    '{"Id":814,"Promo":""}]\n</p></div>'
  assertEquals(
    parseEventPromos(html),
    new Map([["812", "File:Slapstick & Sister.png"]]),
  )
})

Deno.test("falls back from event promo to the event logo", () => {
  const eventNames = { "812": "수녀님", "999": "로고만 있는 이벤트" }
  const promos = new Map([["812", "File:Nun.png"]])
  assertEquals(eventCandidates({ series: "수녀님", eventNames, promos }), [
    { file: "File:Nun.png", fit: "cover" },
    {
      url: "https://schaledb.com/images/eventlogo/812_Kr.webp",
      fit: "contain",
    },
  ])
  assertEquals(
    eventCandidates({ series: "로고만 있는 이벤트", eventNames, promos }),
    [{
      url: "https://schaledb.com/images/eventlogo/999_Kr.webp",
      fit: "contain",
    }],
  )
  assertEquals(
    eventCandidates({ series: "모르는 이벤트", eventNames, promos }),
    [],
  )
})

Deno.test("maps main series to act and volume keys", () => {
  assertEquals(mainVolumeKey("프롤로그", "part-1-to-final"), "1:0")
  assertEquals(mainVolumeKey("프롤로그", "part-2"), "2:P")
  assertEquals(mainVolumeKey("Vol.0 총학생회 편", "part-2"), "2:0")
  assertEquals(
    mainVolumeKey("Vol.4 카르바노그의 토끼 편", "post-final-to-decagrammaton"),
    "1:4",
  )
  assertEquals(
    mainVolumeKey(
      "Final. 그리고 모든 기적이 시작되는 곳 편",
      "part-1-to-final",
    ),
    "1:F",
  )
  assertEquals(
    mainVolumeKey("Ex. 데카그라마톤 편", "post-final-to-decagrammaton"),
    "1:EX",
  )
  assertEquals(mainVolumeKey("Ex. 로어추적 편", "part-2"), "2:EX")
  assertEquals(mainVolumeKey("알 수 없는 편", "part-2"), undefined)
})

Deno.test("reads the file after each main story volume heading", () => {
  const wikitext = `==Act 1==
===[[/Volume 0|Prologue]]===
[[File:BG CS PR 02.jpg|thumb|upright|right|''Prologue'']]
text [[File:Other.jpg|thumb]]
=== [[/Volume 5|Volume 5: ''Hyakkaryouran'']] ===
[[File:BG CS PV4 5 25.jpg|thumb]]
====Restriction====
[[File:Restriction.jpg]]
===[[/Volume EX|Volume EX: ''Decagrammaton'']]===
no file here
==Act 2==
===[[/Act 2/Volume P|Prologue]]===
===Volume 1: ''Fire and Shadow''===
===[[/Act 2/Volume 0|Volume 0]]===
[[File:Act 2 Zero.png|thumb]]
===FruLink===
[[File:Unrelated.jpg]]
`
  assertEquals(
    mainBackgrounds(wikitext),
    new Map([
      ["1:0", "File:BG CS PR 02.jpg"],
      ["1:5", "File:BG CS PV4 5 25.jpg"],
      ["1:EX", undefined],
      ["2:P", undefined],
      ["2:1", undefined],
      ["2:0", "File:Act 2 Zero.png"],
    ]),
  )
})

Deno.test("extracts the first file and first non-black background", () => {
  assertEquals(
    firstFile("a [[File:One Two.jpg|thumb]] [[File:Three.jpg]]"),
    "File:One Two.jpg",
  )
  assertEquals(firstFile("no images"), undefined)
  assertEquals(
    firstBackground("|background2=BG_Park_Night\n|background9=BG_Hall"),
    "BG_Park_Night",
  )
  assertEquals(
    firstBackground("|background1=BG_Black\n|background4=BG_Hall |x=1"),
    "BG_Hall",
  )
  assertEquals(firstBackground("|background1=BG_Black"), undefined)
  assertEquals(firstBackground("nothing"), undefined)
  assertEquals(backgroundCandidates("BG_Park"), [
    { file: "File:BG_Park.jpg", fit: "cover" },
    { file: "File:BG_Park.png", fit: "cover" },
  ])
  assertEquals(backgroundCandidates(undefined), [])
  assertEquals(fileCandidates(undefined), [])
})

Deno.test("resolves image info thumbnails through title normalization", () => {
  const thumbUrls = parseImageInfo({
    query: {
      normalized: [{ from: "File:BG_Park.jpg", to: "File:BG Park.jpg" }],
      pages: {
        "-1": { title: "File:BG Park.png" },
        "5": {
          title: "File:BG Park.jpg",
          imageinfo: [{ thumburl: "https://cdn/480px-BG_Park.jpg" }],
        },
      },
    },
  })
  const liveUrls = new Set(["https://logo/1.webp"])
  const pick = (
    candidates: Parameters<typeof pickThumbnail>[0]["candidates"],
  ) => pickThumbnail({ candidates, thumbUrls, liveUrls })

  assertEquals(pick(backgroundCandidates("BG_Park")), {
    url: "https://cdn/480px-BG_Park.jpg",
    fit: "cover",
  })
  assertEquals(pick(backgroundCandidates("BG_Missing")), undefined)
  assertEquals(
    pick([
      { file: "File:Missing Promo.png", fit: "cover" },
      { url: "https://logo/1.webp", fit: "contain" },
    ]),
    { url: "https://logo/1.webp", fit: "contain" },
  )
  assertEquals(
    pick([{ url: "https://logo/dead.webp", fit: "contain" }]),
    undefined,
  )
  assertEquals(parseImageInfo({}), new Map())
})

Deno.test("summarizes thumbnail coverage per kind", () => {
  const item = (kind: string, series: string, thumbnail?: boolean) => ({
    kind,
    series,
    ...(thumbnail ? { thumbnail: { url: "u", fit: "cover" as const } } : {}),
  })
  assertEquals(
    thumbnailCoverage(
      [
        item("메인", "Vol.1", true),
        item("메인", "Vol.1", true),
        item("미니", "a"),
        item("미니", "b"),
        item("이벤트", "e", true),
        item("이벤트", "e"),
      ] as Parameters<typeof thumbnailCoverage>[0],
    ),
    [
      { kind: "메인", series: 1, matched: 1, unmatched: [] },
      { kind: "미니", series: 2, matched: 0, unmatched: ["a", "b"] },
      { kind: "이벤트", series: 1, matched: 1, unmatched: [] },
    ],
  )
})

// Namu nests each heading in wrappers and puts the section's content in the
// heading's following sibling blocks.
const section = (title: string, ...blocks: string[]) =>
  `<div><div>&nbsp;</div><div><h2>${title}<a href="#edit">[편집]</a></h2></div><div>&nbsp;</div></div>${
    blocks.map((block) => `<div><div>${block}</div></div>`).join("")
  }`
const article = (...sections: string[]) =>
  parse(
    `<body><h1>문서</h1><div class="article">${sections.join("")}</div></body>`,
  )

const titleTable =
  `<table><tr><td><span><strong>덜렁대는 수녀님</strong><br>JA<br>EN</span></td></tr>
  <tr><td><iframe src="//youtube"></iframe></td></tr>
  <tr><td><details><summary>해외 버전 펼치기</summary><table>
    <tr><td><div>일본 서버 배너</div></td></tr></table></details></td></tr></table>`
const serviceDates =
  `<ul><li><div>일본 서비스: 2022년 2월 23일 ~ 3월 9일 <a href="https://news">공지</a></div></li></ul>`
const quote =
  `<blockquote><div>트리니티의 발굴구역, 경전이 발굴된다.<br>운반을 맡은 <a href="/w/a">히나타</a>였으나 사고가 났다!<a href="#fn-1">&#91;1&#93;</a><br>과연 복원은 제때 해낼 수 있을까?</div></blockquote>`
const wikiProse =
  `<div>트리니티를 배경으로 하는 이벤트.<a href="#fn-2">&#91;2&#93;</a></div>`
const eventSynopsis =
  "트리니티의 발굴구역, 경전이 발굴된다. 운반을 맡은 히나타였으나 사고가 났다! 과연 복원은 제때 해낼 수 있을까?"
const eventOptions = { plainCell: false }

Deno.test("extracts the official event synopsis and stops before the service dates", () => {
  assertEquals(
    overviewSynopsis(
      article(
        section("1. 개요", titleTable, quote, serviceDates, wikiProse),
        section("2. 등장인물", "<blockquote>다른 인용</blockquote>"),
      ),
      eventOptions,
    ),
    eventSynopsis,
  )
})

Deno.test("reads an event synopsis box placed after the service dates", () => {
  const box =
    `<table><tr><td></td><td><div><div>보더랜드 유원지의 이야기. <a href="/w/b">라브</a>가 이끄는 무리.</div></div><hr><div><span>이벤트 개요</span></div></td></tr></table>`
  assertEquals(
    overviewSynopsis(
      article(section("1. 개요", titleTable, serviceDates, box, wikiProse)),
      eventOptions,
    ),
    "보더랜드 유원지의 이야기. 라브가 이끄는 무리.",
  )
})

Deno.test("omits the event summary without an official synopsis", () => {
  const caption =
    `<table><tr><td><div><span>로비 및 전투 BGM - Step of Terror</span></div></td></tr></table>`
  assertEquals(
    overviewSynopsis(
      article(section("1. 개요", titleTable, caption, serviceDates, wikiProse)),
      eventOptions,
    ),
    undefined,
  )
  assertEquals(
    overviewSynopsis(
      article(section("2. 등장인물", quote)),
      eventOptions,
    ),
    undefined,
  )
  assertEquals(overviewSynopsis(parse("<p>empty</p>"), eventOptions), undefined)
})

Deno.test("reads the blurb cell of a volume info box only when asked", () => {
  const info = `<table>
    <tr><td><span><strong>대책위원회 편</strong><br>JA</span></td></tr>
    <tr><td><img src="x"></td></tr>
    <tr><td><div><span>아비도스가 폐교될 위기에 처했습니다.<br>학교를 지켜야 합니다!</span></div></td></tr></table>`
  const page = article(section("1. 개요", info, "<div>정리한 문서.</div>"))
  assertEquals(
    overviewSynopsis(page, { plainCell: true }),
    "아비도스가 폐교될 위기에 처했습니다. 학교를 지켜야 합니다!",
  )
  assertEquals(overviewSynopsis(page, eventOptions), undefined)
})

const chapterBox = (label: string, title: string, lines: string) =>
  `<table><tr><td><div><strong>${label}</strong></div><hr><div><strong>${title}</strong><br>${lines}</div></td></tr></table>`
const volumePage = article(
  section("4. 챕터별 정보"),
  section(
    "4.1. 1장 기묘한 하루",
    chapterBox(
      "1장",
      "기묘한 하루",
      "폐교를 막기 위해<br>세워진 대책위원회.[3]",
    ),
  ),
  section("4.1.1. 업데이트 정보", "<div>2021년</div>"),
  section("4.2. 2장 잃은 것", "<div>상자 없음</div>"),
  section(
    "4.3. 3장 흔적들",
    chapterBox("3장", "흔적들", "새로운 위협에 맞서야 합니다."),
  ),
)

Deno.test("reads a chapter intro by its own anchor", () => {
  assertEquals(
    chapterIntro(volumePage, "1장 기묘한 하루"),
    "폐교를 막기 위해 세워진 대책위원회.",
  )
  assertEquals(
    chapterIntro(volumePage, "3장  흔적들"),
    "새로운 위협에 맞서야 합니다.",
  )
})

Deno.test("omits a chapter intro for a missing anchor or a section without a box", () => {
  assertEquals(chapterIntro(volumePage, "9장 없는 장"), undefined)
  assertEquals(chapterIntro(volumePage, "2장 잃은 것"), undefined)
  assertEquals(chapterIntro(volumePage, "업데이트 정보"), undefined)
})

const link = (url: string) => ({ label: "l", url })
const volumeUrl = "https://namu.wiki/w/vol1"

Deno.test("picks the namu pages that summarize an item", () => {
  assertEquals(
    summarySources({
      kind: "메인",
      links: [link(volumeUrl), link(`${volumeUrl}#1%EC%9E%A5%20a`)],
    }),
    {
      urls: [volumeUrl],
      overviewUrl: volumeUrl,
      chapter: { url: volumeUrl, anchor: "1장 a" },
    },
  )
  assertEquals(
    summarySources({
      kind: "이벤트",
      links: [
        link("https://namu.wiki/w/e#frag"),
        link("https://namu.wiki/w/e"),
      ],
    }),
    {
      urls: ["https://namu.wiki/w/e"],
      overviewUrl: "https://namu.wiki/w/e",
      chapter: undefined,
    },
  )
  assertEquals(
    summarySources({ kind: "메인", links: [link("https://namu.wiki/w/s#p")] }),
    {
      urls: ["https://namu.wiki/w/s"],
      overviewUrl: undefined,
      chapter: { url: "https://namu.wiki/w/s", anchor: "p" },
    },
  )
  assertEquals(summarySources({ kind: "그룹", links: [] }), undefined)
  assertEquals(
    summarySources({ kind: "이벤트", links: [link("https://n/w/e#f")] }),
    undefined,
  )
  assertEquals(
    summarySources({ kind: "미니", links: [link("https://namu.wiki/w/m")] }),
    undefined,
  )
})

Deno.test("prefers the chapter intro and falls back to the volume blurb", () => {
  const withBlurb = article(
    section(
      "1. 개요",
      `<table><tr><td><span>볼륨 소개.</span></td></tr></table>`,
    ),
    section(
      "4.1. 1장 기묘한 하루",
      chapterBox("1장", "기묘한 하루", "장 소개."),
    ),
  )
  const sources = (anchor: string) => ({
    urls: [volumeUrl],
    overviewUrl: volumeUrl as string | undefined,
    chapter: { url: volumeUrl, anchor },
  })
  const pages = new Map([[volumeUrl, withBlurb]])
  assertEquals(itemSummary(sources("1장 기묘한 하루"), pages), "장 소개.")
  assertEquals(itemSummary(sources("2장 없음"), pages), "볼륨 소개.")
  assertEquals(
    itemSummary({ ...sources("2장 없음"), overviewUrl: undefined }, pages),
    undefined,
  )
  assertEquals(
    itemSummary(sources("1장 기묘한 하루"), new Map([[volumeUrl, undefined]])),
    undefined,
  )
})

Deno.test("omits a summary that is not Korean", () => {
  const japanese = article(
    section(
      "4.1. 1장 기묘한 하루",
      chapterBox("1장", "기묘한 하루", "在りし日の影が学園を覆う。"),
    ),
  )
  assertEquals(
    itemSummary(
      {
        urls: [volumeUrl],
        overviewUrl: undefined,
        chapter: { url: volumeUrl, anchor: "1장 기묘한 하루" },
      },
      new Map([[volumeUrl, japanese]]),
    ),
    undefined,
  )
})

Deno.test("summarizes summary coverage per kind", () => {
  assertEquals(
    summaryCoverage([
      { kind: "메인", summary: "a" },
      { kind: "메인" },
      { kind: "이벤트" },
      { kind: "미니", summary: "ignored" },
    ]),
    [
      { kind: "메인", total: 2, matched: 1 },
      { kind: "이벤트", total: 1, matched: 0 },
      { kind: "그룹", total: 0, matched: 0 },
    ],
  )
})
