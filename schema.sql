-- URLを保存するためのテーブル
CREATE TABLE IF NOT EXISTS article_urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT UNIQUE NOT NULL,
  title TEXT,
  url_year TEXT,       -- URLから抽出した年（YYYY形式）- インデックス用
  url_monthday TEXT,   -- URLから抽出した月日（MMDD形式）- インデックス用
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed BOOLEAN DEFAULT FALSE
);

-- urlカラムにインデックスを追加
CREATE INDEX IF NOT EXISTS idx_article_urls_url ON article_urls (url);

-- 年・月日の複合インデックス（ランダムリダイレクト高速化用）
CREATE INDEX IF NOT EXISTS idx_article_urls_year_monthday ON article_urls (url_year, url_monthday);

-- スクレイピング進捗追跡テーブル
CREATE TABLE IF NOT EXISTS scrape_progress (
  date TEXT PRIMARY KEY,           -- YYYYMMDD形式
  status TEXT DEFAULT 'pending',   -- pending, in_progress, completed
  last_page_url TEXT,              -- ページネーション再開用
  pages_scraped INTEGER DEFAULT 0,
  urls_found INTEGER DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- status検索用インデックス
CREATE INDEX IF NOT EXISTS idx_scrape_progress_status ON scrape_progress (status);
