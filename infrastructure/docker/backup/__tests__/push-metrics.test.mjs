// CI-runnable check for the PG-024 backup-metrics code path — exercises
// push-metrics.sh against a mocked backup-completion event (fake
// duration/size/offsite values, a local mock Pushgateway) without needing
// real Postgres/Redis/MinIO. The full drill itself (infrastructure/runbooks/
// dr-runbook.md) is the acceptance test this does NOT replace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, '..', 'push-metrics.sh');
// On Windows dev boxes, an unqualified 'bash' can resolve to the WSL launcher
// stub at C:\Windows\System32\bash.exe (PATH-order dependent) instead of Git
// Bash. CI (ubuntu-latest) has no such ambiguity. Force Git Bash on win32.
const BASH = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash';

function startMockPushgateway() {
  return new Promise((resolve) => {
    let received = null;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received = { method: req.method, url: req.url, body };
        res.writeHead(200);
        res.end();
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
        getReceived: () => received,
      });
    });
  });
}

// spawnSync would block the whole event loop, which would deadlock against
// the in-process mock server above (it could never get a turn to accept/read
// the request while spawnSync is blocking) — must use async spawn instead.
function runPushMetrics(args, env) {
  return new Promise((resolve) => {
    const child = spawn(BASH, [SCRIPT, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('push-metrics.sh pushes a fresh, correctly-formatted payload to Pushgateway', async () => {
  const mock = await startMockPushgateway();
  try {
    const before = Math.floor(Date.now() / 1000);
    const result = await runPushMetrics(['45', '1400000000', '1'], { ...process.env, PUSHGATEWAY_URL: mock.url });
    const after = Math.floor(Date.now() / 1000);

    assert.equal(result.code, 0, `push-metrics.sh exited non-zero: ${result.stderr}`);

    const received = mock.getReceived();
    assert.ok(received, 'Pushgateway mock received no request');
    assert.equal(received.url, '/metrics/job/erp_backup');

    const tsMatch = received.body.match(/erp_backup_last_success_timestamp (\d+)/);
    assert.ok(tsMatch, 'erp_backup_last_success_timestamp metric missing from payload');
    const emittedTs = Number(tsMatch[1]);
    assert.ok(
      emittedTs >= before && emittedTs <= after,
      `emitted timestamp ${emittedTs} is not fresh (expected between ${before} and ${after})`
    );

    assert.match(received.body, /erp_backup_duration_seconds 45/);
    assert.match(received.body, /erp_backup_size_bytes 1400000000/);
    assert.match(received.body, /erp_backup_offsite_success 1/);
  } finally {
    await mock.close();
  }
});

test('push-metrics.sh is a no-op (exit 0, no request) when PUSHGATEWAY_URL is unset', async () => {
  const mock = await startMockPushgateway();
  try {
    const env = { ...process.env };
    delete env.PUSHGATEWAY_URL;
    const result = await runPushMetrics(['10', '100', '0'], env);

    assert.equal(result.code, 0);
    assert.equal(mock.getReceived(), null, 'should not have pushed anything with no PUSHGATEWAY_URL');
  } finally {
    await mock.close();
  }
});
