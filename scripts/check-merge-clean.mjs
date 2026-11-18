/**
 * Release-safety check: can `rea-uplift` merge into the current main tip cleanly?
 *
 * This is a dry run only. It never touches a working tree, never fetches and
 * never writes a ref: `git merge-tree --write-tree` computes the merge in the
 * object database and prints the resulting tree plus any conflicted paths.
 *
 * Usage:
 *   pnpm test:merge-clean                 # HEAD vs origin/main
 *   node scripts/check-merge-clean.mjs rea-uplift origin/main
 *
 * Exit 0 means no conflicts. Exit 1 prints the conflicted paths so the next
 * sprint can fix them on `rea-uplift` while the change is still small.
 */

import { spawnSync } from 'node:child_process';

const source = process.argv[2] ?? 'HEAD';
const target = process.argv[3] ?? 'origin/main';

const localTarget = target.startsWith('origin/') ? target.slice('origin/'.length) : target;
const hasTarget = spawnSync('git', ['rev-parse', '--verify', '--quiet', target]);
if (hasTarget.status !== 0) {
  console.error(
    `[merge-clean] ${target} is not available locally. Fetch it first:  git fetch origin ${localTarget}`,
  );
  process.exit(2);
}

const result = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', source, target], {
  encoding: 'utf8',
});

if (result.status === 0) {
  console.log(`[merge-clean] ${source} -> ${target}: no conflicts`);
  process.exit(0);
}

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
console.error(`[merge-clean] ${source} -> ${target}: CONFLICTS`);
console.error(output || '(git merge-tree produced no detail)');
process.exit(1);
