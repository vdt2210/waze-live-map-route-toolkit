const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const installNativeTooltip = require('./native-tooltip-runtime.cjs');
const source = fs.readFileSync(path.join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
const controls = `<div class="wz-desktop-controls" style="bottom:130px"><div class="wz-custom-controls-wrapper"><div class="wz-map-control-container">
  <div class="wz-map-control-container"><div><button class="wz-control-button is-available" data-event-action="geolocation_request"><i class="w-icon-recenter"></i></button></div></div>
  </div></div></div><div class="wz-map-ol-zoom-control"><a href="#zoomIn" class="wz-map-ol-zoom-in"></a><a href="#zoomOut" class="wz-map-ol-zoom-out"></a></div>`;
const dom = new JSDOM(`<html lang="en"><head></head><body><script id="i18n-strings" type="application/json">{"locale":"en"}</script><div id="map">${controls}</div></body></html>`, {
  url: 'https://www.waze.com/live-map', runScripts: 'outside-only',
});
const { window } = dom;
const { document } = window;
const warnings = [];
window.console.warn = (...args) => warnings.push(args);
const mapData = require('./native-map-data-runtime.cjs')(window);
const nativeTooltip = installNativeTooltip(window, { http: mapData.http });
let zoomHeight = 14.4;
const rect = window.HTMLElement.prototype.getBoundingClientRect;
window.HTMLElement.prototype.getBoundingClientRect = function () {
  if (this.id === 'waze-map-zoom-value') return { ...rect.call(this), height: zoomHeight };
  return rect.call(this);
};
const resizeObservers = [];
window.ResizeObserver = class {
  constructor(callback) { this.callback = callback; resizeObservers.push(this); }
  observe(element) { this.element = element; }
  disconnect() { this.element = null; }
};
const frames = [];
window.requestAnimationFrame = (callback) => { frames.push(callback); return frames.length; };
const timers = new Map();
let timerId = 0;
window.setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
window.clearTimeout = (id) => timers.delete(id);
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 15));
  for (let count = 0; frames.length && count < 10; count++) {
    frames.splice(0).forEach((callback) => callback());
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  // React schedules independent roots separately (zoom value and refresh).
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(frames.length, 0, 'map controls must not create an observer loop');
}
function events() {
  const listeners = [];
  return {
    listeners,
    register(name, scope, handler) { listeners.push({ name, scope, handler }); },
    unregister(name, scope, handler) {
      const index = listeners.findIndex((entry) => entry.name === name && entry.scope === scope && entry.handler === handler);
      assert.notEqual(index, -1, 'unregister the same callback and scope');
      listeners.splice(index, 1);
    },
    emit(name, event = {}) { listeners.slice().filter((entry) => entry.name === name).forEach((entry) => entry.handler.call(entry.scope, event)); },
  };
}
let zoom = 17;
const resolutions = Array.from({ length: 18 }, (_, z) => 156543.03390625 / 2 ** z);
const layer = {
  resolutions, numZoomLevels: 18, minResolution: resolutions[17], events: events(),
  redraw(force) { redraws.push(force); return true; },
};
const redraws = [];
const ol = {
  baseLayer: layer, div: document.getElementById('map'), events: events(),
  getMinZoom: () => 3,
  setCenter(center, value) { zoom = value; this.events.emit('zoomend'); },
};
const map = {
  minZoomLevel: 3, maxZoomLevel: 17,
  getZoom: () => zoom, getOLMap: () => ol,
  getLayerByName: (name) => name === 'LIVEMAP_TILES' ? layer : null,
};
let recenter = document.querySelector('button.wz-control-button');
const tooltipFiber = recenter.__reactFiber$test.return;
const provider = { memoizedProps: { value: map } };
mapData.attach(map, provider);
tooltipFiber.return = provider;
const refresh = () => document.getElementById('waze-map-refresh');
const value = () => document.getElementById('waze-map-zoom-value');
const signal = () => window.dispatchEvent(new window.Event('pageshow'));

