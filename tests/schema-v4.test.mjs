import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {convertBackup} from '../tools/convert-v3-to-v4.mjs';

const source=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v2.json',import.meta.url),'utf8'));
const fixture=JSON.parse(await readFile(new URL('../test-data/account-book-demo-v4.json',import.meta.url),'utf8'));
const rejected=convertBackup(source);
assert.equal(rejected.ok,false);
assert.equal(rejected.report.unmappedBeneficiaries.length,34);

const converted=convertBackup(source,{unassignedBeneficiaryId:'family'});
assert.equal(converted.ok,true);
assert.equal(converted.report.originalRecordCount,45);
assert.equal(converted.report.expenseCount,34);
assert.equal(converted.report.excludedIncomeCount,11);
assert.equal(converted.backup.summary.recordCount,34);
assert.equal(converted.backup.summary.expenseCents,1886980);
assert.equal(converted.backup.records.records.every(record=>!('type' in record)&&!('cat' in record)&&!('sub' in record)),true);
assert.equal(fixture.summary.recordCount,converted.backup.summary.recordCount);
assert.equal(fixture.summary.expenseCents,converted.backup.summary.expenseCents);

console.log('schema v4 converter validation passed');
