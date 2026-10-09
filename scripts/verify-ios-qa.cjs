'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const eas = JSON.parse(fs.readFileSync('eas.json', 'utf8'));
const read = p => fs.readFileSync(p, 'utf8');

assert.equal(app.slug, 'chaos-coordinated-ios-qa');
assert.equal(app.scheme, 'chaoscoordinatedqa');
assert.equal(app.ios.bundleIdentifier, 'com.digitaldivide.chaoscoordinated.qa');
assert.ok(!app.extra?.eas?.projectId, 'QA must use a NEW EAS project ID');
assert.ok(!app.owner, 'QA must not automatically reuse production EAS owner');
for (const profile of ['ios-qa-device', 'ios-qa-simulator', 'ios-qa-testflight']) {
  assert.equal(eas.build[profile].environment, 'preview');
  assert.ok(!JSON.stringify(eas.build[profile]).includes('twmjnbktebpaqwlsrgiy'));
}
assert.equal(eas.build['ios-qa-device'].distribution, 'internal');
assert.equal(eas.build['ios-qa-simulator'].ios.simulator, true);
assert.equal(eas.build['ios-qa-testflight'].distribution, 'store');
assert.ok(read('app/(auth)/sign-in.tsx').includes('chaoscoordinatedqa://set-password'));
assert.ok(read('src/lib/authDeepLink.ts').includes('chaoscoordinatedqa://set-password'));
assert.ok(read('src/lib/supabase.ts').includes('forbiddenHosts') || read('src/lib/supabase.ts').includes('twmjnbktebpaqwlsrgiy.supabase.co'));
console.log('iOS QA configuration checks passed. Apple signing and on-device testing still required.');
