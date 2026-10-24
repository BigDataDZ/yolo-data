export function dockerEnvironmentArgs(defaultPassword) {
  // This acceptance test verifies the mounted SQLite volume without external bootstrap databases.
  return [
    '-e', 'AUTH_MODE=session',
    '-e', 'PLATFORM_DB_BACKEND=sqlite',
    '-e', 'PLATFORM_DB_PATH=/app/data/platform.db',
    '-e', 'DORIS_BOOTSTRAP_ENABLED=false',
    '-e', 'DEMO_DATA_ENABLED=false',
    '-e', `DEFAULT_USER_PASSWORD=${defaultPassword}`,
    '-e', 'USER_MEMORY_MAINTENANCE_INTERVAL_MS=0',
  ];
}
