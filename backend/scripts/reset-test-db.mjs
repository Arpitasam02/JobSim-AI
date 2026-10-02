import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const composeFile = 'docker-compose.yml';

function runDocker(args, capture = false) {
  const result = spawnSync('docker', args, {
    cwd: rootDirectory,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`docker ${args[0]} failed${result.error ? `: ${result.error.message}` : '.'}`);
  }
  return result.stdout ?? '';
}

try {
  const config = JSON.parse(runDocker(['compose', '-f', composeFile, 'config', '--format', 'json'], true));
  const volumeName = config.volumes?.['postgres-test-data']?.name;
  if (typeof volumeName !== 'string' || !volumeName) throw new Error('postgres-test-data volume is missing from Compose configuration.');

  runDocker(['compose', '-f', composeFile, 'rm', '--stop', '--force', '--volumes', 'postgres-test']);
  const volume = spawnSync('docker', ['volume', 'inspect', volumeName], { cwd: rootDirectory, stdio: 'ignore' });
  if (volume.status === 0) runDocker(['volume', 'rm', volumeName]);
  runDocker(['compose', '-f', composeFile, 'up', '--detach', 'postgres-test', '--wait']);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Failed to reset the test database volume.');
  process.exitCode = 1;
}