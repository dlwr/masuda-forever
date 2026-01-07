import { createClient, Client } from '@libsql/client';

export type TursoClient = Client;

export interface TursoConfig {
	url: string;
	authToken: string;
}

/**
 * Tursoデータベースに接続する
 */
export function connectTurso(config: TursoConfig): TursoClient {
	if (!config.url) {
		throw new Error('TURSO_DB_URL is not set');
	}

	if (!config.authToken) {
		throw new Error('TURSO_AUTH_TOKEN is not set');
	}

	return createClient({
		url: config.url,
		authToken: config.authToken,
	});
}

/**
 * 環境変数からTursoに接続する（CLI用）
 */
export function connectTursoFromEnvironment(): TursoClient {
	const url = process.env.TURSO_DB_URL;
	const authToken = process.env.TURSO_AUTH_TOKEN;

	if (!url) {
		throw new Error('環境変数 TURSO_DB_URL が設定されていません');
	}

	if (!authToken) {
		throw new Error('環境変数 TURSO_AUTH_TOKEN が設定されていません');
	}

	return createClient({
		url,
		authToken,
	});
}
