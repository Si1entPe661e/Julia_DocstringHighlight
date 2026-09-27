// Shared access to test/fixtures/<name>.jl and <name>.expected.json.
import * as fs from 'node:fs';
import * as path from 'node:path';

/** test/fixtures in the source tree (tests run from out/test/…). */
export const FIXTURES = path.resolve(__dirname, '../../test/fixtures');

export interface ExpectedDocstring {
  start: number;
  end: number;
  kind: 'plain' | 'atdoc';
  quote: 'single' | 'triple';
  prefix: string | null;
  targetLine: number;
  /** Why the Julia parser oracle does not report this docstring. */
  oracle?: 'arrow-form' | 'deviation';
}

export interface Expected {
  docstrings: ExpectedDocstring[];
  /** [line, startCol, endCol] */
  inlineCode: Array<[number, number, number]>;
}

export function fixtureNames(): string[] {
  return fs
    .readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.jl'))
    .sort();
}

export function readFixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

export function readExpected(name: string): Expected {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name.replace(/\.jl$/, '.expected.json')), 'utf8')) as Expected;
}
