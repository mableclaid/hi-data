// History Illustrated: saves the channel's video list as videos.json.
// Run by GitHub Actions every hour. Needs the GOOGLE_KEY secret.
// If anything fails, it stops without touching the existing videos.json.

import { writeFileSync } from 'node:fs';

const KEY = process.env.GOOGLE_KEY;
const CHANNEL = 'UCN5DnnodEB9ozbPp3PrrZKw';
const API = process.env.YT_API_BASE || 'https://www.googleapis.com/youtube/v3/';

if (!KEY) {
  console.error('Missing GOOGLE_KEY secret.');
  process.exit(1);
}

async function yt(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function paged(path, params) {
  const out = [];
  let pageToken;
  do {
    const d = await yt(path, pageToken ? { ...params, pageToken } : params);
    out.push(...(d.items || []));
    pageToken = d.nextPageToken;
  } while (pageToken);
  return out;
}

// "PT1H2M3S" -> seconds
function seconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

const tail = CHANNEL.slice(2);

// 1. Every upload
const uploads = await paged('playlistItems', {
  part: 'snippet,contentDetails',
  playlistId: 'UU' + tail,
  maxResults: '50',
});
const videos = uploads.map((it) => ({
  id: it.contentDetails.videoId,
  title: it.snippet.title,
  published: it.contentDetails.videoPublishedAt || it.snippet.publishedAt,
  seconds: 0,
  views: 0,
  short: false,
  playlists: [],
}));
if (!videos.length) throw new Error('YouTube returned no videos; keeping the old list.');
const byId = new Map(videos.map((v) => [v.id, v]));

// 2. Lengths and views, 50 at a time
for (let i = 0; i < videos.length; i += 50) {
  const ids = videos.slice(i, i + 50).map((v) => v.id).join(',');
  const d = await yt('videos', { part: 'contentDetails,statistics', id: ids, maxResults: '50' });
  for (const it of d.items || []) {
    const v = byId.get(it.id);
    if (!v) continue;
    v.seconds = seconds(it.contentDetails?.duration);
    v.views = Number(it.statistics?.viewCount || 0);
  }
}

// 3. Shorts: YouTube's own Shorts list (undocumented); if it is missing, use 60 seconds or less
try {
  const shorts = await paged('playlistItems', {
    part: 'contentDetails',
    playlistId: 'UUSH' + tail,
    maxResults: '50',
  });
  for (const it of shorts) {
    const v = byId.get(it.contentDetails.videoId);
    if (v) v.short = true;
  }
} catch (err) {
  if (err.status !== 404) throw err;
  for (const v of videos) v.short = v.seconds > 0 && v.seconds <= 60;
}

// 4. Which playlists each video is in
const playlists = await paged('playlists', { part: 'snippet', channelId: CHANNEL, maxResults: '50' });
for (const pl of playlists) {
  const items = await paged('playlistItems', {
    part: 'contentDetails',
    playlistId: pl.id,
    maxResults: '50',
  });
  for (const it of items) {
    const v = byId.get(it.contentDetails.videoId);
    if (v && !v.playlists.includes(pl.snippet.title)) v.playlists.push(pl.snippet.title);
  }
}

videos.sort((a, b) => (a.published < b.published ? 1 : -1));

writeFileSync(
  'videos.json',
  JSON.stringify({ updated: new Date().toISOString(), count: videos.length, videos }) + '\n'
);
console.log(`Saved ${videos.length} videos.`);
