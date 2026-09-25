# masuda-forever

はてな匿名ダイアリー（anond.hatelabo.jp）の記事URLとタイトルを Turso に保全し、`/` にアクセスすると「今日と同じ月日」の過去記事へランダムにリダイレクトする Cloudflare Workers アプリ。

## 動作

- `/`: 今日（JST）と同じ月日の過去記事へ 302 リダイレクト。リダイレクト前に記事を GET し、404（anond 側で削除済み）なら `deleted_at` を付けて選び直す
- cron（毎分）: トップページ1ページ分の新着記事を保存し、`scrape_progress` に残っている過去日付を1ページずつ埋める

## セットアップ

```bash
npm install
cp .env.example .env  # TURSO_DB_URL と TURSO_AUTH_TOKEN を設定
```

本番の `TURSO_DB_URL` と `TURSO_AUTH_TOKEN` は `wrangler secret put` で設定する。スキーマは `schema.sql`、既存DBへの変更は `migrations/` を順に適用する。

## 開発

```bash
npm run dev     # ローカル実行（/__scheduled で cron を試せる）
npm test
npm run lint
npm run deploy
```

## CLI

`.env` の Turso に対して直接スクレイピングする。

```bash
npm run cli scrape -- -m 5                             # 最新記事を5ページ分
npm run cli scrape-historical -- -d 20240101            # 特定日付
npm run cli scrape-historical-range -- -s 0101 -e 0105  # 月日範囲を2006年〜今年分
npm run cli init-progress -- --analyze                  # 欠損日付を scrape_progress に投入
npm run cli show-progress
```

## ライセンス

MIT License

Copyright (c) 2024

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
