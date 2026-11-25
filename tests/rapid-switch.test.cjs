const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');

function setup(initialURL, translations) {
  const timers = [];
  const requests = [];
  let now = 0;
  let panelOpen = true;
  const location = { href: initialURL || 'https://www.waze.com/live-map/directions?from=ll.1%2C2&to=ll.3%2C4&time=123&rp_vehicleType=PRIVATE#map' };
  const history = {
    state: { key: 'original', idx: 2 }, replaceState(state, _, url) {
      assert.equal(state, history.state);
      location.href = url;
    }
  };
  const from = { latLng: { lat: 1, lng: 2 } };
  const to = { latLng: { lat: 3, lng: 4 } };
  let routing = { from, to, routes: [{ type: 'PRIVATE' }], locked: false };
  const holder = {};
  const effect = {
    inst: holder, create() {
      const request = { type: new URL(location.href).searchParams.get('rp_vehicleType'), options: new URL(location.href).searchParams.getAll('rp_options'), aborted: false, aborts: 0 };
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
    }
  };
  const context = {
    URL, Date: { now: () => now }, location, history,
    console: { warn() { } },
    document: { documentElement: { lang: 'en' }, getElementById: () => translations ? { textContent: JSON.stringify(translations) } : null },
    setTimeout: callback => { timers.push(callback); }
  };
  const prefix = source.slice(0, source.indexOf('  // Waze mounts and replaces'));
  context.bridge = () => panelOpen ? { routing, effect } : null;
  vm.runInNewContext(prefix + `
    routeBridge = bridge;
    mount = () => {};
    globalThis.test = { selectVehicle, selectAvoid, selectedAvoids, routeOptions, t, state: () => ({ failed, requestSequence, active: activeRequest?.id }) };
  })();`, context);
  return {
    api: context.test, requests, location,
    closePanel: () => { panelOpen = false; },
    changeDestination: () => { routing = { ...routing, to: { latLng: { lat: 5, lng: 6 } } }; },
    routes: () => routing.routes,
    async tick(milliseconds = 150) { now += milliseconds; const callbacks = timers.splice(0); callbacks.forEach(callback => callback()); await Promise.resolve(); await Promise.resolve(); }
  };
}

