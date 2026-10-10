# Sefirot

A blue archive story tracker and visualizer.

## Run

You need to have Deno v2.0.0 or later installed to run this repo.

Start a dev server:

```
$ deno task dev
```

## Deploy

Build production assets:

```
$ deno task build
```

## Disclaimer

Blue Archive © 2021 NEXON Korea Corp. & NEXON Games Co., Ltd. (Japan: Yostar, Inc.). This is an unofficial, non-commercial fan project, not affiliated with or endorsed by NEXON Korea, NEXON Games or Yostar. All game images and text belong to their respective owners. Rights holders can request removal through an issue.

## Data and licenses

- Source code: [AGPL-3.0](LICENSE). The license does not cover game assets, such as the school emblems in `src/assets/school-emblems/` and the story images linked from other sites.
- Story order, notes and summaries are crawled from [namu.wiki](https://namu.wiki/w/틀:블루%20아카이브%20스토리%20시점순) under [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/); the generated `src/data/` file inherits that license.
- Story images are linked from namu.wiki, [Blue Archive Wiki](https://bluearchive.wiki) and [SchaleDB](https://schaledb.com) without being copied.
