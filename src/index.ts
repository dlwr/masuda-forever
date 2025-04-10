/**
 * masuda-forever
 *
 * anond.hatelabo.jpの記事URLを保全するスクレイパー
 */

import * as cheerio from 'cheerio';

// 環境変数インターフェースに IS_DEVELOPMENT フラグを追加
interface Environment {
	DB: D1Database;
	IS_DEVELOPMENT?: boolean;
}

interface ArticleURL {
	url: string;
	title: string;
}

interface ScrapeResult {
	newUrls: ArticleURL[];
	existingUrlsCount: number;
	pagesScraped: number;
}

interface HistoricalScrapeResult extends ScrapeResult {
	date: string;
}

interface BatchScrapeByMonthDayResult {
	results: HistoricalScrapeResult[];
	totalNewUrls: number;
	totalExistingUrls: number;
	totalPagesScrapped: number;
	yearsProcessed: string[];
	failedYears: Record<string, string>;
	monthDay: string;
}

// 日付範囲スクレイピング結果のインターフェース
interface DateRangeBatchScrapeResult {
	dateResults: Record<string, BatchScrapeByMonthDayResult>; // key: MMDD, value: その日の結果
	totalNewUrls: number;
	totalExistingUrls: number;
	totalPagesScrapped: number;
	datesProcessed: string[]; // 処理した日付（MMDD形式）
	failedDates: Record<string, string>; // 処理に失敗した日付
	startMonthDay: string; // 開始月日（MMDD）
	endMonthDay: string; // 終了月日（MMDD）
}

