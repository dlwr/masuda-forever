-- マイグレーション: schema.sql と本番のインデックスのズレを解消
-- url は UNIQUE 制約で自動インデックスが張られるため idx_article_urls_url は重複

DROP INDEX IF EXISTS idx_article_urls_url;

CREATE INDEX IF NOT EXISTS idx_scrape_progress_status ON scrape_progress (status);
