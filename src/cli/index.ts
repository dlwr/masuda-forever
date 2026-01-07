#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { connectTursoFromEnvironment } from '../shared/database.js';
import { scrapeAnondUrls, scrapeAnondUrlsDateRange, scrapeHistoricalAnondUrls } from '../shared/scraper.js';

const program = new Command();

program.name('masuda-forever-cli').description('anond.hatelabo.jpの記事URLを保全するスクレイパー（CLI版）').version('1.0.0');

// 通常のスクレイピングコマンド
program
	.command('scrape')
	.description('最新の記事をスクレイピング')
	.option('-m, --max-pages <number>', '最大ページ数')
	.action(async (options) => {
		let client;
		try {
			client = connectTursoFromEnvironment();
			console.log('スクレイピングを開始します...');
			const result = await scrapeAnondUrls(client, options.maxPages ? Number.parseInt(options.maxPages) : undefined);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (client) {
				client.close();
			}
		}
	});

// 過去記事のスクレイピングコマンド
program
	.command('scrape-historical')
	.description('特定日付の過去記事をスクレイピング')
	.requiredOption('-d, --date <YYYYMMDD>', 'スクレイピングする日付')
	.action(async (options) => {
		let client;
		try {
			client = connectTursoFromEnvironment();
			console.log(`${options.date}の記事をスクレイピングします...`);
			const result = await scrapeHistoricalAnondUrls(client, options.date);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (client) {
				client.close();
			}
		}
	});

// 過去記事のスクレイピングコマンド（日付範囲指定）
program
	.command('scrape-historical-range')
	.description('日付範囲の過去記事をスクレイピング（複数年分）')
	.requiredOption('-s, --start-date <MMDD>', 'スクレイピングする開始日')
	.requiredOption('-e, --end-date <MMDD>', 'スクレイピングする終了日')
	.action(async (options) => {
		let client;
		try {
			client = connectTursoFromEnvironment();
			console.log(`${options.startDate}から${options.endDate}の記事をスクレイピングします...`);
			const result = await scrapeAnondUrlsDateRange(client, options.startDate, options.endDate);
			console.log('スクレイピング完了:');
			console.log(`- 新規URL: ${result.newUrls.length}件`);
			console.log(`- 既存URL: ${result.existingUrlsCount}件`);
			console.log(`- 処理ページ数: ${result.pagesScraped}ページ`);
		} catch (error) {
			console.error('スクレイピング中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (client) {
				client.close();
			}
		}
	});

// スクレイピング進捗テーブルの初期化コマンド
program
	.command('init-progress')
	.description('scrape_progressテーブルに全日付を投入')
	.option('--start-year <year>', '開始年', '2006')
	.option('--end-year <year>', '終了年（指定しない場合は昨年）')
	.option('--analyze', '既存データを分析して欠損日付のみ投入', false)
	.action(async (options) => {
		let client;
		try {
			client = connectTursoFromEnvironment();

			const startYear = Number.parseInt(options.startYear);
			const endYear = options.endYear ? Number.parseInt(options.endYear) : new Date().getFullYear() - 1;

			console.log(`進捗テーブルを初期化します: ${startYear}年〜${endYear}年`);

			// テーブルが存在することを確認
			await client.execute(`
				CREATE TABLE IF NOT EXISTS scrape_progress (
					date TEXT PRIMARY KEY,
					status TEXT DEFAULT 'pending',
					last_page_url TEXT,
					pages_scraped INTEGER DEFAULT 0,
					urls_found INTEGER DEFAULT 0,
					updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
				)
			`);

			// 既存データを分析するか全日付を投入するか
			await (options.analyze
				? initProgressWithAnalysis(client, startYear, endYear)
				: initProgressAllDates(client, startYear, endYear));

			console.log('初期化完了');
		} catch (error) {
			console.error('初期化中にエラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (client) {
				client.close();
			}
		}
	});

