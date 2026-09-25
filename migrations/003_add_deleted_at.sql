-- マイグレーション: anond 側で削除された記事をリダイレクト対象から外すため deleted_at を追加

ALTER TABLE article_urls ADD COLUMN deleted_at TIMESTAMP;
