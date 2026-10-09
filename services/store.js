// Tiny key/value store used for the OAuth tokens and the last sync.
//  - On Vercel: Upstash Redis (the filesystem there is read-only and every request may hit a
//    different instance, so nothing can be kept on disk or in memory).
//  - Locally (no Redis env vars): one JSON file per key in the project folder, e.g. tokens.json.
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

let redis = null;
if (REDIS_URL && REDIS_TOKEN) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url: REDIS_URL, token: REDIS_TOKEN });
}

const fileFor = (key) => path.join(__dirname, '..', `${key}.json`);

// Returns the stored value, or null if there is none.
async function get(key) {
  if (redis) return (await redis.get(`aup:${key}`)) ?? null; // @upstash/redis parses JSON for us
  try {
    return JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
  } catch {
    return null; // file missing or unreadable
  }
}

async function set(key, value) {
  if (redis) return redis.set(`aup:${key}`, value);
  fs.writeFileSync(fileFor(key), JSON.stringify(value, null, 2));
}

async function del(key) {
  if (redis) return redis.del(`aup:${key}`);
  if (fs.existsSync(fileFor(key))) fs.unlinkSync(fileFor(key));
}

// Vercel without Redis would silently "forget" everything, so make that visible.
if (!redis && process.env.VERCEL) {
  console.warn('[store] No Redis configured on Vercel – add Upstash Redis from the Vercel Marketplace.');
}

module.exports = { get, set, del, usingRedis: Boolean(redis) };