// 進捗状況を表示するコマンド
program
	.command('show-progress')
	.description('スクレイピング進捗状況を表示')
	.action(async () => {
		let client;
		try {
			client = connectTursoFromEnvironment();

			const statusResult = await client.execute(`
				SELECT status, COUNT(*) as count
				FROM scrape_progress
				GROUP BY status
			`);

			console.log('=== スクレイピング進捗状況 ===');
			for (const row of statusResult.rows) {
				console.log(`${row.status}: ${row.count}件`);
			}

			const inProgressResult = await client.execute(`
				SELECT date, pages_scraped, urls_found
				FROM scrape_progress
				WHERE status = 'in_progress'
				ORDER BY date
				LIMIT 10
			`);

			if (inProgressResult.rows.length > 0) {
				console.log('\n=== 処理中の日付 ===');
				for (const row of inProgressResult.rows) {
					console.log(`${row.date}: ${row.pages_scraped}ページ完了、${row.urls_found}件取得`);
				}
			}
		} catch (error) {
			console.error('エラーが発生しました:', error);
			process.exit(1);
		} finally {
			if (client) {
				client.close();
			}
		}
	});

/**
 * 全日付を進捗テーブルに投入
 */
async function initProgressAllDates(
	client: ReturnType<typeof connectTursoFromEnvironment>,
	startYear: number,
	endYear: number,
): Promise<void> {
	const dates: string[] = [];

	for (let year = startYear; year <= endYear; year++) {
		// 2006年は9月24日から
		const startMonth = year === 2006 ? 9 : 1;
		const startDay = year === 2006 ? 24 : 1;

		for (let month = startMonth; month <= 12; month++) {
			const daysInMonth = new Date(year, month, 0).getDate();
			const firstDay = month === startMonth && year === 2006 ? startDay : 1;

			for (let day = firstDay; day <= daysInMonth; day++) {
				const dateString = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
				dates.push(dateString);
			}
		}
	}

	console.log(`${dates.length}件の日付を投入します...`);

	// バッチ挿入（100件ずつ）
	const batchSize = 100;
	let inserted = 0;

	for (let index = 0; index < dates.length; index += batchSize) {
		const batch = dates.slice(index, index + batchSize);
		const placeholders = batch.map(() => '(?)').join(', ');
		await client.execute({
			sql: `INSERT OR IGNORE INTO scrape_progress (date) VALUES ${placeholders}`,
			args: batch,
		});
		inserted += batch.length;
		if (inserted % 1000 === 0) {
			console.log(`${inserted}/${dates.length}件完了...`);
		}
	}

	console.log(`${dates.length}件の日付を投入しました`);
}

/**
 * 既存データを分析して欠損日付のみ投入
 */
async function initProgressWithAnalysis(
	client: ReturnType<typeof connectTursoFromEnvironment>,
	startYear: number,
	endYear: number,
): Promise<void> {
	console.log('既存データを分析中...');

	// 既存の日付（YYYYMMDD）を取得
	const existingResult = await client.execute(`
		SELECT DISTINCT substr(url, 27, 8) as date
		FROM article_urls
		WHERE length(url) >= 35
	`);

	const existingDates = new Set(existingResult.rows.map((row) => row.date as string));
	console.log(`既存データ: ${existingDates.size}件の日付`);

	// 全日付を生成
	const allDates: string[] = [];
	for (let year = startYear; year <= endYear; year++) {
		const startMonth = year === 2006 ? 9 : 1;
		const startDay = year === 2006 ? 24 : 1;

		for (let month = startMonth; month <= 12; month++) {
			const daysInMonth = new Date(year, month, 0).getDate();
			const firstDay = month === startMonth && year === 2006 ? startDay : 1;

			for (let day = firstDay; day <= daysInMonth; day++) {
				const dateString = `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}`;
				allDates.push(dateString);
			}
		}
	}

	// 欠損日付を特定
	const missingDates = allDates.filter((date) => !existingDates.has(date));
	console.log(`欠損日付: ${missingDates.length}件`);

	if (missingDates.length === 0) {
		console.log('欠損日付はありません');
		return;
	}

	// 欠損日付のみ投入
	const batchSize = 100;
	let inserted = 0;

	for (let index = 0; index < missingDates.length; index += batchSize) {
		const batch = missingDates.slice(index, index + batchSize);
		const placeholders = batch.map(() => '(?)').join(', ');
		await client.execute({
			sql: `INSERT OR IGNORE INTO scrape_progress (date) VALUES ${placeholders}`,
			args: batch,
		});
		inserted += batch.length;
		if (inserted % 500 === 0) {
			console.log(`${inserted}/${missingDates.length}件完了...`);
		}
	}

	console.log(`${missingDates.length}件の欠損日付を投入しました`);
}

program.parse(process.argv);
