export const ALLOWED_ORG = /^stg_effdesk_org_(?:0[1-9]|[12][0-9]|30)$/;

export function parseFairnessOrgIds(value) {
  const ids = [...new Set(String(value || '').split(',').map(x => x.trim()).filter(Boolean))];
  if (ids.length < 2 || ids.length > 30 || ids.some(id => !ALLOWED_ORG.test(id))) {
    throw new Error('STAGING_ORG_IDS must contain 2–30 unique synthetic staging workspace IDs (01–30).');
  }
  return ids;
}

export function buildFairnessTasks(orgIds, rounds = 1, hotShare = 0.7) {
  if (!Array.isArray(orgIds) || orgIds.length < 2 || orgIds.some(id => !ALLOWED_ORG.test(id))) throw new Error('At least two valid synthetic staging workspaces are required.');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('rounds must be an integer from 1 to 10.');
  if (typeof hotShare !== 'number' || hotShare < 0.5 || hotShare > 0.9) throw new Error('hotShare must be between 0.5 and 0.9.');
  const scenarios = ['ticket inbox', 'agent dashboard', 'live chat inbox', '30-day reports'];
  const tasks = [];
  const perRound = orgIds.length * 4;
  const hotCount = Math.ceil(perRound * hotShare);
  for (let round = 0; round < rounds; round++) {
    let controlIndex = 0;
    for (let i = 0; i < perRound; i++) {
      // Interleave the hot tenant with peer tenants so both classes experience
      // the same time window instead of running in separate sequential bursts.
      const hot = i % 10 < 7;
      const orgId = hot ? orgIds[0] : orgIds[1 + (controlIndex++ % (orgIds.length - 1))];
      tasks.push({ orgId, tenantClass: hot ? 'hot' : 'control', scenario: scenarios[(round * perRound + i) % scenarios.length], round: round + 1 });
    }
  }
  return tasks;
}

export function percentileStats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(1)) : null;
  return { samples: sorted.length, p50_ms: at(.5), p95_ms: at(.95), p99_ms: at(.99), max_ms: at(1) };
}

export function summarizeFairness(samples) {
  const result = {};
  for (const tenantClass of ['hot', 'control']) {
    const rows = samples.filter(x => x.tenantClass === tenantClass);
    const scenarios = {};
    for (const name of ['ticket inbox', 'agent dashboard', 'live chat inbox', '30-day reports']) {
      const subset = rows.filter(x => x.scenario === name);
      scenarios[name] = { ...percentileStats(subset.filter(x => x.ok).map(x => x.ms)), failures: subset.filter(x => !x.ok).length };
    }
    result[tenantClass] = {
      organizations: tenantClass === 'hot' ? 1 : new Set(rows.map(x => x.orgId)).size,
      requests: rows.length,
      failures: rows.filter(x => !x.ok).length,
      latency: percentileStats(rows.filter(x => x.ok).map(x => x.ms)),
      scenarios
    };
  }
  return result;
}
