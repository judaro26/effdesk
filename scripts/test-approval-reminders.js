import assert from 'node:assert/strict';
import { normalizeReminderSettings, reminderDue } from '../src/approval-reminders.js';

assert.deepEqual(normalizeReminderSettings(undefined,undefined),{reminderHours:24,maxReminders:3});
assert.deepEqual(normalizeReminderSettings(0,99),{reminderHours:1,maxReminders:20});
assert.deepEqual(normalizeReminderSettings(999,-1),{reminderHours:720,maxReminders:0});
const now=Date.parse('2026-11-12T20:00:00Z');
assert.equal(reminderDue({createdAt:new Date(now-24*3600000).toISOString()},now),true);
assert.equal(reminderDue({createdAt:new Date(now-23*3600000).toISOString()},now),false);
assert.equal(reminderDue({createdAt:new Date(now-48*3600000).toISOString(),lastRemindedAt:new Date(now-2*3600000).toISOString()},now),false);
assert.equal(reminderDue({createdAt:new Date(now-48*3600000).toISOString(),reminderCount:3,maxReminders:3},now),false);
assert.equal(reminderDue({createdAt:new Date(now-48*3600000).toISOString(),status:'approved'},now),false);
console.log('Approval reminder tests passed.');
