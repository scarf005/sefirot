#!/usr/bin/env -S deno run -A
/// <reference lib="deno.ns" />

import { parse } from "@std/jsonc"

const TAG_PREFIX = "data-"
const ASSET = "blue-archive-story-order.jsonc"
// A blocked or partial crawl must not replace good data.
const MIN_ITEM_RATIO = 0.9

type StoryData = { generatedAt: string; items: unknown[] }

const run = async (cmd: string, args: string[]) => {
  const { success, stdout, stderr } = await new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output()
  const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
  if (!success) throw new Error(`${cmd} ${args.join(" ")}\n${text(stderr)}`)
  return text(stdout)
}

const read = async (path: string) =>
  parse(await Deno.readTextFile(path)) as StoryData

const comparable = ({ items }: StoryData) => JSON.stringify(items)

const latestRelease = async () => {
  const releases: { tagName: string }[] = JSON.parse(
    await run("gh", ["release", "list", "--json", "tagName", "--limit", "50"]),
  )
  return releases.map((release) => release.tagName)
    .filter((tag) => tag.startsWith(TAG_PREFIX))
    .sort().at(-1)
}

const publish = async (dir: string) => {
  const output = `${dir}/${ASSET}`
  const crawl = await new Deno.Command("deno", {
    args: ["run", "-A", "scripts/crawl-data.ts", "--output", output],
  }).spawn().status
  if (!crawl.success) throw new Error("Crawl failed")
  const fresh = await read(output)

  const tag = await latestRelease()
  if (tag) {
    await run("gh", [
      "release",
      "download",
      tag,
      "--pattern",
      ASSET,
      "--dir",
      `${dir}/previous`,
    ])
    const previous = await read(`${dir}/previous/${ASSET}`)
    if (fresh.items.length < previous.items.length * MIN_ITEM_RATIO) {
      throw new Error(
        `Crawled ${fresh.items.length} stories, ${tag} has ${previous.items.length}; not publishing`,
      )
    }
    if (comparable(fresh) === comparable(previous)) {
      console.log(`Unchanged since ${tag}`)
      return
    }
  }

  const next = `${TAG_PREFIX}${fresh.generatedAt.slice(0, 10)}`
  await run("gh", [
    "release",
    "create",
    next,
    output,
    "--title",
    `Story data ${fresh.generatedAt.slice(0, 10)}`,
    "--notes",
    `${fresh.items.length} stories crawled from namu.wiki`,
    "--latest=false",
  ])
  console.log(`Published ${next} (${fresh.items.length} stories)`)
}

const main = async () => {
  // gio trash cannot handle /tmp, so keep scratch space in the XDG cache.
  const cache = `${
    Deno.env.get("XDG_CACHE_HOME") ?? `${Deno.env.get("HOME")}/.cache`
  }/sefirot`
  await Deno.mkdir(cache, { recursive: true })
  const dir = await Deno.makeTempDir({ dir: cache, prefix: "publish-" })
  try {
    await publish(dir)
  } finally {
    await run("gio", ["trash", dir])
  }
}

if (import.meta.main) await main()
