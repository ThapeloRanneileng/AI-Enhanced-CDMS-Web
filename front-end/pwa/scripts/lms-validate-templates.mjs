import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (quoted && ch === '"' && next === '"') {
      cell += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (!quoted && ch === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim() !== '')) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell || row.length > 0) {
    row.push(cell);
    if (row.some((value) => value.trim() !== '')) rows.push(row);
  }
  return rows;
}

function readCsv(relativePath) {
  const rows = parseCsv(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  const headers = rows[0];
  return rows.slice(1).map((values, index) => ({
    rowNumber: index + 2,
    row: Object.fromEntries(headers.map((header, i) => [header, values[i] ?? ''])),
  }));
}

function numberOrBlank(value) {
  return value === '' || Number.isFinite(Number(value));
}

const errors = [];
const warnings = [];
const stationIds = new Set();
for (const { rowNumber, row } of readCsv('data/lms/metadata/stations.csv')) {
  if (!row.id) errors.push(`stations.csv row ${rowNumber}: id is required`);
  if (!row.name) errors.push(`stations.csv row ${rowNumber}: name is required`);
  if (row.id && stationIds.has(row.id)) errors.push(`stations.csv row ${rowNumber}: duplicate station id ${row.id}`);
  stationIds.add(row.id);
  if (row.latitude && (Number(row.latitude) < -90 || Number(row.latitude) > 90 || !numberOrBlank(row.latitude))) errors.push(`stations.csv row ${rowNumber}: invalid latitude`);
  if (row.longitude && (Number(row.longitude) < -180 || Number(row.longitude) > 180 || !numberOrBlank(row.longitude))) errors.push(`stations.csv row ${rowNumber}: invalid longitude`);
  if (!row.latitude || !row.longitude) warnings.push(`stations.csv row ${rowNumber}: missing coordinates; station will not render on OpenStreetMap`);
  if (!numberOrBlank(row.elevation)) errors.push(`stations.csv row ${rowNumber}: elevation must be numeric`);
}

const elementIds = new Set();
for (const { rowNumber, row } of readCsv('data/lms/metadata/elements.csv')) {
  if (!row.elementId) errors.push(`elements.csv row ${rowNumber}: elementId is required`);
  if (!row.abbreviation && !row.name) errors.push(`elements.csv row ${rowNumber}: abbreviation or name is required`);
  if (!row.unit) errors.push(`elements.csv row ${rowNumber}: unit is required`);
  if (row.elementId && elementIds.has(row.elementId)) errors.push(`elements.csv row ${rowNumber}: duplicate element id ${row.elementId}`);
  elementIds.add(row.elementId);
  if (row.lowerLimit && row.upperLimit && Number(row.lowerLimit) >= Number(row.upperLimit)) errors.push(`elements.csv row ${rowNumber}: lowerLimit must be less than upperLimit`);
}

for (const { rowNumber, row } of readCsv('data/lms/metadata/source-specifications.csv')) {
  if (!row.name) errors.push(`source-specifications.csv row ${rowNumber}: name is required`);
  if (row.type !== 'Form') errors.push(`source-specifications.csv row ${rowNumber}: type must be Form for LMS paper form templates`);
  if (row.interval && !Number.isInteger(Number(row.interval))) errors.push(`source-specifications.csv row ${rowNumber}: interval must be an integer`);
  if (row.utcOffset && !Number.isInteger(Number(row.utcOffset))) errors.push(`source-specifications.csv row ${rowNumber}: utcOffset must be an integer`);
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn(warnings.join('\n'));
}

console.log('LMS metadata templates passed validation.');
