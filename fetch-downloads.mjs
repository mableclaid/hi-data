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
    if (!res.ok) throw new Error(`Drive failed (${res.status}):
