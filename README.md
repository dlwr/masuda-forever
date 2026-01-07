# masuda-forever

anond.hatelabo.jpの記事URLを保全し再利用するためのCloudflare Workersアプリケーション

## 概要

このプロジェクトは、はてな匿名ダイアリー（anond.hatelabo.jp）の記事URLを保全し、再利用するためのCloudflare Workersアプリケーションです。記事のURLとタイトルをTurso（libSQL）データベースに保存し、過去の記事にランダムでリダイレクトする機能などを提供します。スクレイピングはURL保全のための手段として使用しています。

## 機能

- URLの保全：はてな匿名ダイアリーの記事URLとタイトルを収集・保存
- ランダムリダイレクト：保存された過去の記事にランダムでアクセスできる機能
- 過去の特定日付の記事URLを取得
- 日付範囲を指定した記事URLの一括保全
- 特定の月日（例: 0101）に対して複数年のデータを一括取得
- 毎分のcronジョブによる自動URL収集

## 技術スタック

- [Cloudflare Workers](https://workers.cloudflare.com/)
- [Turso](https://turso.tech/) (libSQL/SQLite互換データベース)
- [TypeScript](https://www.typescriptlang.org/)
- [Cheerio](https://cheerio.js.org/) (HTMLパース)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (開発・デプロイツール)

## 開発環境のセットアップ

### 前提条件

- Node.js (最新LTS推奨)
- npm または yarn
- Cloudflareアカウント

### インストール

```bash
# リポジトリをクローン
git clone https://github.com/yourusername/masuda-forever.git
cd masuda-forever

# 依存関係のインストール
npm install
```

### 環境設定

1. Tursoでデータベースを作成し、URLとAuth Tokenを取得してください。
2. `wrangler.jsonc` の `TURSO_DB_URL` を設定してください。
3. `TURSO_AUTH_TOKEN` はシークレットとして設定してください（例: `wrangler secret put TURSO_AUTH_TOKEN`）。ローカル開発時は `.dev.vars` での設定も可能です。
4. `schema.sql` をTursoに適用してください（Turso CLIまたはダッシュボードのSQL実行機能を使用）。

## 開発

```bash
# 開発サーバーの起動
npm run dev

# コードフォーマット
npm run format

# リント
npm run lint
```

## デプロイ

```bash
npm run deploy
```

## API エンドポイント

- `/random` - 保存されている記事からランダムに一つ選んでリダイレクト

以下のエンドポイントは開発環境でのみ利用可能です：

- `/scrape` - 現在の記事URLを収集
- `/scrape-historical?date=YYYYMMDD` - 指定日付の記事を収集
- `/scrape-historical-batch?startDate=YYYYMMDD&endDate=YYYYMMDD&maxDays=N` - 日付範囲の記事を一括収集
- `/scrape/date/MMDD` - 指定月日の複数年の記事を収集
- `/scrape/date-range` - 指定した日付範囲の記事を収集

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
