import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
let fileContents = '';
let fileFound = false;
try {
  fileContents = await readFile(envPath, 'utf8');
  fileFound = true;
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const fileValues = fileFound ? dotenv.parse(fileContents) : {};
const getValue = (name) => process.env[name]?.trim() || fileValues[name]?.trim() || '';
const required = ['DATABASE_URL', 'DATABASE_URL_TEST', 'JWT_ACCESS_SECRET'];
const missing = required.filter((name) => !getValue(name));
const production = getValue('NODE_ENV') === 'production';
if (production && !getValue('CLAMAV_HOST')) missing.push('CLAMAV_HOST');
const sameDatabase = Boolean(getValue('DATABASE_URL') && getValue('DATABASE_URL') === getValue('DATABASE_URL_TEST'));

console.info(`backend/.env: ${fileFound ? 'found (values hidden)' : 'not found'}`);
console.info(`Missing required variables: ${missing.length ? [...new Set(missing)].join(', ') : 'none'}`);
if (sameDatabase) console.error('DATABASE_URL_TEST must point to a separate database from DATABASE_URL.');
if (missing.length || sameDatabase) process.exitCode = 1;