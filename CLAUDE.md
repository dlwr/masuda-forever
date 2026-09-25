# CLAUDE.md

anond.hatelabo.jp の記事URLを Turso に保全し、`/` で今日と同じ月日の過去記事へランダムにリダイレクトする Cloudflare Workers アプリ。使い方は README.md を参照。

## コマンド

- `npm test`（vitest）/ `npm run lint` / `npx tsc --noEmit`（事前に `npm run cf-typegen`）/ `npm run format`
- `npm run deploy`
- CLI: `npm run cli <command>`（`.env` の Turso に接続）

## 構成

- `src/index.ts`: Workers エントリ。`fetch` が `/` のリダイレクト、`scheduled`（毎分）が新着取得と `scrape_progress` による過去日付の埋め合わせ
- `src/shared/article-picker.ts`: リダイレクト先の選択。年をランダムな順に探し、記事を GET して 404 なら `deleted_at` を付けて選び直す（最大3回）
- `src/shared/scraper.ts`: スクレイピング。Workers は正規表現パーサー（`extractArticlesWithRegex`）、CLI の一部は cheerio
- `src/shared/database.ts`: CLI 用の Turso 接続
- `src/cli/index.ts`: CLI（commander）

## DB

- スキーマは `schema.sql`。変更は `migrations/NNN_*.sql` を追加し、本番 Turso に適用する（`turso` CLI か、`.env` を使って `@libsql/client` の `executeMultiple`）
- `article_urls.url_year` / `url_monthday` は URL（`https://anond.hatelabo.jp/YYYYMMDDHHMMSS`）から取り出した年・月日。`extractUrlDate` を使う
- 約780万行ある。全件スキャンや全行 UPDATE は Turso の rows read/written を大きく消費するので、id 範囲で分割するなど避ける

## anond の癖

- 削除済み記事も存在しない記事も 404。HEAD は 405 になるので GET で確認する
- タイトルのない記事は `■` で保存する
