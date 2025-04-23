#!/usr/bin/env node

import { Command } from 'commander';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { Database, scrapeAnondUrls, scrapeAnondUrlsDateRange, scrapeHistoricalAnondUrls } from '../shared/scraper.ts';

const program = new Command();

program.name('masuda-forever-cli').description('anond.hatelabo.jpの記事URLを保全するスクレイパー（CLI版）').version('1.0.0');

// データベース接続の設定
async function getDatabase(): Promise<Database> {
	const database = await open({
		// filename: './masuda-forever.db',
		filename: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/690b875e89b18d96d1380c58760cb1371052019a77ba2f476678bbce5add2107.sqlite',
		driver: sqlite3.Database,
	});

	// テーブルが存在しない場合は作成
	await database.exec(`
    CREATE TABLE IF NOT EXISTS article_urls (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL
    )
  `);

	return database;
}

// 通常のスクレイピングコマンド
program
	.command('scrape')
	.description('最新の記事をスクレイピング')
	.option('-m, --max-pages <number>', '最大ページ数')
	.action(async (options) => {
		let database;
		try {
			database = await getDatabase();
			console.log('スクレイピングを開始します...');
			const result = await scrapeAnondUrls(database, options.maxPages ? Number.parseInt(options.maxPages) : undefined);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (database) {
				try {
					await database.close();
				} catch (error) {
					console.error('データベースのクローズ中にエラーが発生しました:', error);
				}
			}
		}
	});

// 過去記事のスクレイピングコマンド
program
	.command('scrape-historical')
	.description('特定日付の過去記事をスクレイピング')
	.requiredOption('-d, --date <YYYYMMDD>', 'スクレイピングする日付')
	.action(async (options) => {
		let database;
		try {
			database = await getDatabase();
			console.log(`${options.date}の記事をスクレイピングします...`);
			const result = await scrapeHistoricalAnondUrls(database, options.date);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (database) {
				try {
					await database.close();
				} catch (error) {
					console.error('データベースのクローズ中にエラーが発生しました:', error);
				}
			}
		}
	});

// 過去記事のスクレイピングコマンド
program
	.command('scrape-historical-range')
	.description('特定日付の過去記事をスクレイピング')
	.requiredOption('-s, --start-date <MMDD>', 'スクレイピングする開始日')
	.requiredOption('-e, --end-date <MMDD>', 'スクレイピングする終了日')
	.action(async (options) => {
		let database;
		try {
			database = await getDatabase();
			console.log(`${options.startDate}から${options.endDate}の記事をスクレイピングします...`);
			const result = await scrapeAnondUrlsDateRange(database, options.startDate, options.endDate);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (database) {
				try {
					await database.close();
				} catch (error) {
					console.error('データベースのクローズ中にエラーが発生しました:', error);
				}
			}
		}
	});

program.parse(process.argv);
