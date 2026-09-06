import assert from 'node:assert/strict';
import { buildCsvNamePatterns, namesStrictMatch } from './historicalMatchKeys';

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`✅ ${label}`);
  } catch (err) {
    console.error(`❌ ${label}`);
    throw err;
  }
}

test('CSV Last I. matches First Last', () => {
  assert.equal(namesStrictMatch('Auger-Aliassime F.', 'Felix Auger-Aliassime'), true);
  assert.equal(namesStrictMatch('Kwon S.', 'Soonwoo Kwon'), true);
  assert.equal(namesStrictMatch('Ma Y.', 'Yexin Ma'), true);
});

test('spaced first name matches compact tracked name', () => {
  assert.equal(namesStrictMatch('Soon Woo Kwon', 'Soonwoo Kwon'), true);
});

test('hyphenated surname prefix in CSV', () => {
  assert.equal(namesStrictMatch('Dedura D.', 'Diego Dedura-Palomero'), true);
});

test('multi-initial CSV format', () => {
  assert.equal(namesStrictMatch('Lee C. Y.', 'Carol Young-suh Lee'), true);
});

test('short surname false positives stay blocked', () => {
  assert.equal(namesStrictMatch('Li A.', 'Ann Li'), true);
  assert.equal(namesStrictMatch('Li A.', 'Na Li'), false);
  assert.equal(namesStrictMatch('Wang X.', 'Xiyu Wang'), true);
  assert.equal(namesStrictMatch('Wang X.', 'Ann Li'), false);
});

test('patterns include dotted CSV forms', () => {
  const patterns = buildCsvNamePatterns('Felix Auger-Aliassime');
  assert.ok(patterns.includes('auger-aliassime f'));
});

test('compound surnames match CSV Last I. format', () => {
  assert.equal(namesStrictMatch('Haddad Maia B.', 'Beatriz Haddad Maia'), true);
  assert.equal(namesStrictMatch('Mpetshi Perricard G.', 'Giovanni Mpetshi Perricard'), true);
  assert.equal(namesStrictMatch('Davidovich Fokina A.', 'Alejandro Davidovich Fokina'), true);
  assert.equal(namesStrictMatch('Jorda Sanchis D.', 'David Jorda Sanchis'), true);
});

test('compound surname patterns for SQL linking', () => {
  const haddad = buildCsvNamePatterns('Beatriz Haddad Maia');
  assert.ok(haddad.includes('haddad maia b'));

  const mpetshi = buildCsvNamePatterns('Giovanni Mpetshi Perricard');
  assert.ok(mpetshi.includes('mpetshi perricard g'));

  const fokina = buildCsvNamePatterns('Alejandro Davidovich Fokina');
  assert.ok(fokina.includes('davidovich fokina a'));
});

test('hyphenated and disambiguation CSV forms', () => {
  assert.equal(namesStrictMatch('Ruse G.', 'Elena-Gabriela Ruse'), true);
  assert.equal(namesStrictMatch('Pliskova Ka.', 'Karolina Pliskova'), true);
  assert.equal(namesStrictMatch('Bautista-Agut R.', 'Roberto Bautista Agut'), true);
  assert.equal(namesStrictMatch('Carreno-Busta P.', 'Pablo Carreno Busta'), true);
  assert.equal(namesStrictMatch('Damm M.', 'Martin Damm Jr'), true);
  assert.equal(namesStrictMatch('Merida Aguilar D.', 'Daniel Merida'), true);
  assert.equal(namesStrictMatch('Schwaerzler J. J.', 'Joel Schwaerzler'), true);
});

test('wang disambiguation patterns', () => {
  assert.ok(buildCsvNamePatterns('Xinyu Wang').includes('wang xin'));
  assert.ok(buildCsvNamePatterns('Xiyu Wang').includes('wang xiy'));
  assert.equal(namesStrictMatch('Wang Xin.', 'Xinyu Wang'), true);
  assert.equal(namesStrictMatch('Wang Xiy.', 'Xiyu Wang'), true);
  assert.equal(namesStrictMatch('Wang Xin.', 'Xiyu Wang'), false);
});

test('extra CSV edge cases', () => {
  assert.equal(namesStrictMatch('Struff J-L.', 'Jan-Lennard Struff'), true);
  assert.equal(namesStrictMatch('Bassols M.', 'Marina Bassols Ribera'), true);
  assert.ok(buildCsvNamePatterns('Jan-Lennard Struff').includes('struff j-l'));
  assert.ok(buildCsvNamePatterns('Marina Bassols Ribera').includes('bassols m'));
});

test('western-order Asian names link to CSV Family I.', () => {
  assert.equal(namesStrictMatch('Ku Y.', 'Yeonwoo Ku'), true);
  assert.equal(namesStrictMatch('Bu Y.', 'Yunchaokete Bu'), true);
  assert.ok(buildCsvNamePatterns('Yeonwoo Ku').includes('ku y'));
  assert.ok(buildCsvNamePatterns('Yunchaokete Bu').includes('bu y'));
});

console.log('\nAll historicalMatchKeys tests passed.\n');
