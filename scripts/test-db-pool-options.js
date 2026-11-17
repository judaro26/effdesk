import assert from 'node:assert/strict';
import { databasePoolOptions } from '../src/db.js';

{
  const options = databasePoolOptions('postgres://user:pass@db.example.test/app?sslmode=require');
  assert.equal(options.max, 10);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.idleTimeoutMillis, 10000);
  assert.equal(options.connectionString, 'postgres://user:pass@db.example.test/app?sslmode=verify-full');
  assert.deepEqual(options.ssl, { rejectUnauthorized: true });
}

{
  const options = databasePoolOptions('postgres://localhost/app', 5);
  assert.equal(options.max, 5);
  assert.equal(options.connectionTimeoutMillis, 5000);
  assert.equal(options.ssl, false);
}

console.log('Database pool acquisition timeout tests passed.');
