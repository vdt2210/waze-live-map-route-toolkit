const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
const panelHTML = `<div class="wm-routing"><div class="wm-routing__title"></div>
  <div id="search-suggestions" class="wz-search-suggestions"></div>
  <div class="wm-routes-item-desktop"><div class="wm-routes-item-desktop__details">
    <div class="wm-routes-item-desktop__footer">10 KM</div>
  </div></div></div>`;
const dom = new JSDOM(`<html lang="en"><head></head><body>
  <script id="i18n-strings" type="application/json">{"locale":"en"}</script>
  <div id="map"></div>${panelHTML}</body></html>`, {
  url: 'https://www.waze.com/live-map', runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;
const warnings = [];
window.console.warn = (...args) => warnings.push(args);
window.customElements.define('wz-checkbox', class extends window.HTMLElement {
  constructor() { super(); this.checked = false; }
});

// Keep frame boundaries deterministic, but use the real MutationObserver.
const frames = [];
window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
const checkpoint = async () => { await Promise.resolve(); await Promise.resolve(); };
async function settle() {
  await checkpoint();
  for (let i = 0; frames.length && i < 8; i++) {
    frames.splice(0).forEach((callback) => callback());
    await checkpoint();
  }
  assert.equal(frames.length, 0, 'UI changes must settle without an observer feedback loop');
}

let routePasses = 0;
const queryAll = document.querySelectorAll.bind(document);
document.querySelectorAll = (selector) => {
  if (selector === '.wm-routes-item-desktop') routePasses++;
  return queryAll(selector);
};
// Count live global listeners, including callback identity and capture mode.
const listeners = [];
for (const [target, type, capture] of [
  [document, 'click', false], [window, 'resize', false], [window, 'scroll', true],
]) {
  const callbacks = new Set();
  listeners.push(callbacks);
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const capturing = (options) => typeof options === 'boolean' ? options : Boolean(options?.capture);
  target.addEventListener = (name, callback, options) => {
    if (name === type && capturing(options) === capture) callbacks.add(callback);
    return add(name, callback, options);
  };
  target.removeEventListener = (name, callback, options) => {
    if (name === type && capturing(options) === capture) callbacks.delete(callback);
    return remove(name, callback, options);
  };
}
const listenerCounts = () => listeners.map((callbacks) => callbacks.size);
const signal = () => window.dispatchEvent(new window.Event('pageshow'));
const menuButton = () => document.querySelector('[data-avoid="unpaved"]');

(async () => {
  if (document.readyState !== 'complete') await new Promise((resolve) => window.addEventListener('load', resolve, { once: true }));
  window.eval(source.replace('  function mountMapControls() {', `  function mountMapControls() {
    if (window.failMapIntegration) throw new Error('map integration unavailable');`));
  await settle();
  assert.deepEqual(listenerCounts(), [1, 1, 1]);
  const row = document.getElementById('waze-vehicle-icons');
  const avoids = document.getElementById('waze-route-avoids');
  const initialPasses = routePasses;

  // All external entry points share a frame, including panel mutations.
  signal(); signal();
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await checkpoint();
  assert.equal(frames.length, 1, 'merge navigation and DOM signals into one frame');
  await settle();
  assert.equal(routePasses, initialPasses + 1);
  assert.equal(document.getElementById('waze-vehicle-icons'), row);
  assert.equal(document.getElementById('waze-route-avoids'), avoids);
  assert.deepEqual(listenerCounts(), [1, 1, 1], 'repeated updates reuse global listeners');

  // Unrelated map changes and owned popup contents do not traverse React routes.
  const beforeMap = routePasses;
  document.getElementById('map').append(document.createElement('span'));
  menuButton().click();
  document.querySelector('.wlmrt-avoid-menu [role="option"]').firstChild.data += ' ';
  await settle();
  assert.equal(routePasses, beforeMap);
  document.body.click();
  await settle();

  // Rapid URL selections update controls without refreshing route badges.
  row.querySelector('[data-vehicle="MOTORCYCLE"]').click();
  row.querySelector('[data-vehicle="TAXI"]').click();
  await checkpoint();
  assert.equal(frames.length, 1);
  await settle();
  assert.equal(row.querySelector('[data-vehicle="TAXI"]').getAttribute('aria-pressed'), 'true');
  assert.equal(routePasses, beforeMap, 'control-only updates must skip route traversal');

  // A DOM change upgrades an already pending control-only update to full.
  row.querySelector('[data-vehicle="PRIVATE"]').click();
  document.querySelector('.wm-routes-item-desktop__footer').firstChild.data = '12 KM';
  await checkpoint();
  assert.equal(frames.length, 1);
  await settle();
  assert.equal(routePasses, beforeMap + 1);

  // Request startup stays light; completion refreshes routes even without a DOM signal.
  const title = document.querySelector('.wm-routing__title');
  const routing = {
    from: { latLng: { lat: 1, lng: 2 } }, to: { latLng: { lat: 3, lng: 4 } },
    routes: [], reverse: false, locked: false,
  };
  const effect = {
    tag: 8, deps: [routing.from.latLng, routing.to.latLng, 'now', false],
    create() { routing.locked = true; return () => {}; },
  };
  effect.next = effect;
  title.__reactFiber$test = { memoizedProps: { value: routing }, updateQueue: { lastEffect: effect } };
  const polls = [];
  const nativeTimeout = window.setTimeout;
  window.setTimeout = (callback) => { polls.push(callback); return polls.length; };
  const beforeRequest = routePasses;
  row.querySelector('[data-vehicle="MOTORCYCLE"]').click();
  await settle();
  assert.equal(routing.locked, true);
  assert.equal(routePasses, beforeRequest);
  routing.locked = false;
  routing.routes = [{}];
  assert.equal(polls.length, 1);
  polls.shift()();
  await settle();
  assert.equal(routePasses, beforeRequest + 1, 'completed request must refresh route data');
  window.setTimeout = nativeTimeout;
  delete title.__reactFiber$test;

  // Text-node translation changes must refresh existing controls, too.
  document.getElementById('i18n-strings').firstChild.data = '{"locale":"vi"}';
  await settle();
  assert.equal(row.getAttribute('aria-label'), 'Chọn phương tiện');
  assert.equal(row.querySelector('[data-vehicle="PRIVATE"]').getAttribute('aria-label'), 'Ô tô');
  assert.equal(avoids.querySelector('summary').textContent, 'Tránh');

  // Detaching only the Avoid panel closes its portal and replaces its listeners.
  avoids.open = true;
  menuButton().click();
  avoids.remove();
  await settle();
  assert.equal(document.querySelector('.wlmrt-avoid-menu'), null);
  assert.notEqual(document.getElementById('waze-route-avoids'), avoids);
  assert.deepEqual(listenerCounts(), [1, 1, 1]);

  // Closing the routing panel releases global resources even before reopening.
  document.querySelector('.wm-routing').remove();
  await settle();
  assert.deepEqual(listenerCounts(), [0, 0, 0]);
  assert.equal(document.getElementById('waze-vehicle-icons'), null);
  assert.equal(document.getElementById('waze-route-avoids'), null);
  document.body.insertAdjacentHTML('beforeend', panelHTML);
  await settle();
  assert.deepEqual(listenerCounts(), [1, 1, 1]);
  assert.equal(document.querySelectorAll('#waze-vehicle-icons').length, 1);
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);
  // A broken map integration must not block translations or routing controls.
  window.failMapIntegration = true;
  document.getElementById('i18n-strings').firstChild.data = '{"locale":"en"}';
  await settle();
  assert.equal(document.getElementById('waze-vehicle-icons').getAttribute('aria-label'), 'Vehicle type');
  assert.equal(document.getElementById('waze-route-avoids').querySelector('summary').textContent, 'Avoid');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /map controls/);
  signal(); await settle();
  assert.equal(warnings.length, 1, 'repeat failures must not flood the Console');
  window.failMapIntegration = false;
  signal(); await settle();
  window.failMapIntegration = true;
  signal(); await settle();
  assert.equal(warnings.length, 2, 'a new failure after recovery is logged again');
  window.failMapIntegration = false;

  // Replacing the entire panel in one commit must also release stale listeners.
  const replacement = document.createElement('div');
  replacement.innerHTML = panelHTML;
  menuButton().click();
  document.querySelector('.wm-routing').replaceWith(replacement.firstElementChild);
  await settle();
  assert.equal(document.querySelector('.wlmrt-avoid-menu'), null);
  assert.deepEqual(listenerCounts(), [1, 1, 1]);
  assert.equal(document.querySelectorAll('#waze-vehicle-icons').length, 1);
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);
  console.log('PASS: coalesced frames, full-update priority, scoped DOM signals, control-only updates, translation text nodes, listener cleanup and panel replacement.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => window.close());
