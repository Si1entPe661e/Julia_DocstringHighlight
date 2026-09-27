// Fixture-driven detector tests: every test/fixtures/<name>.jl is scanned and compared with
// <name>.expected.json. Regenerate with test/tools/update-expected.mjs and review the diff.
import * as assert from 'node:assert/strict';
import { scan } from '../../src/detector';
import { fixtureNames, readExpected, readFixture } from '../fixtureData';

describe('fixtures', () => {
  for (const name of fixtureNames()) {
    it(name, () => {
      const result = scan(readFixture(name));
      const expected = readExpected(name);
      const actual = result.docstrings.map((d) => ({
        start: d.start.line,
        end: d.end.line,
        kind: d.kind,
        quote: d.quote,
        prefix: d.prefix,
        targetLine: d.targetLine,
      }));
      assert.deepEqual(
        actual,
        expected.docstrings.map(({ oracle: _oracle, ...d }) => d),
      );
      assert.deepEqual(
        result.inlineCode.map((s) => [s.line, s.startCol, s.endCol]),
        expected.inlineCode,
      );
    });
  }

  it('has a fixture for every topic', () => {
    const required = ['basic', 'targets', 'atdoc', 'markdown', 'doctest', 'multiline-string', 'edge-cases', 'blocks', 'showcase', 'numbers', 'operators'];
    for (const r of required) assert.ok(fixtureNames().includes(`${r}.jl`), `missing fixture ${r}.jl`);
  });
});
