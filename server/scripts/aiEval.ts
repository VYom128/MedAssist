import { runEval } from '../src/ai/eval.js';

/** `npm run ai:eval -- --confirm [--limit 5]` – see src/ai/eval.ts. Prints metrics only. */
const out = (line: string) => process.stdout.write(`${line}\n`);

runEval(process.argv.slice(2), out)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    out(`AI eval failed: ${err instanceof Error ? err.name : 'error'}`);
    process.exitCode = 1;
  });
