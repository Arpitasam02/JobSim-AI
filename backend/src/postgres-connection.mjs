export function postgresConnectionOptions(connectionString, variableName = 'DATABASE_URL') {
  if (typeof connectionString !== 'string' || !connectionString.trim()) {
    throw new Error(`${variableName} is required. Set it in backend/.env before connecting.`);
  }

  let sslRequired;
  try {
    sslRequired = new URL(connectionString).searchParams.get('sslmode')?.toLowerCase() === 'require';
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  return {
    connectionString,
    ...(sslRequired ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

function databaseTarget(connectionString) {
  const url = new URL(connectionString);
  return {
    host: url.hostname.toLowerCase().replace(/\.$/, ''),
    port: url.port || '5432',
    database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
  };
}

export function testPostgresConnectionOptions(primaryUrl, testUrl) {
  if (typeof testUrl !== 'string' || !testUrl.trim()) {
    throw new Error('DATABASE_URL_TEST is required. Set it in backend/.env before running integration tests.');
  }
  if (primaryUrl) {
    const primary = databaseTarget(primaryUrl);
    const test = databaseTarget(testUrl);
    if (primary.host === test.host && primary.port === test.port && primary.database === test.database) {
      throw new Error('DATABASE_URL_TEST must point to a separate database from DATABASE_URL.');
    }
  }
  return postgresConnectionOptions(testUrl, 'DATABASE_URL_TEST');
}