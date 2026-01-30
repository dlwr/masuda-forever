-- マイグレーション: article_urlsテーブルにurl_year, url_monthdayカラムを追加
-- 実行方法: Turso CLIで実行
--   turso db shell <database-name> < migrations/001_add_url_year_monthday.sql

-- 1. 新カラムを追加
ALTER TABLE article_urls ADD COLUMN url_year TEXT;
ALTER TABLE article_urls ADD COLUMN url_monthday TEXT;

-- 2. 既存データを更新（URLから年と月日を抽出）
-- URL形式: https://anond.hatelabo.jp/YYYYMMDDHHMMSS
-- 位置27から4文字が年（YYYY）、位置31から4文字が月日（MMDD）
UPDATE article_urls
SET url_year = substr(url, 27, 4),
    url_monthday = substr(url, 31, 4)
WHERE url_year IS NULL
  AND length(url) >= 35;

-- 3. 複合インデックスを作成（ランダムリダイレクトの高速化）
CREATE INDEX IF NOT EXISTS idx_article_urls_year_monthday
ON article_urls (url_year, url_monthday);