(async () => {
  const avoids = setup('https://www.waze.com/live-map/directions?from=ll.1,2&to=ll.3,4&rp_vehicleType=TAXI&rp_options=ALLOW_UTURNS:f,AVOID_FERRIES:t&rp_options=custom:value,AVOID_TRAILS:t#map');
  const avoidOne = avoids.api.selectAvoid('AVOID_FERRIES', false);
  const avoidTwo = avoids.api.selectAvoid('unpaved', 'avoid_long');
  const avoidThree = avoids.api.selectVehicle('MOTORCYCLE');
  assert.equal(avoids.requests[0].aborts, 1);
  assert.equal(avoids.requests[1].aborts, 1);
  assert.deepEqual(Array.from(avoids.api.routeOptions()).sort(), ['ALLOW_UTURNS:f', 'custom:value', 'AVOID_TRAILS:f', 'AVOID_LONG_TRAILS:t'].sort());
  assert.equal(avoids.api.selectedAvoids().unpaved, 'avoid_long');
  assert.equal(avoids.api.selectedAvoids().AVOID_FERRIES, false);
  assert.equal(avoids.api.selectedAvoids().AVOID_DANGEROUS_TURNS, true);
  avoids.requests[2].complete();
  await avoids.tick();
  await Promise.all([avoidOne, avoidTwo, avoidThree]);
  assert.equal(new URL(avoids.location.href).hash, '#map');
  for (const [name, value] of [['unpaved', 'allow'], ['unpaved', 'avoid_all'], ['AVOID_DANGEROUS_TURNS', false]]) {
    const pending = avoids.api.selectAvoid(name, value);
    avoids.requests.at(-1).complete(); await avoids.tick(); await pending;
    assert.equal(avoids.api.selectedAvoids()[name], value);
  }
  const dirt = setup();
  assert.equal(dirt.api.selectedAvoids().unpaved, 'avoid_all');
  assert.equal(new URL(dirt.location.href).searchParams.has('rp_options'), false);
  for (const [value, expected] of [['allow', 'AVOID_TRAILS:f'], ['avoid_long', 'AVOID_TRAILS:f,AVOID_LONG_TRAILS:t'], ['avoid_all', null]]) {
    const pending = dirt.api.selectAvoid('unpaved', value);
    assert.equal(new URL(dirt.location.href).searchParams.get('rp_options'), expected);
    assert.equal(dirt.api.selectedAvoids().unpaved, value);
    dirt.requests.at(-1).complete(); await dirt.tick(); await pending;
  }
  const compact = setup();
  for (const flag of ['AVOID_TOLL_ROADS', 'AVOID_FERRIES', 'AVOID_PRIMARIES']) {
    const fresh = setup();
    const pending = fresh.api.selectAvoid(flag, true);
    assert.equal(new URL(fresh.location.href).searchParams.get('rp_options'), `${flag}:t`, 'one selected avoid must not add any false/default flags');
    fresh.requests[0].complete(); await fresh.tick(); await pending;
  }
  assert.equal(compact.api.selectedAvoids().AVOID_DANGEROUS_TURNS, true);
  for (const value of [false, true]) {
    const pending = compact.api.selectAvoid('AVOID_DANGEROUS_TURNS', value);
    assert.equal(new URL(compact.location.href).searchParams.get('rp_options'), value ? null : 'AVOID_DANGEROUS_TURNS:f');
    assert.deepEqual(Array.from(compact.requests.at(-1).options), value ? [] : ['AVOID_DANGEROUS_TURNS:f']);
    assert.equal(compact.api.selectedAvoids().AVOID_DANGEROUS_TURNS, value);
    compact.requests.at(-1).complete(); await compact.tick(); await pending;
  }
  for (const value of [true, false]) {
    const pending = compact.api.selectAvoid('AVOID_FERRIES', value);
    assert.equal(new URL(compact.location.href).searchParams.get('rp_options'), value ? 'AVOID_FERRIES:t' : null);
    assert.deepEqual(Array.from(compact.requests.at(-1).options), value ? ['AVOID_FERRIES:t'] : []);
    compact.requests.at(-1).complete(); await compact.tick(); await pending;
  }
  const total = avoids.requests.length;
  await avoids.api.selectAvoid('unknown', true);
  await avoids.api.selectAvoid('unpaved', 'invalid');
  await avoids.api.selectAvoid('AVOID_FERRIES', 'false');
  assert.equal(avoids.requests.length, total);
  const translated = setup(undefined, { locale: 'vi', translations: { livemap: { route: { badges: { toll: 'Bản dịch cộng đồng mới' } } } } });
  assert.equal(translated.api.t('tolls'), 'Bản dịch cộng đồng mới');
  assert.equal(translated.api.t('ferries'), 'Phà');
  const untranslated = setup(undefined, { locale: 'fr', translations: { livemap: { route: { badges: { toll: 'Péage' } } } } });
  assert.equal(untranslated.api.t('tolls'), 'Péage');
  assert.equal(untranslated.api.t('ferries'), 'Ferries');
  const empty = setup(undefined, { locale: 'vi_VN', translations: { livemap: { route: { badges: { toll: '  ' } } } } });
  assert.equal(empty.api.t('tolls'), 'Thu phí');
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
  const retry = errors.api.selectVehicle('TAXI');
  assert.equal(errors.requests.length, 3, 'failed selected mode can be retried');
  errors.requests[2].complete();
  await errors.tick();
  await retry;
  assert.equal(errors.api.state().failed, false);

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
  assert.equal(slow.api.state().active, 1, 'slow request is still tracked and cancellable');
  assert.equal(slow.requests[0].aborted, false);
  slow.requests[0].complete();
  await slow.tick(14000);
  await slowResult;
  assert.equal(slow.routes()[0].type, 'MOTORCYCLE');
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
    assert.equal(navigating.api.state().active, undefined);
  }
  assert.ok(!/button\.disabled|aria-busy|cursor:\s*wait|let busy/.test(source));
  assert.match(source, /@version\s+1\.2\.0\s/);
  console.log('PASS: avoid options, preserved unknown flags, translation priority/fallback, rapid switches, cancellations, stale polls, retries, URL preservation, enabled buttons, slow success, native errors, navigation, version 1.2.0.');
})().catch(error => { console.error(error); process.exitCode = 1; });
