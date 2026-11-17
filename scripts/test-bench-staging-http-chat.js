import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_STAGING_HOST, validateHttpTarget, parseOrgIds, percentileStats, assertWidgetConfigEnabled } from './bench-staging-http-chat.js';

test('accepts only the explicitly configured HTTPS staging Netlify host', () => {
  assert.equal(validateHttpTarget('https://dummy-site-recovery.netlify.app/'), 'https://dummy-site-recovery.netlify.app');
  for (const value of [
    'http://dummy-site-recovery.netlify.app',
    'https://app.effdesk.com',
    'https://other.netlify.app',
    'https://dummy-site-recovery.netlify.app.evil.example',
    'https://dummy-site-recovery.netlify.app/path',
    'https://user:pass@dummy-site-recovery.netlify.app'
  ]) assert.throws(() => validateHttpTarget(value));
  assert.equal(ALLOWED_STAGING_HOST, 'dummy-site-recovery.netlify.app');
});

test('accepts only synthetic staging organization IDs and de-duplicates them', () => {
  assert.deepEqual(parseOrgIds('stg_effdesk_org_01,stg_effdesk_org_02,stg_effdesk_org_01'), ['stg_effdesk_org_01','stg_effdesk_org_02']);
  assert.throws(() => parseOrgIds('prod_org_01,stg_effdesk_org_02'));
  assert.throws(() => parseOrgIds('stg_effdesk_org_01'));
});

test('computes stable latency percentiles', () => {
  assert.deepEqual(percentileStats([5, 1, 4, 2, 3]), { samples: 5, p50_ms: 3, p95_ms: 5, p99_ms: 5, max_ms: 5 });
  assert.deepEqual(percentileStats([]), { samples: 0, p50_ms: null, p95_ms: null, p99_ms: null, max_ms: null });
});

test('rejects a deployed widget config that reports Live Chat disabled', () => {
  assert.deepEqual(assertWidgetConfigEnabled({ ok: true, enabled: true }, 'effdesk-staging-01'), { ok: true, enabled: true });
  assert.throws(
    () => assertWidgetConfigEnabled({ ok: true, enabled: false }, 'effdesk-staging-01'),
    /DATABASE_URL.*effdesk_staging.*Live Chat entitlement.*enabled chat settings/
  );
});
