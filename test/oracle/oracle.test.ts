// Cross-validation with the Julia parser. Runs only when a `julia` executable is available
// (override with JULIA=/path/to/julia); run it with `npm run test:oracle`. With ORACLE_REQUIRED=1, as
// in the release checks, a Julia that cannot run fails the suite instead of skipping it.
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { FIXTURES, fixtureNames, readExpected } from '../fixtureData';

const JULIA = process.env.JULIA ?? 'julia';
const ORACLE = path.resolve(__dirname, '../../../test/tools/parser-oracle.jl');

/** Why `julia` cannot run, or undefined if it can. */
function juliaUnavailable(): string | undefined {
  const r = spawnSync(JULIA, ['--startup-file=no', '--version'], { encoding: 'utf8' });
  if (r.status === 0) return undefined;
  return r.error?.message ?? (r.stderr.trim() || `exit status ${String(r.status)}`);
}

describe('Julia parser oracle', function () {
  let oracle: Record<string, number[]> = {};

  before(function () {
    const reason = juliaUnavailable();
    if (reason !== undefined) {
      if (process.env.ORACLE_REQUIRED === '1') {
        // The juliaup launcher can fail in sandboxes (it writes a lock file): point JULIA at the binary.
        throw new Error(`the oracle is required but ${JULIA} cannot run (${reason}); set JULIA=/path/to/julia`);
      }
      this.skip();
    }
    const files = fixtureNames().map((f) => path.join(FIXTURES, f));
    const r = spawnSync(JULIA, ['--startup-file=no', ORACLE, ...files], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    oracle = JSON.parse(r.stdout) as Record<string, number[]>;
  });

  for (const name of fixtureNames()) {
    it(name, () => {
      const expected = readExpected(name).docstrings;
      const parser = oracle[name];
      assert.ok(parser, `no oracle output for ${name}`);
      // Docstrings the parser reports must be exactly the unannotated expected ones …
      const plain = expected.filter((d) => d.oracle === undefined).map((d) => d.start);
      assert.deepEqual(parser, plain);
      // … and every annotated exception must really be one the parser does not report.
      for (const d of expected.filter((e) => e.oracle !== undefined)) {
        assert.ok(!parser.includes(d.start), `line ${d.start} is annotated '${d.oracle}' but the parser reports it`);
      }
    });
  }
});
