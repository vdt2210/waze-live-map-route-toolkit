const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');

async function setup(fullUI = false, cancelThrows = false) {
  const dom = new JSDOM(`<html lang="en"><head></head><body><div class="wm-cards"><div class="wm-routing">
    <div class="wm-routing__title"></div><div class="wz-search-from-to">
      <div class="wz-search-container is-origin"><div class="wm-search"></div></div>
      <div class="wz-search-container is-destination"><div class="wm-search"></div></div>
    </div><div id="search-suggestions"></div>
    <wz-button data-hook="SAVE_TO_APP_BUTTON">Save</wz-button></div></div></body></html>`, {
    url: 'https://www.waze.com/vi/live-map/directions?rp_vehicleType=TAXI&rp_options=AVOID_FERRIES:t&zoom=17#map',
    runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const { window } = dom;
  const { document } = window;
  const actions = [];
  const warnings = [];
  window.console.warn = (...args) => warnings.push(args);
  const frame = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  function endpoints(from = true, to = true) {
    const url = new URL(window.location.href);
    for (const [name, enabled] of [['from', from], ['to', to]]) {
      if (enabled) url.searchParams.set(name, name === 'from' ? 'll.1,2' : 'll.3,4');
      else url.searchParams.delete(name);
    }
    window.history.replaceState(null, '', url);
    document.querySelector('.wm-cards').className = from && to
      ? 'wm-cards is-destination with-routing' : 'wm-cards is-destination';
    for (const endpoint of ['origin', 'destination']) {
      const search = document.querySelector(`.wz-search-container.is-${endpoint} .wm-search`);
      const selected = document.createElement('div');
      selected.className = 'wm-search__selected';
      selected.addEventListener('click', () => {
        actions.push(`edit:${endpoint}`);
        // Native React commits edit and clear state asynchronously.
        window.requestAnimationFrame(() => {
          const clear = document.createElement('div');
          clear.className = 'wm-search__clear-icon';
          clear.setAttribute('role', 'button');
          clear.addEventListener('click', () => {
            actions.push(`clear:${endpoint}`);
            window.requestAnimationFrame(() => {
              const next = new URL(window.location.href);
              next.searchParams.delete(endpoint === 'origin' ? 'from' : 'to');
              window.history.replaceState(null, '', next);
              document.querySelector('.wm-cards').classList.remove('with-routing');
              const input = document.createElement('input');
              input.className = 'wm-search__input';
              search.replaceChildren(input);
            });
          });
          search.replaceChildren(clear);
        });
      });
      search.replaceChildren(selected);
    }
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  }
  if (fullUI) {
    require('./native-tooltip-runtime.cjs')(window);
    window.eval(source);
    await frame(); await frame();
  } else {
    window.cancelTest = () => { actions.push('cancel'); if (cancelThrows) throw Error('cleanup failed'); };
    window.eval(source.slice(0, source.indexOf('  // Waze mounts and replaces')) + `
      function scheduleMount() {}
      globalThis.api = { clearRoute, selectVehicle,
        pending: () => { activeRequest = { id: ++requestSequence, cancel: cancelTest }; failed = true; },
        state: () => ({ clearingRoute, activeRequest, failed, requestSequence }) };
    })();`);
  }
  return { window, document, endpoints, actions, warnings, frame };
}

(async () => {
  for (const cancelThrows of [false, true]) {
    const t = await setup(false, cancelThrows);
    try {
      await t.window.api.clearRoute();
      assert.deepEqual(t.actions, [], 'inactive page has no clear side effects');
      t.endpoints();
      t.window.api.pending();
      const clearing = t.window.api.clearRoute();
      await t.window.api.clearRoute();
      await t.window.api.selectVehicle('MOTORCYCLE');
      await clearing;
      assert.deepEqual(t.actions, ['cancel', 'edit:origin', 'clear:origin', 'edit:destination', 'clear:destination']);
      const url = new URL(t.window.location.href);
      assert.equal(url.searchParams.has('from'), false);
      assert.equal(url.searchParams.has('to'), false);
      assert.equal(url.pathname, '/vi/live-map/directions');
      assert.equal(url.searchParams.get('rp_vehicleType'), 'TAXI');
      assert.equal(url.searchParams.get('rp_options'), 'AVOID_FERRIES:t');
      assert.equal(url.searchParams.get('zoom'), '17');
      assert.equal(url.hash, '#map');
      assert.equal(t.window.api.state().clearingRoute, false);
      assert.equal(t.window.api.state().activeRequest, null);
      assert.equal(t.window.api.state().failed, false);
      assert.equal(t.window.api.state().requestSequence, 2, 'invalidate old request polling');
      assert.equal(t.warnings.length, cancelThrows ? 1 : 0);
    } finally { t.window.close(); }
  }
  const t = await setup(true);
  try {
    assert.equal(t.document.getElementById('waze-route-clear'), null, 'default page unchanged');
    t.endpoints(false, true);
    await t.frame(); await t.frame();
    assert.equal(t.document.getElementById('waze-route-clear'), null, 'one endpoint is not directions');
    t.document.querySelector('.wm-cards').classList.add('with-routing');
    await t.frame(); await t.frame();
    assert.ok(t.document.getElementById('waze-route-clear'), 'native routing classes govern visibility independently of URL');
    t.endpoints();
    await t.frame(); await t.frame();
    const cards = t.document.querySelector('.wm-cards');
    cards.classList.remove('is-destination');
    await t.frame(); await t.frame();
    assert.equal(t.document.getElementById('waze-route-clear'), null, 'URL endpoints alone do not enable clear');
    cards.classList.add('is-destination');
    await t.frame(); await t.frame();
    const clear = t.document.getElementById('waze-route-clear');
    assert.equal(clear.closest('.wm-routing__title'), t.document.querySelector('.wm-routing__title'));
    assert.equal(clear.closest('#waze-vehicle-icons'), null);
    const clearStyle = t.window.getComputedStyle(clear.closest('#waze-route-clear-host'));
    assert.equal(clearStyle.gridColumn, '3');
    assert.equal(clearStyle.gridRow, '1');
    assert.notEqual(clearStyle.position, 'absolute');
    assert.equal(clear.tagName, 'BUTTON');
    assert.ok(clear.matches('.wz-sidebar-btn.wz-icon.w-icon-x.w-icon'));
    clear.dispatchEvent(new t.window.FocusEvent('focusin', { bubbles: true }));
    clear.dispatchEvent(new t.window.MouseEvent('mouseover', { bubbles: true }));
    await t.frame();
    assert.ok(clear.getAttribute('aria-label'));
    assert.equal(clear.hasAttribute('title'), false);
    assert.equal(t.document.querySelector('.waze-tooltip'), null, 'clear has no hover or focus tooltip');
    clear.click(); clear.click();
    for (let n = 0; n < 6; n++) await t.frame();
    assert.deepEqual(t.actions, ['edit:origin', 'clear:origin', 'edit:destination', 'clear:destination']);
    assert.equal(t.document.getElementById('waze-route-clear'), null);
    assert.equal(t.document.querySelector('.waze-tooltip'), null);
    assert.notEqual(t.window.getComputedStyle(t.document.querySelector('.wm-routing')).display, 'none');
    assert.equal(t.document.getElementById('waze-route-open-host'), null);
    t.endpoints();
    await t.frame(); await t.frame();
    assert.equal(t.document.querySelectorAll('#waze-route-clear').length, 1);
  } finally { t.window.close(); }
  console.log('PASS: native clearing, delayed renders, cancellation, no reload/hiding, route-only visibility, no clear tooltip and reentry.');
})().catch(error => { console.error(error); process.exitCode = 1; });
