# Sefirot

A blue archive story tracker and visualizer.

## Run

You need to have Deno v2.0.0 or later installed to run this repo.

Start a dev server:

```
$ deno task dev
```

## Data

`src/data/blue-archive-story-order.jsonc` is crawled from namu.wiki, which blocks GitHub-hosted runners. A systemd user timer on a maintainer machine crawls weekly and publishes the result as a `data-YYYY-MM-DD` GitHub release; publishing triggers the deploy.

```
$ deno task crawl            # crawl into src/data/ by hand
$ deno task publish-data     # crawl and publish a release if the data changed
```

Install the timer (adjust `WorkingDirectory` in the service if the clone is elsewhere; needs `gh auth login` and Playwright's Chromium):

```
$ systemctl --user link $PWD/systemd/sefirot-data.service $PWD/systemd/sefirot-data.timer
$ systemctl --user enable --now sefirot-data.timer
```

`publish-data` refuses to publish when the crawl has under 90% of the previous release's stories, and skips unchanged data, so several machines can run the timer.

## Localization

UI text uses [Lingui](https://lingui.dev) with Korean as the source language. Edit the `en` and `ja` translations in `src/locales/*.po`, then update the catalogs after changing UI text:

```
$ deno task i18n
```

The crawl adds `l10n.en` and `l10n.ja` to events, groups and main volumes: names from [SchaleDB](https://schaledb.com), English summaries and banner PNGs from [Blue Archive Wiki](https://bluearchive.wiki). No source has Japanese summaries, so the Japanese view shows the Korean one.

## Deploy

[`deploy.yml`](.github/workflows/deploy.yml) deploys to Cloudflare Pages project `sefirot` on every push to `main`, every published release and on manual dispatch. It uses the newer of the latest data release and the committed data file.

Setup:

1. Create the Pages project: `deno run -A npm:wrangler pages project create sefirot --production-branch main`
2. Add repository secrets `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (Account › Cloudflare Pages › Edit).

## Disclaimer

Blue Archive © 2021 NEXON Korea Corp. & NEXON Games Co., Ltd. (Japan: Yostar, Inc.). This is an unofficial, non-commercial fan project, not affiliated with or endorsed by NEXON Korea, NEXON Games or Yostar. All game images and text belong to their respective owners. Rights holders can request removal through an issue.

## Data and licenses

- Source code: [AGPL-3.0](LICENSE). The license does not cover game assets, such as the school emblems in `src/assets/school-emblems/` and the story images linked from other sites.
- Story order, notes and summaries are crawled from [namu.wiki](https://namu.wiki/w/틀:블루%20아카이브%20스토리%20시점순) under [CC BY-NC-SA 2.0 KR](https://creativecommons.org/licenses/by-nc-sa/2.0/kr/); the generated `src/data/` file inherits that license.
- Story images and English summaries are linked from namu.wiki, [Blue Archive Wiki](https://bluearchive.wiki) and [SchaleDB](https://schaledb.com) without being copied.
