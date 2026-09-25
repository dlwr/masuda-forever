-- マイグレーション: batchInsertUrls が1文字ずれて保存した url_year, url_monthday を修正
-- 行数が多いため、本番では id 範囲で分割して実行する

UPDATE article_urls
SET url_year = substr(url, 27, 4),
    url_monthday = substr(url, 31, 4)
WHERE length(url) >= 34
  AND (url_year IS NOT substr(url, 27, 4) OR url_monthday IS NOT substr(url, 31, 4));
