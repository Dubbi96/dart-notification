import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const scriptsDirectory = resolve(process.cwd(), 'scripts');
const checks = readdirSync(scriptsDirectory)
  .filter((file) => file.startsWith('check-') && file.endsWith('.ts'))
  .sort();

const failures: string[] = [];

for (const check of checks) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', resolve(scriptsDirectory, check)],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: process.env,
    },
  );

  if (result.status === 0) {
    console.log(`PASS ${check}`);
    continue;
  }

  failures.push(check);
  console.error(`\nFAIL ${check}`);
  if (result.stdout) console.error(result.stdout.trimEnd());
  if (result.stderr) console.error(result.stderr.trimEnd());
}

console.log(`\n품질 검사: ${checks.length - failures.length}/${checks.length} 통과`);
if (failures.length > 0) {
  console.error(`실패: ${failures.join(', ')}`);
  process.exit(1);
}
