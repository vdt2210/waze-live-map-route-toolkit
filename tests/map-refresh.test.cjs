const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const installMapData = require('./native-map-data-runtime.cjs');
const installTooltip = require('./native-tooltip-runtime.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
function events() {
  const listeners = new Set();
  return {
    register(name, scope, callback) { listeners.add({ name, scope, callback }); },
    unregister(name, scope, callback) { for (const entry of listeners) if (entry.name === name && entry.scope === scope && entry.callback === callback) listeners.delete(entry); },
    emit(name) { for (const entry of [...listeners]) if (entry.name === name) entry.callback.call(entry.scope, {}); },
  };
}
async function setup(withRoute = true) {
  const dom = new JSDOM(`<html lang="en"><head></head><body><div id="map">
    <div class="wz-map-control-container"><div><button class="wz-control-button" data-event-action="geolocation_request"><i class="w-icon-recenter"></i></button></div></div>
    <div class="wz-map-ol-zoom-control"><a class="wz-map-ol-zoom-in"></a><a class="wz-map-ol-zoom-out"></a></div>
    </div><div class="wm-cards ${withRoute ? 'is-destination with-routing' : ''}"><div class="wm-routing"><div class="wm-routing__title"></div><div id="search-suggestions"></div>
    <div class="wm-routes__header wm-routing__reducer"><h2 class="wm-routes__title">Routes</h2></div></div></div></body></html>`, {
    url: 'https://www.waze.com/live-map' + (withRoute ? '?from=ll.1,2&to=ll.3,4&rp_vehicleType=TAXI&rp_options=AVOID_FERRIES:t&time=1234' : ''),
    runScripts: 'outside-only',
  });
  const { window } = dom, { document } = window;
  const warnings = [];
  window.console.warn = (...args) => warnings.push(args);
  const data = installMapData(window, { autoComplete: false });
  installTooltip(window, { http: data.http });
  const frames = [], timers = new Map();
  let timerId = 0;
  window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
  window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = (id) => timers.delete(id);
  const settle = async () => {
    for (let count = 0; count < 8; count++) {
      await new Promise((resolve) => setTimeout(resolve, 8));
      frames.splice(0).forEach((callback) => callback());
    }
  };
  const tickRoute = async () => {
    for (const [id, timer] of [...timers]) if (timer.delay === 150) { timers.delete(id); timer.callback(); }
    await settle();
  };
  const resolutions = Array.from({ length: 18 }, (_, zoom) => 156543.03390625 / 2 ** zoom);
  let tileRequests = 0;
  const layer = { resolutions, numZoomLevels: 18, minResolution: resolutions[17], events: events(), redraw(force) { assert.equal(force, true); tileRequests++; return true; } };
  const fits = [];
  const ol = { baseLayer: layer, events: events(), div: document.getElementById('map'), getMinZoom: () => 3 };
  const map = { maxZoomLevel: 17, minZoomLevel: 3, getZoom: () => 17, getOLMap: () => ol,
    getLayerByName: (name) => name === 'LIVEMAP_TILES' ? layer : null,
    zoomToExtent(bounds) { fits.push(bounds); },
  };
  const fit = map.zoomToExtent;
  const routeA = () => ({ name: 'A', latLngs: [{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }] });
  const routeB = () => ({ name: 'B', latLngs: [{ lat: 1, lng: 2 }, { lat: 2, lng: 5 }, { lat: 3, lng: 4 }] });
  let routing = { from: { latLng: { lat: 1, lng: 2 } }, to: { latLng: { lat: 3, lng: 4 } },
    routes: [routeA(), routeB()], at: '1234', reverse: false, locked: false };
  routing.highlightedRoute = routing.routes[1];
  const store = { state: { routing }, dispatch(action) { assert.equal(action.type, 'HIGHLIGHT'); routing.highlightedRoute = action.payload; } };
  const root = { memoizedProps: { value: map }, dependencies: { firstContext: { memoizedValue: store } } };
  data.attach(map, root);
  const recenter = document.querySelector('.wz-control-button');
  recenter.__reactFiber$test.return.return = root;
  const routes = [];
  function attachRoute() {
    const snapshot = routing;
    const effect = { tag: 8, deps: [snapshot.from.latLng, snapshot.to.latLng, snapshot.at, snapshot.reverse],
      create() {
        snapshot.locked = true;
        const request = {
          complete() {
            snapshot.routes = [routeA(), routeB()]; snapshot.highlightedRoute = snapshot.routes[0]; snapshot.locked = false;
            map.zoomToExtent([2, 1, 5, 3]);
          },
          fail() { snapshot.error = new Error('routing failed'); snapshot.locked = false; },
          cancel() { request.cancelled = true; },
        };
        routes.push(request);
        return request.cancel;
      },
    };
    effect.next = effect;
    document.querySelector('.wm-routing__title').__reactFiber$test = { memoizedProps: { value: routing }, updateQueue: { lastEffect: effect } };
  }
  if (withRoute) attachRoute();
  window.eval(source.replace('  // Waze mounts and replaces', '  window.refreshTest = { state: () => mapControl };\n  // Waze mounts and replaces'));
  await settle();
  return { window, document, data, layer, map, fit, fits, routes, timers, warnings, root, settle, tickRoute,
    state: () => window.refreshTest.state(), button: () => document.getElementById('waze-map-refresh'),
    routing: () => routing, tileRequests: () => tileRequests,
    changeDestination() { routing = { ...routing, to: { latLng: { lat: 5, lng: 6 } } }; store.state.routing = routing; attachRoute(); },
    close: () => window.close(),
  };
}

(async () => {
  let t = await setup();
  try {
    assert.equal(t.button().getAttribute('aria-label'), 'Refresh map');
    assert.equal(t.document.getElementById('waze-route-refresh').getAttribute('aria-label'), 'Refresh route');
    const url = t.window.location.href;
    t.button().click(); t.button().click();
    await t.settle();
    assert.equal(t.routes.length, 1, 'route starts while GeoRSS and tiles are still pending');
    assert.equal(t.data.requests.length, 1);
    assert.equal(t.tileRequests(), 1);
    assert.ok(t.data.requests[0].config.params._wlmrt, 'manual data refresh uses a fresh cache key');
    const zoomValue = t.document.getElementById('waze-map-zoom-value');
    t.document.querySelector('button[data-event-action="geolocation_request"]').innerHTML = '<span class="wz-spinner"></span>';
    await t.settle();
    assert.equal(t.document.getElementById('waze-map-zoom-value'), zoomValue);
    assert.equal(t.data.requests[0].config.signal.aborted, false, 'geolocation pending must not cancel a running refresh');
    assert.equal(t.button().getAttribute('aria-busy'), 'true');
    assert.equal(t.data.http.interceptors.request.handlers.size, 0, 'only the manual request captures the interceptor');
    t.map.zoomToExtent([10, 10, 20, 20]);
    assert.equal(t.fits.length, 1, 'unrelated viewport fits remain available');
    t.routes[0].complete();
    assert.equal(t.fits.length, 1, 'native route fitting does not move the current viewport');
    await t.tickRoute();
    assert.equal(t.routing().highlightedRoute.name, 'B', 'preserve the selected alternative by geometry');
    assert.equal(t.map.zoomToExtent, t.fit);
    t.layer.loading = true;
    t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.state().parts.tiles, 'pending', 'old-grid loadend must not finish the new loading grid');
    t.layer.loading = false;
    t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.button().getAttribute('aria-busy'), 'true', 'tiles/route finishing must not finish pending GeoRSS');
    t.data.requests[0].complete();
    await t.settle();
    assert.equal(t.button().getAttribute('aria-busy'), 'false');
    assert.deepEqual(Object.values(t.state().parts), ['ok', 'ok', 'ok']);
    assert.equal(t.data.closed(), 1, 'close snapshot popup only after a successful data refresh');
    assert.equal(t.window.location.href, url, 'keep all routing preferences and departure time');
    assert.equal(t.data.http.interceptors.response.handlers.size, 0);

    t.button().click(); await t.settle();
    assert.notEqual(t.data.requests[1].config.params._wlmrt, t.data.requests[0].config.params._wlmrt);
    t.data.requests[1].fail(); t.layer.events.emit('loadend'); t.routes[1].complete();
    await t.tickRoute();
    assert.equal(t.button().getAttribute('aria-busy'), 'false');
    assert.equal(t.state().parts.data, 'error', 'detect native GeoRSS failures even though Waze catches them');
    assert.equal(t.state().parts.route, 'ok');
    assert.equal(t.button().getAttribute('aria-label'), 'Refresh map');
    assert.match(t.document.getElementById('waze-map-refresh-status').textContent, /traffic data/);
    t.button().dispatchEvent(new t.window.MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
    await t.settle();
    assert.equal(t.document.querySelector('.waze-tooltip').textContent, 'Refresh map', 'failure details never replace the action tooltip');
    t.button().dispatchEvent(new t.window.MouseEvent('mouseout', { bubbles: true, relatedTarget: t.document.body }));
    await t.settle();

    t.button().click(); await t.settle();
    t.data.requests[2].complete(); t.layer.events.emit('loadend'); t.routes[2].fail();
    await t.tickRoute();
    assert.equal(t.state().parts.route, 'error');
    assert.equal(t.state().parts.data, 'ok');
    assert.match(t.document.getElementById('waze-map-refresh-status').textContent, /route/);
    assert.equal(t.map.zoomToExtent, t.fit);

    const count = t.tileRequests();
    t.routing().locked = true;
    t.button().click();
    await t.settle();
    assert.equal(t.tileRequests(), count, 'native route loading also prevents a combined duplicate');
    t.routing().locked = false;
  } finally { t.close(); }

  t = await setup();
  try {
    t.button().click(); await t.settle();
    t.changeDestination();
    t.data.requests[0].complete(); t.layer.events.emit('loadend');
    await t.tickRoute();
    assert.equal(t.state().parts.route, 'cancelled');
    assert.equal(t.routing().to.latLng.lat, 5, 'new destination survives the old refresh');
    assert.equal(t.map.zoomToExtent, t.fit);
    assert.equal(t.button().getAttribute('aria-label'), 'Refresh map');
    assert.match(t.document.getElementById('waze-map-refresh-status').textContent, /interrupted/);
  } finally { t.close(); }

  t = await setup(false);
  try {
    assert.equal(t.button().getAttribute('aria-label'), 'Refresh map');
    t.button().click(); await t.settle();
    assert.equal(t.routes.length, 0);
    assert.equal(t.data.refresh.flush, undefined, 'match real Waze Underscore debounce, which has no flush');
    t.data.refresh();
    await t.settle();
    const background = t.data.pending();
    assert.equal(t.data.requests[1].config.params._wlmrt, undefined, 'background Waze requests keep their original query');
    t.data.requests[0].complete(); t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.state().parts.data, 'cancelled', 'a newer map load invalidates the older manual result');
    t.data.requests[1].complete(); await background;
    assert.equal(t.data.rendered(), 1, 'only Waze latest viewport data renders');
    assert.equal(t.data.closed(), 0, 'do not close a popup for a superseded result');
    t.button().click(); await t.settle();
    t.data.requests.at(-1).complete();
    t.layer.events.emit('tileerror'); t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.state().parts.tiles, 'error', 'a tile HTTP/image failure must not be reported as success');
    assert.equal(t.state().parts.data, 'ok');
    t.button().click(); await t.settle();
    const last = t.data.requests.at(-1);
    t.document.getElementById('map').remove();
    await t.settle();
    assert.equal(last.config.signal.aborted, true);
    assert.equal(t.data.http.interceptors.response.handlers.size, 0);
    assert.equal(t.timers.size, 0);
  } finally { t.close(); }
  t = await setup(false);
  try {
    const geoFiber = t.root.child;
    t.root.child = null;
    t.button().click(); t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.state().parts.data, 'error', 'missing native GeoRSS bridge must not report a complete map refresh');
    assert.equal(t.state().parts.tiles, 'ok');
    t.root.child = geoFiber;
    t.data.setScheduleError(new Error('native callback failed'));
    t.button().click(); t.layer.events.emit('loadend');
    await t.settle();
    assert.equal(t.state().parts.data, 'error');
    assert.equal(t.data.http.interceptors.request.handlers.size, 0);
    assert.equal(t.data.http.interceptors.response.handlers.size, 0, 'synchronous native failure also releases response tracking');
    assert.equal(t.button().getAttribute('aria-busy'), 'false');
    t.data.setScheduleError(null);
    t.button().click(); await t.settle();
    const timedOut = t.data.requests.at(-1);
    t.layer.events.emit('loadend');
    for (const timer of [...t.timers.values()]) if (timer.delay === 20000) timer.callback();
    await t.settle();
    assert.equal(t.state().parts.data, 'error');
    assert.equal(timedOut.config.signal.aborted, true, 'the data deadline also aborts the outstanding request');
    assert.equal(t.button().getAttribute('aria-busy'), 'false');
    assert.equal(t.button().getAttribute('aria-label'), 'Refresh map');
    assert.equal(t.data.http.interceptors.response.handlers.size, 0);
  } finally { t.close(); }
  console.log('PASS: parallel tiles/GeoRSS/routes, native cache-key scope, partial failures, completion gating, viewport/selection preservation, duplicate guards, navigation races and cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
