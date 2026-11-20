const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app/ui/odontogram.js'), 'utf8');
const start = source.indexOf('function buildDentitionSnapshots(');
const end = source.indexOf('function displayDentition(', start);
const build = vm.runInThisContext(source.slice(start, end) + ';buildDentitionSnapshots');
const tooth = (fdi, ...conditions) => ({fdi, conditions});
const procedure = (date, teeth, statusCode = '6') => ({date, teeth, statusCode});
const treatments = [{statusCode: '2', procedures: [
  procedure('2026-02-03T17:00:00+02:00', [tooth('11', 'O')]),
  procedure('2026-02-01', [tooth('11', 'C'), tooth('51', 'O'), tooth('11.1', 'E')]),
  procedure('2026-02-03T09:00:00+02:00', [tooth('11', 'P'), tooth('12', 'C')]),
  procedure('2026-02-04', [tooth('11')]),
  procedure('2026-02-05', [tooth('11', 'E')], '7'),
  procedure('', [tooth('11', 'E')]),
  procedure('invalid', [tooth('11', 'E')])
]}, {statusCode: '3', procedures: [procedure('2026-03-01', [tooth('11', 'E')])]},
{statusCode: '1', procedures: [procedure('2026-02-02', [tooth('21', 'K')], '')]}];
const original = JSON.stringify(treatments);
const snapshots = build(treatments);
assert.deepEqual([...snapshots.keys()], ['2026-02-01', '2026-02-02', '2026-02-03']);
assert.deepEqual([...snapshots.get('2026-02-01')], [['11', ['C']], ['51', ['O']], ['11.1', ['E']]]);
assert.deepEqual([...snapshots.get('2026-02-03')], [['11', ['O']], ['51', ['O']], ['11.1', ['E']], ['21', ['K']], ['12', ['C']]]);
assert.equal(JSON.stringify(treatments), original);
assert.equal(build([]).size, 0);
assert.equal(build([{procedures: [procedure('2026-01-01', [tooth('11')])]}]).size, 0);
const sameTime = build([{procedures: [procedure('2026-01-01', [tooth('11', 'C')]), procedure('2026-01-01', [tooth('11', 'O')])]}]);
assert.deepEqual(sameTime.get('2026-01-01').get('11'), ['O'], 'Equal timestamps retain response order');
for (const status of ['1', '2', '3', '4', '5', '6', '8', '', 'unknown']) {
  const result = build([{procedures: [procedure('2026-01-01', [tooth('11', 'C')], status)]}]);
  assert.deepEqual(result.get('2026-01-01').get('11'), ['C'], 'Include procedure status ' + status);
}
console.log('D005 snapshot regression tests passed');
