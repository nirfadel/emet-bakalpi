// Live data for the deployed site: all three sources fetched server-side (FakeReporter and Globes block browser requests).
// Cached at Vercel's edge for 30 minutes, served stale for up to a day while it refreshes.
import { loadAll } from '../lib/sources.mjs';

export default async function handler(req, res) {
  const data = await loadAll({}, msg => console.log(msg));
  const total = data.n12.length + data.fakereporter.length + data.globes.length;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // A source that failed comes back empty; cache that answer briefly so the next request retries it.
  const complete = data.n12.length && data.fakereporter.length && data.globes.length;
  res.setHeader('Cache-Control', !total ? 'no-store' : complete ? 's-maxage=1800, stale-while-revalidate=86400' : 's-maxage=60');
  res.status(total ? 200 : 502).send(JSON.stringify(data));
}
