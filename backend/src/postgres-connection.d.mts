export type PostgresConnectionOptions = {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
};

export function postgresConnectionOptions(
  connectionString: string | undefined,
  variableName?: string,
): PostgresConnectionOptions;