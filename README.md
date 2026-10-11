# Sefirot

A blue archive story tracker and visualizer.

## Run

You need to have Deno v2.0.0 or later installed to run this repo.

Start a dev server:

```
$ deno task dev
```

## Data

`src/data/blue-archive-story-order.jsonc` is generated from namu.wiki. Refresh and commit it locally:

```
$ deno task crawl
```

## Deploy

[`deploy.yml`](.github/workflows/deploy.yml) builds and deploys to Cloudflare Pages project `sefirot` on every push to `main`, every Sunday and on manual dispatch. It crawls first and, when namu.wiki blocks the runner, uses the newer of the last `story-data` artifact and the committed file.

Setup:

1. Create the Pages project: `deno run -A npm:wrangler pages project create sefirot --production-branch main`
2. Add repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Account › Cloudflare Pages › Edit).

## Disclaimer

Blue Archive © 2021 NEXON Korea Corp. & NEXON Games Co., Ltd. (Japan: Yostar, Inc.). This is an unofficial, non-commercial fan project, not affiliated with or endorsed by NEXON Korea, NEXON Games or Yostar. All game images and text belong to their respective owners. Rights holders can request removal through an issue.

## Data and licenses

- Source code: [AGPL-3.0](LICENSE). The license does not cover game assets, such as the school emblems in `src/assets/school-emblems/` and the story images linked from other sites.
- Story order, notes and summaries are crawled from [namu.wiki](https://namu.wiki/w/틀:블루%20아카이브%20스토리%20시점순) under [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/); the generated `src/data/` file inherits that license.
- Story images are linked from namu.wiki, [Blue Archive Wiki](https://bluearchive.wiki) and [SchaleDB](https://schaledb.com) without being copied.