export default {
	async fetch(request: Request, environment: Environment): Promise<Response> {
		const url = new URL(request.url);

		// 開発環境以外ではスクレイピングエンドポイントへのアクセスを制限
		const isScrapingEndpoint =
			url.pathname === '/scrape' ||
			url.pathname === '/scrape-historical' ||
			url.pathname === '/scrape-historical-batch' ||
			url.pathname.match(/^\/scrape\/date\/\d{4}$/) ||
			url.pathname === '/scrape/date-range';

		// 本番環境でスクレイピングエンドポイントにアクセスした場合は403を返す
		if (isScrapingEndpoint && !environment.IS_DEVELOPMENT) {
			return new Response(JSON.stringify({ error: 'Scraping endpoints are only available in development environment' }), {
				status: 403,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// 手動でスクレイピングを実行するエンドポイント
		if (url.pathname === '/scrape') {
			try {
				const result = await scrapeAnondUrls(environment);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 過去記事スクレイピングのエンドポイント
		if (url.pathname === '/scrape-historical') {
			try {
				const dateParameter = url.searchParams.get('date');
				if (!dateParameter) {
					return new Response(JSON.stringify({ error: '日付パラメータが必要です（YYYYMMDD形式）' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				const dateRegex = /^\d{8}$/;
				if (!dateRegex.test(dateParameter)) {
					return new Response(JSON.stringify({ error: '日付はYYYYMMDD形式で指定してください' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					});
				}

				const result = await scrapeHistoricalAnondUrls(environment, dateParameter);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 過去記事バッチスクレイピングのエンドポイント
		if (url.pathname === '/scrape-historical-batch') {
			try {
				const startDateParameter = url.searchParams.get('startDate');
				const endDateParameter = url.searchParams.get('endDate');

				if (!startDateParameter || !endDateParameter) {
					return new Response(
						JSON.stringify({
							error: '開始日(startDate)と終了日(endDate)のパラメータが必要です（YYYYMMDD形式）',
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						},
					);
				}

				const dateRegex = /^\d{8}$/;
				if (!dateRegex.test(startDateParameter) || !dateRegex.test(endDateParameter)) {
					return new Response(
						JSON.stringify({
							error: '日付はYYYYMMDD形式で指定してください',
						}),
						{
							status: 400,
							headers: { 'Content-Type': 'application/json' },
						},
					);
				}

				// 最大処理日数を制限（APIタイムアウト対策）
				const maxDaysParameter = url.searchParams.get('maxDays');
				const maxDays = maxDaysParameter ? Number.parseInt(maxDaysParameter) : undefined;

				const result = await batchScrapeHistoricalAnondUrls(environment, startDateParameter, endDateParameter, maxDays);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 新しいエンドポイント: 指定された月日の複数年スクレイピング
		const dateScrapeMatch = url.pathname.match(/^\/scrape\/date\/(\d{4})$/);
		if (dateScrapeMatch) {
			const monthDay = dateScrapeMatch[1]; // MMDD形式

			// MMDD形式の基本的な検証 (例: 0101 - 1231)
			const month = Number.parseInt(monthDay.slice(0, 2), 10);
			const day = Number.parseInt(monthDay.slice(2, 4), 10);
			if (month < 1 || month > 12 || day < 1 || day > 31) {
				return new Response(JSON.stringify({ error: '無効な月日形式です。MMDD形式で指定してください (例: 0101)。' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' },
				});
			}

			try {
				const startYear = 2006;
				const endYear = 2025;
				const response: BatchScrapeByMonthDayResult = {
					results: [],
					totalNewUrls: 0,
					totalExistingUrls: 0,
					totalPagesScrapped: 0,
					yearsProcessed: [],
					failedYears: {},
					monthDay: monthDay,
				};

				for (let year = startYear; year <= endYear; year++) {
					const yearString = String(year);
					const dateString = `${yearString}${monthDay}`; // YYYYMMDD
					console.log(`Scraping for date: ${dateString}`);
					try {
						const result = await scrapeHistoricalAnondUrls(environment, dateString);
						response.results.push(result);
						response.totalNewUrls += result.newUrls.length;
						response.totalExistingUrls += result.existingUrlsCount;
						response.totalPagesScrapped += result.pagesScraped;
						response.yearsProcessed.push(yearString);
						console.log(`Completed scraping for ${dateString}: ${result.newUrls.length} new URLs.`);
					} catch (error: unknown) {
						const reason = error instanceof Error ? error.message : String(error);
						response.failedYears[yearString] = reason;
						console.error(`Failed scraping for ${dateString}: ${reason}`);
					}

					// 各年の処理間に待機時間を追加（例: 500ミリ秒）
					await new Promise((resolve) => setTimeout(resolve, 500));
				}

				return new Response(JSON.stringify(response), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// 新しいエンドポイント: 月日の範囲に対する複数年スクレイピング
		if (url.pathname === '/scrape/date-range') {
			const startMonthDay = url.searchParams.get('startDate');
			const endMonthDay = url.searchParams.get('endDate');

			if (!startMonthDay || !endMonthDay) {
				return new Response(
					JSON.stringify({
						error: '開始日(startDate)と終了日(endDate)のパラメータが必要です（MMDD形式）',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}

			const monthDayRegex = /^\d{4}$/;
			if (!monthDayRegex.test(startMonthDay) || !monthDayRegex.test(endMonthDay)) {
				return new Response(
					JSON.stringify({
						error: '日付はMMDD形式で指定してください (例: 0101)',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}

			// 開始日と終了日の基本的な検証
			const startMonth = Number.parseInt(startMonthDay.slice(0, 2), 10);
			const startDay = Number.parseInt(startMonthDay.slice(2, 4), 10);
			const endMonth = Number.parseInt(endMonthDay.slice(0, 2), 10);
			const endDay = Number.parseInt(endMonthDay.slice(2, 4), 10);

			if (
				startMonth < 1 ||
				startMonth > 12 ||
				startDay < 1 ||
				startDay > 31 ||
				endMonth < 1 ||
				endMonth > 12 ||
				endDay < 1 ||
				endDay > 31
			) {
				return new Response(
					JSON.stringify({
						error: '無効な月日形式です。MMDD形式で指定してください (例: 0101)。',
					}),
					{
						status: 400,
						headers: { 'Content-Type': 'application/json' },
					},
				);
			}

			try {
				// 日付の配列を作成
				const dates: string[] = generateMonthDaysBetween(startMonthDay, endMonthDay);
				console.log(`処理する日付範囲: ${dates.join(', ')} (${dates.length}日間)`);

				const response: DateRangeBatchScrapeResult = {
					dateResults: {},
					totalNewUrls: 0,
					totalExistingUrls: 0,
					totalPagesScrapped: 0,
					datesProcessed: [],
					failedDates: {},
					startMonthDay,
					endMonthDay,
				};

				// 各日付に対して順次処理
				for (const monthDay of dates) {
					console.log(`日付 ${monthDay} の処理を開始`);
					try {
						// 個別の月日に対するスクレイピングロジックを再利用
						const startYear = 2006;
						const endYear = 2025;
						const dateResult: BatchScrapeByMonthDayResult = {
							results: [],
							totalNewUrls: 0,
							totalExistingUrls: 0,
							totalPagesScrapped: 0,
							yearsProcessed: [],
							failedYears: {},
							monthDay,
						};

						// 各年を順番に処理
						for (let year = startYear; year <= endYear; year++) {
							const yearString = String(year);
							const dateString = `${yearString}${monthDay}`; // YYYYMMDD
							console.log(`Scraping for date: ${dateString}`);
							try {
								const result = await scrapeHistoricalAnondUrls(environment, dateString);
								dateResult.results.push(result);
								dateResult.totalNewUrls += result.newUrls.length;
								dateResult.totalExistingUrls += result.existingUrlsCount;
								dateResult.totalPagesScrapped += result.pagesScraped;
								dateResult.yearsProcessed.push(yearString);
								console.log(`Completed scraping for ${dateString}: ${result.newUrls.length} new URLs.`);
							} catch (error: unknown) {
								const reason = error instanceof Error ? error.message : String(error);
								dateResult.failedYears[yearString] = reason;
								console.error(`Failed scraping for ${dateString}: ${reason}`);
							}

							// 各年の処理間に待機時間を追加（例: 500ミリ秒）
							await new Promise((resolve) => setTimeout(resolve, 500));
						}

						// 日付の結果を全体結果に追加
						response.dateResults[monthDay] = dateResult;
						response.totalNewUrls += dateResult.totalNewUrls;
						response.totalExistingUrls += dateResult.totalExistingUrls;
						response.totalPagesScrapped += dateResult.totalPagesScrapped;
						response.datesProcessed.push(monthDay);

						console.log(`日付 ${monthDay} の処理完了: ${dateResult.totalNewUrls}件の新規URL追加`);
					} catch (error: unknown) {
						const errorMessage = error instanceof Error ? error.message : String(error);
						response.failedDates[monthDay] = errorMessage;
						console.error(`日付 ${monthDay} の処理エラー: ${errorMessage}`);
					}

					// 各日付の処理間に待機時間を追加（例: 1000ミリ秒）
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}

				return new Response(JSON.stringify(response), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// スケジュールされたエンドポイントテスト用
		if (url.pathname === '/__scheduled') {
			try {
				const result = await scrapeAnondUrls(environment);
				return new Response(JSON.stringify(result), {
					headers: { 'Content-Type': 'application/json' },
				});
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: errorMessage }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		// ルートURL: 日付に基づいてランダムな過去記事へリダイレクト
		if (url.pathname === '/') {
			try {
				const now = new Date();
				const month = String(now.getMonth() + 1).padStart(2, '0'); // 01-12
				const day = String(now.getDate()).padStart(2, '0'); // 01-31
				const currentYear = now.getFullYear(); // YYYY (as number)
				const currentMonthDay = `${month}${day}`; // Month and Day (e.g., 0410)

				// Determine the start year based on the current date
				const monthNumber = now.getMonth() + 1; // 1-12
				const dayNumber = now.getDate(); // 1-31

				const startYear = monthNumber > 9 || (monthNumber === 9 && dayNumber >= 24) ? 2006 : 2007;

				// Determine the end year (last year)
				const endYear = currentYear - 1;

				// Check if there are any valid past years to select from
				if (startYear > endYear) {
					return new Response('No valid past years found for this date.', { status: 404 });
				}

				// Select a random year between startYear and endYear (inclusive)
				const numberOfYears = endYear - startYear + 1;
				const randomYear = Math.floor(Math.random() * numberOfYears) + startYear;
				const randomYearString = String(randomYear);

				// Fetch a random article from that specific year and month/day
				const stmt = environment.DB.prepare(
					`SELECT url FROM article_urls
					 WHERE substr(url, 27, 4) = ?1 -- Check Year from URL path (position 27)
					   AND substr(url, 31, 4) = ?2 -- Check MonthDay from URL path (position 31)
					 ORDER BY RANDOM()
					 LIMIT 1`,
				).bind(randomYearString, currentMonthDay);

				const result = await stmt.first<{ url: string }>();

				return result && result.url
					? Response.redirect(result.url, 302)
					: new Response('No matching historical article found for this date.', { status: 404 });
			} catch (error: unknown) {
				console.error('Error handling root path redirect:', error);
				const errorMessage = error instanceof Error ? error.message : String(error);
				return new Response(JSON.stringify({ error: `Failed to process redirect: ${errorMessage}` }), {
					status: 500,
					headers: { 'Content-Type': 'application/json' },
				});
			}
		}

		return new Response('MasudaForever: anond.hatelabo.jp URL Archiver');
	},

	// スケジュールされたジョブ
	async scheduled(controller: ScheduledController, environment: Environment): Promise<void> {
		console.log(`スクレイピング実行: ${controller.cron}`);

		try {
			// 通常のスクレイピング
			const result = await scrapeAnondUrls(environment);
			console.log(`スクレイピング完了: ${result.newUrls.length}件の新規URL追加、${result.pagesScraped}ページ処理`);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`スクレイピングエラー: ${errorMessage}`);
		}
	},
} satisfies ExportedHandler<Environment>;

/**
 * anond.hatelabo.jpからURLをスクレイピングする
 */
async function scrapeAnondUrls(environment: Environment): Promise<ScrapeResult> {
	// 開始ページ
	const startUrl = 'https://anond.hatelabo.jp/';
	return await scrapeAnondUrlsRecursive(environment, startUrl);
}

/**
 * 特定日付のanond.hatelabo.jp/YYYYMMDD からURLをスクレイピングする
 */
async function scrapeHistoricalAnondUrls(environment: Environment, date: string): Promise<HistoricalScrapeResult> {
	// 日付フォーマットに対応したURL
	const startUrl = `https://anond.hatelabo.jp/${date}`;
	const baseResult = await scrapeAnondUrlsRecursive(environment, startUrl);

	return {
		...baseResult,
		date,
	};
}

/**
 * 日付の範囲を指定して複数日の過去記事をバッチでスクレイピングする
 */
async function batchScrapeHistoricalAnondUrls(
	environment: Environment,
	startDate: string,
	endDate: string,
	maxDays: number | undefined,
): Promise<string> {
	// 開始日と終了日のDateオブジェクトを作成
	const startDateObject = parseDateFromString(startDate);
	const endDateObject = parseDateFromString(endDate);

	if (!startDateObject || !endDateObject) {
		throw new Error('開始日または終了日のパースに失敗しました');
	}

	if (startDateObject > endDateObject) {
		throw new Error('開始日は終了日より前の日付を指定してください');
	}

	// 日付の配列を作成
	const dates: string[] = [];
	const currentDate = new Date(startDateObject);

	const _maxDays = maxDays ?? endDateObject.getTime() - startDateObject.getTime();

	while (currentDate <= endDateObject && dates.length < _maxDays) {
		dates.push(formatDateToString(currentDate));
		currentDate.setDate(currentDate.getDate() + 1);
	}

	console.log(`バッチスクレイピング: ${dates.length}日分の処理を開始します`);

	const failedDates: Record<string, string> = {};

	// 各日付に対してスクレイピングを実行
	for (const date of dates) {
		try {
			console.log(`日付 ${date} のスクレイピングを開始`);
			const result = await scrapeHistoricalAnondUrls(environment, date);
			console.log(`日付 ${date} のスクレイピング完了: ${result.newUrls.length}件の新規URL`);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`日付 ${date} のスクレイピングエラー: ${errorMessage}`);
			failedDates[date] = errorMessage;
		}

		// APIリクエスト過多を避けるため、各リクエスト間に少し待機
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return 'end';
}

/**
 * YYYYMMDD形式の文字列からDateオブジェクトを作成
 */
function parseDateFromString(dateString: string): Date | undefined {
	// YYYYMMDD形式をYYYY-MM-DDに変換
	if (!/^\d{8}$/.test(dateString)) {
		return undefined;
	}

	const year = Number.parseInt(dateString.slice(0, 4));
	const month = Number.parseInt(dateString.slice(4, 6)) - 1; // JavaScriptの月は0始まり
	const day = Number.parseInt(dateString.slice(6, 8));

	const date = new Date(year, month, day);

	// 日付が有効かチェック
	if (Number.isNaN(date.getTime())) {
		return;
	}

	return date;
}

/**
 * DateオブジェクトをYYYYMMDD形式の文字列に変換
 */
function formatDateToString(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return `${year}${month}${day}`;
}

/**
 * 再帰的にページをスクレイピングする
 */
async function scrapeAnondUrlsRecursive(
	environment: Environment,
	pageUrl: string,
	maxPages: number | undefined = undefined,
): Promise<ScrapeResult> {
	const result: ScrapeResult = {
		newUrls: [],
		existingUrlsCount: 0,
		pagesScraped: 0,
	};

	let currentUrl = pageUrl;
	let pagesProcessed = 0;
	const foundNewUrls = true;

	// 最大ページ数まで、または新しいURLが見つからなくなるまでスクレイピング
	while (currentUrl && (!maxPages || pagesProcessed < maxPages) && foundNewUrls) {
		console.log(`ページをスクレイピング: ${currentUrl}`);

		const response = await fetch(currentUrl);
		if (!response.ok) {
			throw new Error(`スクレイピング失敗: ${response.status} ${response.statusText}`);
		}

		const html = await response.text();
		const $ = cheerio.load(html);

		// 該当ページの記事URLを抽出
		const pageArticles: ArticleURL[] = [];
		$('div.section').each((_, element) => {
			const linkElement = $(element).find('h3 a');
			const url = linkElement.attr('href');
			const title = linkElement.text().trim() || '■';

			if (url) {
				const fullUrl = url.startsWith('http') ? url : `https://anond.hatelabo.jp${url}`;
				pageArticles.push({ url: fullUrl, title });
			}
		});

		console.log(`ページのスクレイピング結果: ${pageArticles.length}件のURL取得`);

		// 既存URLのカウンターと新規URLのフラグ
		let pageExistingUrls = 0;

		// 新しいURLのみをデータベースに保存
		for (const article of pageArticles) {
			try {
				// URLが既に存在するか確認
				const existingUrl = await environment.DB.prepare('SELECT url FROM article_urls WHERE url = ?')
					.bind(article.url)
					.first<{ url: string }>();

				if (existingUrl) {
					pageExistingUrls++;
				} else {
					// 新しいURLを保存
					await environment.DB.prepare('INSERT INTO article_urls (url, title) VALUES (?, ?)').bind(article.url, article.title).run();

					result.newUrls.push(article);
					console.log(`新規URL保存: ${article.url}`);
				}
			} catch (error: unknown) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				console.error(`DB保存エラー: ${errorMessage}`);
			}
		}

		// // このページで既存URLと衝突が多かった場合は処理を停止
		// if (pageExistingUrls > 0 && pageNewUrls === 0) {
		// 	console.log(`既存URLのみを検出したため停止します。`);
		// 	foundNewUrls = false;
		// }

		// 結果を更新
		result.existingUrlsCount += pageExistingUrls;
		result.pagesScraped++;
		pagesProcessed++;

		// 次のページURLを取得
		const nextPageLink = $('.pager-l a')
			.filter((_, element) => $(element).text().includes('次'))
			.attr('href');
		if (nextPageLink && foundNewUrls) {
			currentUrl = nextPageLink.startsWith('http') ? nextPageLink : `https://anond.hatelabo.jp${nextPageLink}`;
			console.log(`次のページに進みます: ${currentUrl}`);
		} else {
			currentUrl = '';
		}
	}

	return result;
}

/**
 * 開始月日から終了月日までの月日の配列を生成する
 * 例: 0101から0105までなら ['0101', '0102', '0103', '0104', '0105']
 */
function generateMonthDaysBetween(startMonthDay: string, endMonthDay: string): string[] {
	// 基準年を設定（うるう年を考慮して2024年を使用）
	const baseYear = 2024;
	const startMonth = Number.parseInt(startMonthDay.slice(0, 2), 10);
	const startDay = Number.parseInt(startMonthDay.slice(2, 4), 10);
	const endMonth = Number.parseInt(endMonthDay.slice(0, 2), 10);
	const endDay = Number.parseInt(endMonthDay.slice(2, 4), 10);

	const startDate = new Date(baseYear, startMonth - 1, startDay);
	const endDate = new Date(baseYear, endMonth - 1, endDay);

	// 開始日が終了日より後の場合は、年を跨ぐものとして扱う
	if (startDate > endDate) {
		endDate.setFullYear(baseYear + 1);
	}

	const dates: string[] = [];
	const currentDate = new Date(startDate);

	while (currentDate <= endDate) {
		const month = String(currentDate.getMonth() + 1).padStart(2, '0');
		const day = String(currentDate.getDate()).padStart(2, '0');
		dates.push(`${month}${day}`);

		currentDate.setDate(currentDate.getDate() + 1);
	}

	return dates;
}
