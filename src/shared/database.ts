import sqlite3 from 'sqlite3';

export interface Database {
	prepare(query: string): Promise<{
		bind(...parameters: unknown[]): Promise<void>;
		get<T>(): Promise<T | null | undefined>;
		run(): Promise<{ changes?: number; lastID?: number }>;
	}>;
	close(): Promise<void>;
}

export async function connectDatabase(): Promise<Database> {
	return new Promise((resolve, reject) => {
		const database = new sqlite3.Database('anond.db', (error) => {
			if (error) {
				reject(error);
			} else {
				resolve(database as unknown as Database);
			}
		});
	});
}