(async () => {
  window.eval(source);
  await settle();
  assert.equal(document.querySelector('.wm-routing__title'), null, 'map controls work without a route panel');
  assert.equal(value().textContent, '17');
  assert.equal(value().previousElementSibling.className, 'wz-map-ol-zoom-in');
  assert.equal(value().nextElementSibling.className, 'wz-map-ol-zoom-out');
  assert.equal(map.maxZoomLevel, 19);
  assert.equal(layer.numZoomLevels, 20);
  assert.equal(layer.minResolution, resolutions[17] / 4);
  assert.equal(layer.resolutions[18], resolutions[17] / 2);
  const wrapper = document.querySelector('.wz-custom-controls-wrapper');
  const refreshHost = document.getElementById('waze-map-refresh-host');
  assert.equal(refreshHost.className, 'wz-map-control-container');
  assert.equal(refreshHost.parentElement, wrapper, 'refresh has its own top-level native control container');
  assert.ok(refreshHost.nextElementSibling.contains(recenter), 'refresh is before the outer location container');
  assert.equal(recenter.closest('.wz-map-control-container').previousElementSibling, null, 'do not insert refresh inside the location container');
  assert.equal(document.querySelectorAll('#waze-map-refresh-host').length, 1);
  assert.doesNotMatch(document.getElementById('waze-vehicle-icons-style').textContent, /#waze-map-refresh-host\s*\{/);
  assert.equal(refresh().className, 'wz-control-button');
  assert.equal(refresh().hasAttribute('title'), false);
  assert.ok(nativeTooltip.renders.some((entry) => entry.text === 'Refresh map' && entry.placement === 'left'));
  assert.ok(nativeTooltip.renders.some((entry) => entry.text === 'Zoom level: 17/19' && entry.placement === 'left'));
  assert.ok(nativeTooltip.renders.every((entry) => entry.delayMs === undefined), 'map tooltips must inherit the Waze default delay');
  const desktop = document.querySelector('.wz-desktop-controls');
  assert.equal(desktop.style.getPropertyValue('--wlmrt-controls-bottom'), '130px');
  assert.equal(desktop.style.getPropertyValue('--wlmrt-zoom-extra-height'), '15px');
  assert.equal(window.getComputedStyle(value()).padding, '0px');
  assert.equal(desktop.hasAttribute('data-wlmrt-map-controls'), true);
  zoomHeight = 31.5;
  resizeObservers[0].callback();
  assert.equal(desktop.style.getPropertyValue('--wlmrt-zoom-extra-height'), '32px', 'raise desktop controls by the actual extra zoom height');
  assert.equal(ol.events.listeners.length, 1);
  assert.equal(layer.events.listeners.length, 2);

  // Waze swaps the geolocation glyph for a spinner while locating, then an
  // off glyph on failure or the normal glyph on success. Zoom is independent.
  zoom = 19;
  ol.events.emit('zoomend');
  await settle();
  const originalValue = value();
  const originalRefresh = refresh();
  const originalResolutions = layer.resolutions;
  const originalZoomListener = ol.events.listeners[0];
  for (const [state, glyph] of [
    ['pending', '<span class="wz-spinner"></span>'],
    ['error', '<i class="w-icon-recenter-off w-icon"></i>'],
    ['unavailable', '<i class="w-icon-recenter-off w-icon"></i>'],
    ['updated', '<i class="w-icon-recenter w-icon"></i>'],
  ]) {
    recenter.className = `wz-control-button is-${state}`;
    recenter.innerHTML = glyph;
    await settle();
    assert.equal(value(), originalValue, `keep zoom mounted during geolocation ${state}`);
    assert.equal(refresh(), originalRefresh);
    assert.equal(value().textContent, '19');
    assert.equal(zoom, 19);
    assert.equal(map.maxZoomLevel, 19);
    assert.equal(layer.resolutions, originalResolutions);
    assert.equal(ol.events.listeners[0], originalZoomListener);
  }
  const replacementLocation = recenter.cloneNode(true);
  replacementLocation.__reactFiber$test = recenter.__reactFiber$test;
  recenter.replaceWith(replacementLocation);
  recenter = replacementLocation;
  await settle();
  assert.equal(value(), originalValue, 'replacing only the geolocation button must reuse zoom controls');
  assert.equal(refresh(), originalRefresh);
  assert.equal(ol.events.listeners[0], originalZoomListener);

  // Native clicks, wheel and pinch all result in the same OpenLayers zoomend event.
  for (const level of [18, 19, 18, 3]) {
    zoom = level;
    ol.events.emit('zoomend');
    await settle();
    assert.equal(value().textContent, String(level));
    assert.equal(document.querySelector('.wz-map-ol-zoom-in').getAttribute('aria-disabled'), String(level === 19));
    assert.equal(document.querySelector('.wz-map-ol-zoom-out').getAttribute('aria-disabled'), String(level === 3));
  }
  const before = { zoom, url: window.location.href };
  refresh().click(); refresh().click();
  await settle();
  assert.deepEqual(redraws, [true], 'refresh forces new tile URLs and ignores repeated clicks while loading');
  assert.equal(refresh().getAttribute('aria-busy'), 'true');
  assert.ok(refresh().querySelector('span.wz-spinner'));
  assert.equal(refresh().querySelector('.w-icon-refresh'), null);
  assert.equal(refresh().getAttribute('aria-disabled'), 'true');
  refresh().click();
  assert.deepEqual(redraws, [true], 'spinner state keeps repeated clicks blocked');
  assert.equal(zoom, before.zoom);
  assert.equal(window.location.href, before.url);
  layer.events.emit('loadend');
  await settle();
  assert.equal(refresh().getAttribute('aria-busy'), 'false');
  assert.equal(refresh().querySelector('.wz-spinner'), null);
  assert.ok(refresh().querySelector('i.w-icon-refresh'));
  assert.equal(timers.size, 0);

  // Keyboard-focus tooltip uses Waze's own portal and can be dismissed with Escape.
  refresh().focus();
  await settle();
  assert.equal(document.querySelector('.waze-tooltip').textContent, 'Refresh map');
  refresh().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle();
  assert.equal(document.querySelector('.waze-tooltip'), null);
  value().firstElementChild.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
  await settle();
  assert.equal(document.querySelector('.waze-tooltip').textContent, 'Zoom level: 3/19');
  value().firstElementChild.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  await settle();
  assert.equal(document.querySelector('.waze-tooltip'), null);

  refresh().click();
  [...timers.values()].filter((timer) => timer.delay === 15000).forEach((timer) => timer.callback());
  await settle();
  assert.equal(refresh().getAttribute('aria-busy'), 'false');
  assert.equal(refresh().getAttribute('aria-label'), 'Refresh map');
  assert.match(document.getElementById('waze-map-refresh-status').textContent, /map tiles/);
  refresh().click();
  layer.events.emit('loadend');
  await settle();
  assert.equal(refresh().getAttribute('aria-label'), 'Refresh map');

  const originalRedraw = layer.redraw;
  layer.redraw = () => false;
  refresh().click();
  await settle();
  assert.equal(refresh().getAttribute('aria-label'), 'Refresh map');
  assert.equal(timers.size, 0, 'a redraw that cannot start must not leave a pending timeout');
  layer.redraw = originalRedraw;

  document.getElementById('i18n-strings').firstChild.data = '{"locale":"vi"}';
  await settle();
  assert.equal(value().getAttribute('aria-label'), 'Mức thu phóng: 3/19');
  assert.equal(refresh().getAttribute('aria-label'), 'Làm mới bản đồ');
  assert.match(document.getElementById('waze-map-refresh-status').textContent, /tile bản đồ/);
  const firstButton = refresh();
  signal(); signal();
  await settle();
  assert.equal(refresh(), firstButton);
  assert.equal(ol.events.listeners.length, 1, 'repeated mounts reuse map listeners');

  // Prefer the committed fiber tree to an obsolete map context.
  const staleMap = { ...map, getZoom: () => 99 };
  const root = { stateNode: {} };
  const committed = { stateNode: recenter, return: { dependencies: { firstContext: { memoizedValue: map } } } };
  root.stateNode.current = { child: committed };
  committed.sibling = mapData.fiber;
  recenter.__reactFiber$test = { return: { memoizedProps: { value: staleMap }, return: root } };
  signal();
  await settle();
  assert.equal(value().textContent, '3');
  assert.equal(refresh(), firstButton);

  // A missing bridge releases listeners, portals, timers and our zoom configuration.
  refresh().click();
  delete recenter.__reactFiber$test;
  zoom = 19;
  signal();
  await settle();
  assert.equal(refresh(), null);
  assert.equal(value(), null);
  assert.equal(ol.events.listeners.length, 0);
  assert.equal(layer.events.listeners.length, 0);
  assert.equal(layer.resolutions, resolutions);
  assert.equal(layer.numZoomLevels, 18);
  assert.equal(map.maxZoomLevel, 17);
  assert.equal(zoom, 17, 'restore a valid zoom when the bridge disappears');
  assert.equal(timers.size, 0);
  assert.equal(document.querySelector('.waze-tooltip'), null);
  assert.equal(resizeObservers[0].element, null);
  assert.equal(desktop.hasAttribute('data-wlmrt-map-controls'), false);
  assert.equal(desktop.style.getPropertyValue('--wlmrt-controls-bottom'), '');
  assert.equal(desktop.style.getPropertyValue('--wlmrt-zoom-extra-height'), '');

  // Native controls can be replaced without duplicating our controls or events.
  document.getElementById('map').innerHTML = controls;
  const nextRecenter = document.querySelector('button.wz-control-button');
  nextRecenter.__reactFiber$test = { return: tooltipFiber };
  await settle();
  assert.equal(document.querySelectorAll('#waze-map-refresh').length, 1);
  assert.equal(document.querySelectorAll('#waze-map-zoom-value').length, 1);
  assert.equal(ol.events.listeners.length, 1);
  document.getElementById('map').remove();
  await settle();
  assert.equal(ol.events.listeners.length, 0);
  assert.equal(layer.events.listeners.length, 0);
  assert.equal(warnings.length, 2, 'only the intentionally timed-out and failed tile refreshes should warn');
  console.log('PASS: map-only native controls, zoom 19 and event updates, forced tile refresh, busy/retry, keyboard tooltip, translations, committed map context and lifecycle cleanup.');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => window.close());
