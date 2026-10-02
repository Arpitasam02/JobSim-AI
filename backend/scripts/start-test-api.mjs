import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { postgresDatabaseTarget, testPostgresConnectionOptions } from '../src/postgres-connection.mjs';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)), override: true });

const aiServiceBaseUrl = (process.env.AI_SERVICE_URL?.trim() || 'http://localhost:8000').replace(/\/+$/, '');
let aiServiceHealthUrl;
try {
	aiServiceHealthUrl = new URL(`${aiServiceBaseUrl}/health`);
} catch {
	aiServiceHealthUrl = null;
}

let healthUrlForMessage = '[invalid AI_SERVICE_URL]';
if (aiServiceHealthUrl) {
	const safeUrl = new URL(aiServiceHealthUrl);
	safeUrl.username = '';
	safeUrl.password = '';
	safeUrl.search = '';
	safeUrl.hash = '';
	healthUrlForMessage = safeUrl.href;
}

let aiServiceAvailable = false;
let aiServiceFailure = 'could not be reached within 5 seconds';
if (aiServiceHealthUrl) {
	try {
		const response = await fetch(aiServiceHealthUrl, { signal: AbortSignal.timeout(5_000) });
		aiServiceAvailable = response.ok;
		if (!response.ok) aiServiceFailure = `returned HTTP ${response.status}`;
	} catch {
		aiServiceFailure = 'could not be reached within 5 seconds';
	}
}

if (!aiServiceAvailable) {
	console.error(`[e2e] AI service preflight failed: ${healthUrlForMessage} ${aiServiceFailure}. Start the AI service with either:
	Docker Compose: docker compose up -d ai-service --wait
	Local PowerShell:
		Set-Location 'C:\\Users\\HP\\OneDrive\\Desktop\\JobSim AI\\ai-service'
		py -3.11 -m venv .venv
		.\\.venv\\Scripts\\python.exe -m pip install --upgrade pip
		.\\.venv\\Scripts\\python.exe -m pip install -r .\\requirements.txt
		.\\.venv\\Scripts\\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000`);
	process.exit(1);
}

const connection = testPostgresConnectionOptions(process.env.DATABASE_URL, process.env.DATABASE_URL_TEST);
console.info('Test API database target:', postgresDatabaseTarget(process.env.DATABASE_URL_TEST));
process.env.DATABASE_URL = connection.connectionString;
process.env.NODE_ENV = 'development';
process.env.DB_POOL_MAX ??= '5';
process.env.API_PORT = process.env.E2E_API_PORT ?? '4001';
await import('../dist/server.js');