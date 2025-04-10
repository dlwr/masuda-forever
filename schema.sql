-- URLを保存するためのテーブル
CREATE TABLE IF NOT EXISTS article_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed BOOLEAN DEFAULT FALSE
);

-- urlカラムにインデックスを追加
CREATE INDEX IF NOT EXISTS idx_article_urls_url ON article_urls (url);
