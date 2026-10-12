// History Illustrated: saves the list of files in the Drive "Public Access" folder as downloads.json.
// Run by GitHub Actions every hour. Needs the GOOGLE_KEY and DRIVE_FOLDER secrets.
// If anything fails, it stops without touching the existing downloads.json.

import { writeFileSync } from 'node:fs';

const KEY = process.env.GOOGLE_KEY;
const ROOT = process.env.DRIVE_FOLDER;
const API = process.env.DRIVE_API_BASE || 'https://www.googleapis.com/drive/v3/';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_DEPTH = 4; // folders below this are not opened

if (!KEY || !ROOT) {
  console.error('Missing GOOGLE_KEY or DRIVE_FOLDER secret.');
  process.exit(1);
}

async function list(folderId) {
  const out = [];
  let pageToken;
  do {
    const url = new URL(API + 'files');
    const params = {
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, description, size)',
      orderBy: 'folder,name',
      pageSize: '1000',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      key: KEY,
    };
    if (pageToken) params.pageToken = pageToken;
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Drive failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    const d = await res.json();
    out.push(...(d.files || []));
    pageToken = d.nextPageToken;
  } while (pageToken);
  return out;
}

const folders = []; // top-level folder names, in Drive's name order
const files = [];
let bytes = 0;

async function walk(folderId, path) {
  for (const it of await list(folderId)) {
    if (it.mimeType === FOLDER) {
      if (path.length === 0) folders.push(it.name);
      if (path.length < MAX_DEPTH) await walk(it.id, [...path, it.name]);
      continue;
    }
    const size = Number(it.size || 0);
    bytes += size;
    files.push({
      id: it.id,
      name: it.name,
      type: it.mimeType,
      modified: it.modifiedTime,
      description: it.description || '',
      size,
      path, // folder names from the main folder down; [] means loose in the main folder
    });
  }
}

await walk(ROOT, []);
if (!files.length) throw new Error('Drive returned no files; keeping the old list.');

writeFileSync(
  'downloads.json',
  JSON.stringify({ updated: new Date().toISOString(), count: files.length, folders, files }) + '\n'
);
console.log(`Saved ${files.length} files in ${folders.length} folders. Total size: ${(bytes / 1048576).toFixed(1)} MB.`);
