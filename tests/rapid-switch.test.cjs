const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('waze-live-map-route-toolkit.user.js', 'utf8');

function setup() {
  const timers = [];
  const requests = [];
  let now = 0;
  let panelOpen = true;
  const location = { href: 'https://www.waze.com/live-map/directions?from=ll.1%2C2&to=ll.3%2C4&time=123&rp_vehicleType=PRIVATE#map' };
  const history = { state: { key: 'original', idx: 2 }, replaceState(state, _, url) {
    assert.equal(state, history.state);
    location.href = url;
  } };
  const from = { latLng: { lat: 1, lng: 2 } };
  const to = { latLng: { lat: 3, lng: 4 } };
  let routing = { from, to, routes: [{ type: 'PRIVATE' }], locked: false };
  const holder = {};
  const effect = { inst: holder, create() {
    const request = { type: new URL(location.href).searchParams.get('rp_vehicleType'), aborted: false, aborts: 0 };
    requests.push(request);
    routing = { ...routing, routes: undefined, error: undefined, locked: true };
    request.complete = () => {
      // Mirrors the native AbortSignal path: aborted requests do not dispatch routes.
      if (!request.aborted) routing = { from, to, routes: [{ type: request.type }], locked: false };
    };
    request.fail = () => {
      if (!request.aborted) routing = { from, to, routes: undefined, error: new Error('network'), locked: false };
    };
    return () => { request.aborted = true; request.aborts++; };
  } };
  const context = { URL, Date: { now: () => now }, location, history,
    console: { warn() {} },
    document: { documentElement: { lang: 'en' }, getElementById: () => null },
    setTimeout: callback => { timers.push(callback); } };
  const prefix = source.slice(0, source.indexOf('  // Waze mounts and replaces'));
  context.bridge = () => panelOpen ? { routing, effect } : null;
  vm.runInNewContext(prefix + `
    routeBridge = bridge;
    mount = () => {};
    globalThis.test = { selectVehicle, state: () => ({ failed, message, requestSequence, active: activeRequest?.id }) };
  })();`, context);
  return { api: context.test, requests, location,
    closePanel: () => { panelOpen = false; },
    changeDestination: () => { routing = { ...routing, to: { latLng: { lat: 5, lng: 6 } } }; },
    routes: () => routing.routes,
    async tick(milliseconds = 150) { now += milliseconds; const callbacks = timers.splice(0); callbacks.forEach(callback => callback()); await Promise.resolve(); await Promise.resolve(); }
  };
}

(async () => {
  const app = setup();
  const first = app.api.selectVehicle('MOTORCYCLE');
  const second = app.api.selectVehicle('TAXI');
  const third = app.api.selectVehicle('PRIVATE');
  assert.deepEqual(app.requests.map(r => r.type), ['MOTORCYCLE', 'TAXI', 'PRIVATE']);
  assert.equal(app.requests[0].aborts, 1);
  assert.equal(app.requests[1].aborts, 1);
  assert.equal(app.requests[2].aborted, false);
  const count = app.requests.length;
  await app.api.selectVehicle('PRIVATE');
  assert.equal(app.requests.length, count, 'same selected mode does not make duplicate requests');
  // A canceled request completing after the current one must not replace its route.
  app.requests[2].complete();
  app.requests[0].complete();
  app.requests[1].fail();
  await app.tick();
  await Promise.all([first, second, third]);
  assert.equal(app.routes()[0].type, 'PRIVATE');
  assert.equal(app.api.state().failed, false);
  assert.equal(app.api.state().message, '');
  assert.equal(app.api.state().active, undefined);
  const url = new URL(app.location.href);
  assert.equal(url.searchParams.get('from'), 'll.1,2');
  assert.equal(url.searchParams.get('to'), 'll.3,4');
  assert.equal(url.searchParams.get('time'), '123');
  assert.equal(url.hash, '#map');

  const errors = setup();
  const oldRequest = errors.api.selectVehicle('MOTORCYCLE');
  const newRequest = errors.api.selectVehicle('TAXI');
  errors.requests[1].fail();
  await errors.tick();
  await Promise.all([oldRequest, newRequest]);
  assert.equal(errors.api.state().failed, true);
  assert.match(errors.api.state().message, /retry/);
  const retry = errors.api.selectVehicle('TAXI');
  assert.equal(errors.requests.length, 3, 'failed selected mode can be retried');
  errors.requests[2].complete();
  await errors.tick();
  await retry;
  assert.equal(errors.api.state().failed, false);
  assert.equal(errors.api.state().message, '');

  const waiting = setup();
  const old = waiting.api.selectVehicle('MOTORCYCLE');
  const latest = waiting.api.selectVehicle('TAXI');
  await waiting.tick(); // Old poll finishes while latest still awaits its network response.
  await old;
  assert.equal(waiting.api.state().active, 2, 'old finally does not clear the active request');
  const newest = waiting.api.selectVehicle('PRIVATE');
  assert.equal(waiting.requests[1].aborted, true, 'latest request can still be canceled');
  waiting.requests[2].complete();
  await waiting.tick();
  await Promise.all([latest, newest]);
  assert.equal(waiting.routes()[0].type, 'PRIVATE');

  const slow = setup();
  const slowResult = slow.api.selectVehicle('MOTORCYCLE');
  await slow.tick(31000);
  assert.equal(slow.api.state().failed, false, '30 seconds is not a script failure');
  assert.equal(slow.api.state().message, '');
  assert.equal(slow.api.state().active, 1, 'slow request is still tracked and cancellable');
  assert.equal(slow.requests[0].aborted, false);
  slow.requests[0].complete();
  await slow.tick(14000);
  await slowResult;
  assert.equal(slow.routes()[0].type, 'MOTORCYCLE');
  assert.equal(slow.api.state().message, '', 'late success leaves no stale error');
  assert.equal(slow.api.state().failed, false);
  assert.equal(slow.api.state().active, undefined);

  const slowError = setup();
  const slowFailure = slowError.api.selectVehicle('TAXI');
  await slowError.tick(45000);
  assert.equal(slowError.api.state().failed, false);
  slowError.requests[0].fail();
  await slowError.tick();
  await slowFailure;
  assert.equal(slowError.api.state().failed, true, 'real native errors still surface');

  for (const change of ['closePanel', 'changeDestination']) {
    const navigating = setup();
    const navigation = navigating.api.selectVehicle('MOTORCYCLE');
    navigating[change]();
    await navigating.tick();
    await navigation;
    assert.equal(navigating.api.state().message, '', 'navigation is not a route failure');
    assert.equal(navigating.api.state().active, undefined);
  }
  assert.ok(!/button\.disabled|aria-busy|cursor:\s*wait|let busy/.test(source));
  assert.match(source, /@version\s+1\.0\s/);
  console.log('PASS: rapid switches, cancellations, stale polls, retries, URL preservation, enabled buttons, slow success after 45s, real native errors, panel/endpoint navigation, version 1.0.');
})().catch(error => { console.error(error); process.exitCode = 1; });
