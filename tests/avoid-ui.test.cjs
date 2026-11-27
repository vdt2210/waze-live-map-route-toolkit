const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
const fixture = `<html lang="vi"><head></head><body>
  <script id="i18n-strings" type="application/json">${JSON.stringify({ locale: 'vi', translations: { livemap: { route: { badges: { toll: 'Thu phí cộng đồng' } } } } })}</script>
  <div class="wm-routing"><div class="wm-routing__title"></div>
  <div class="wz-search-from-to">Native search</div><div id="search-suggestions" class="wz-search-suggestions"></div><div class="wm-routing__scrollable">
  <div class="wm-routing-schedule wm-routing__reducer">Native schedule</div></div>
  <div class="wm-routes__header wm-routing__reducer"><h2 class="wm-routes__title">Routes</h2></div><div class="wm-routing-actions wm-routing__reducer"><div><wz-button color="secondary" size="md" type="button" name="" value=""><i class="w-icon-share w-icon"></i></wz-button></div><div><wz-button data-hook="SAVE_TO_APP_BUTTON" color="primary" size="md" type="button" name="" value="">Save to app</wz-button></div></div></div>
</body></html>`;
const dom = new JSDOM(fixture, {
  url: 'https://www.waze.com/vi/live-map/directions?rp_vehicleType=MOTORCYCLE&rp_options=ALLOW_UTURNS:f',
  runScripts: 'outside-only', pretendToBeVisual: true
});
const { window } = dom;
const document = window.document;
// Checkbox contract double; the dropdown uses Waze Live Map DOM classes.
window.customElements.define('wz-checkbox', class extends window.HTMLElement {
  constructor() { super(); this.checked = false; }
});
window.customElements.define('wz-button', class extends window.HTMLElement {
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
});
const frame = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
const change = node => node.dispatchEvent(new window.Event('change', { bubbles: true }));
(async () => {
  const nativeTooltip = require('./native-tooltip-runtime.cjs')(window);
  const chunks = window.webpackChunklivemap;
  delete window.webpackChunklivemap;
  window.eval(source);
  await frame();
  assert.equal(document.querySelector('#waze-route-refresh-host'), null, 'wait safely until Waze runtime is available');
  assert.ok(document.querySelector('#waze-vehicle-icons'), 'other controls still mount without the tooltip runtime');
  window.webpackChunklivemap = chunks;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  await frame(); // Allow both independent React roots to commit after runtime discovery.
  const save = document.querySelector('[data-hook="SAVE_TO_APP_BUTTON"]');
  let refresh = document.getElementById('waze-route-refresh');
  const host = document.getElementById('waze-route-refresh-host');
  const header = document.querySelector('.wm-routes__header');
  const routeTitle = header.querySelector('.wm-routes__title');
  const actions = document.querySelector('.wm-routing-actions');
  assert.equal(host.parentElement, header);
  assert.equal(routeTitle.nextElementSibling, host);
  assert.equal(save.parentElement.children.length, 1, 'Save wrapper remains untouched');
  assert.equal(document.querySelector('.wlmrt-refresh-action'), null);
  assert.equal(actions.children.length, 2, 'leave the Share and Save action containers untouched');
  assert.equal(actions.firstElementChild.querySelector('.w-icon-share') !== null, true);
  assert.equal(refresh.tagName, 'WZ-BUTTON');
  assert.equal(refresh.getAttribute('color'), 'secondary');
  assert.equal(refresh.getAttribute('size'), 'sm');
  assert.equal(window.getComputedStyle(header).alignItems, 'center');
  assert.equal(refresh.hasAttribute('title'), false, 'use Waze tooltip without a duplicate browser tooltip');
  assert.equal(document.querySelector('wz-basic-tooltip'), null);
  assert.equal(refresh.getAttribute('aria-label'), 'Làm mới tuyến đường');
  assert.equal(refresh.textContent, '', 'refresh uses only an icon');
  assert.equal(refresh.querySelector('.w-icon-refresh').getAttribute('aria-hidden'), 'true');
  assert.equal(refresh.disabled, true, 'refresh unavailable without a route bridge');
  const vehicleRow = document.getElementById('waze-vehicle-icons');
  for (const button of vehicleRow.querySelectorAll('wz-button')) {
    assert.equal(button.getAttribute('size'), 'sm');
    assert.equal(button.hasAttribute('title'), false, 'native tooltips replace browser titles');
    assert.ok(nativeTooltip.renders.some((entry) => entry.text === button.getAttribute('aria-label')));
  }
  assert.equal(vehicleRow.querySelectorAll('wz-button').length, 3);
  assert.equal(vehicleRow.querySelector('[data-vehicle="MOTORCYCLE"]').getAttribute('color'), 'primary');
  assert.equal(document.getElementById('waze-route-clear'), null, 'no clear button before directions');
  assert.equal(vehicleRow.querySelector('[data-vehicle="PRIVATE"]').getAttribute('color'), 'clear-icon');
  assert.equal(vehicleRow.querySelector('[data-vehicle="TAXI"]').getAttribute('color'), 'clear-icon');
  const resultPanel = document.createElement('div');
  resultPanel.className = 'wm-routing__scrollable';
  resultPanel.innerHTML = '<div class="wm-routes"><div class="wm-routes__header">Routes</div><ul class="wm-routes__list"><li>Previous route</li></ul></div>';
  document.body.append(resultPanel);
  const resultList = resultPanel.querySelector('.wm-routes__list');
  const resultContainer = resultList.parentElement;
  const nativeStatus = document.createElement('div');
  nativeStatus.className = 'wm-routing-status';
  nativeStatus.textContent = 'Searching for routes…';
  assert.notEqual(window.getComputedStyle(resultContainer).display, 'none');
  resultPanel.append(nativeStatus);
  assert.equal(window.getComputedStyle(resultContainer).display, 'none', 'hide the entire routes container, including its header, while loading');
  assert.notEqual(window.getComputedStyle(nativeStatus).display, 'none', 'keep Waze loading visible in its original location');
  assert.equal(resultList.children.length, 1, 'preserve route nodes for React');
  nativeStatus.remove();
  assert.notEqual(window.getComputedStyle(resultContainer).display, 'none', 'restore routes when Waze removes loading');
  nativeStatus.classList.add('wm-routing-status--mobile');
  resultPanel.append(nativeStatus);
  assert.notEqual(window.getComputedStyle(resultContainer).display, 'none', 'ignore unrelated mobile loading status');
  resultPanel.remove();
  // Supply the routing bridge only for the tooltip interaction check.
  const title = document.querySelector('.wm-routing__title');
  const routing = { from: { latLng: { lat: 1, lng: 2 } }, to: { latLng: { lat: 3, lng: 4 } }, reverse: false };
  const effect = { tag: 8, deps: [routing.from.latLng, routing.to.latLng, 'now', false], create() {} };
  effect.next = effect;
  title.__reactFiber$test = { memoizedProps: { value: routing }, updateQueue: { lastEffect: effect } };
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  refresh = document.getElementById('waze-route-refresh');
  assert.equal(refresh.disabled, false);
  assert.equal(refresh.getAttribute('aria-busy'), 'false');
  routing.locked = true;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  refresh = document.getElementById('waze-route-refresh');
  assert.equal(refresh.disabled, true, 'native Waze loading also disables Refresh');
  assert.equal(refresh.getAttribute('aria-busy'), 'true');
  assert.ok(refresh.querySelector('span.wz-spinner'));
  assert.equal(refresh.querySelector('.w-icon-refresh'), null);
  routing.locked = false;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  refresh = document.getElementById('waze-route-refresh');
  assert.equal(refresh.disabled, false);
  assert.equal(refresh.getAttribute('aria-busy'), 'false');
  assert.ok(nativeTooltip.renders.length > 0, 'render the native component obtained from Save');
  assert.equal(refresh.querySelector('.wz-spinner'), null);
  assert.ok(refresh.querySelector('i.w-icon-refresh'));
  assert.deepEqual(nativeTooltip.renders.at(-1), { text: 'Làm mới tuyến đường', placement: 'top', delayMs: 400 });
  refresh.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await frame();
  assert.equal(document.querySelector('body > .waze-tooltip')?.textContent, 'Làm mới tuyến đường');
  refresh.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
  await frame();
  assert.equal(document.querySelector('.waze-tooltip'), null, 'native component closes its own portal');
  refresh.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await frame();
  assert.ok(document.querySelector('.waze-tooltip'));
  refresh.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await frame();
  assert.equal(document.querySelector('.waze-tooltip'), null, 'Escape forwards to native tooltip dismissal');
  refresh.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
  await frame();
  routing.locked = true;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  assert.equal(document.querySelector('.waze-tooltip'), null, 'busy state unmounts native tooltip and its portal');
  assert.ok(nativeTooltip.unmounts() > 0);
  routing.locked = false;
  delete title.__reactFiber$test;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  const panel = document.getElementById('waze-route-avoids');
  const schedule = document.querySelector('.wm-routing-schedule');
  const scrollable = schedule.closest('.wm-routing__scrollable');
  const suggestions = document.getElementById('search-suggestions');
  assert.equal(suggestions.nextElementSibling, panel);
  assert.equal(scrollable.previousElementSibling, panel);
  assert.equal(panel.closest('.wm-routing__scrollable'), null);
  assert.equal(panel.tagName, 'DETAILS');
  assert.equal(panel.open, false);
  const initialURL = window.location.href;
  await frame();
  assert.equal(window.location.href, initialURL, 'component initialization must not change routing parameters');
  panel.open = true;
  document.querySelector('.wm-routing').append(document.createElement('div'));
  await frame();
  assert.equal(panel.open, true, 'ordinary remount preserves expansion');
  assert.equal(document.querySelectorAll('#waze-route-refresh').length, 1);
  const replacementHeader = header.cloneNode(true);
  replacementHeader.querySelector('#waze-route-refresh-host').remove();
  header.replaceWith(replacementHeader);
  await frame();
  assert.equal(replacementHeader.querySelector('.wm-routes__title').nextElementSibling, host, 'reattach after the route title');
  replacementHeader.remove();
  await frame();
  assert.equal(document.querySelector('#waze-route-refresh'), null, 'no refresh without route results');
  actions.before(replacementHeader);
  await frame();
  assert.equal(document.querySelectorAll('#waze-route-refresh').length, 1);
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);
  assert.equal(panel.querySelectorAll('wz-checkbox').length, 4);
  for (const name of ['avoid-tolls', 'avoid-ferries', 'avoid-highways', 'avoid-unpaved']) {
    assert.equal(panel.querySelectorAll(`.w-icon-${name}`).length, 0);
  }
  assert.equal(panel.querySelectorAll('wz-select').length, 0);
  assert.equal(panel.querySelector('[data-i18n="unpaved"]').textContent, 'Đường chưa trải nhựa');
  assert.equal(panel.querySelector('[data-i18n="tolls"]').textContent, 'Thu phí cộng đồng');
  assert.equal(panel.querySelector('[data-i18n="ferries"]').textContent, 'Phà');
  assert.equal(panel.querySelector('[data-avoid="AVOID_DANGEROUS_TURNS"]').checked, true);
  assert.equal(panel.querySelector('[data-avoid="unpaved"]').dataset.value, 'avoid_all');
  const ferry = panel.querySelector('[data-avoid="AVOID_FERRIES"]');
  ferry.checked = true; change(ferry);
  assert.match(new URL(window.location.href).searchParams.get('rp_options'), /AVOID_FERRIES:t/);
  assert.match(new URL(window.location.href).searchParams.get('rp_options'), /ALLOW_UTURNS:f/);
  assert.equal(new URL(window.location.href).searchParams.get('rp_vehicleType'), 'MOTORCYCLE');
  const unpaved = panel.querySelector('[data-avoid="unpaved"]');
  const viewportErrors = [];
  const captureViewportError = (event) => {
    viewportErrors.push(event.error || event.message);
    event.preventDefault();
  };
  window.addEventListener('error', captureViewportError);
  try {
    for (const type of ['resize', 'scroll']) {
      unpaved.click();
      const openMenu = document.querySelector('.wlmrt-avoid-menu');
      openMenu.dispatchEvent(new window.Event('scroll', { bubbles: true }));
      assert.ok(openMenu.isConnected, 'scrolling inside the dropdown keeps it open');
      window.dispatchEvent(new window.Event(type));
      assert.equal(document.querySelector('.wlmrt-avoid-menu'), null, `${type} closes the dropdown`);
      assert.equal(unpaved.getAttribute('aria-expanded'), 'false');
      window.dispatchEvent(new window.Event(type));
      assert.equal(document.querySelector('.wlmrt-avoid-menu'), null, `${type} is safe while closed`);
    }
    unpaved.click();
    document.dispatchEvent(new window.Event('scroll'));
    assert.equal(document.querySelector('.wlmrt-avoid-menu'), null, 'document scroll also closes the dropdown');
    assert.deepEqual(viewportErrors, [], 'window targets must not cause Node.contains errors');
  } finally {
    window.removeEventListener('error', captureViewportError);
  }
  unpaved.click();
  const menu = document.querySelector('.wlmrt-avoid-menu');
  assert.ok(menu);
  assert.equal(unpaved.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.querySelectorAll('[role="option"]').length, 3);
  menu.querySelector('[data-value="allow"]').click();
  assert.equal(document.querySelector('.wlmrt-avoid-menu'), null);
  unpaved.click();
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
  assert.equal(document.activeElement.dataset.value, 'avoid_long');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(document.activeElement, unpaved);
  assert.equal(unpaved.getAttribute('aria-expanded'), 'false');
  unpaved.click();
  document.body.click();
  assert.equal(document.querySelector('.wlmrt-avoid-menu'), null);
  assert.match(new URL(window.location.href).searchParams.get('rp_options'), /AVOID_TRAILS:f/);
  assert.ok(!new URL(window.location.href).searchParams.get('rp_options').includes('AVOID_LONG_TRAILS:'));

  unpaved.click();
  suggestions.textContent = 'Search result';
  await frame();
  assert.equal(window.getComputedStyle(panel).display, 'none');
  assert.equal(document.querySelector('.wlmrt-avoid-menu'), null, 'hide the portaled menu along with the avoid panel');
  suggestions.textContent = '';
  await frame();
  assert.notEqual(window.getComputedStyle(panel).display, 'none');

  // A changed community string must replace the old label, without duplicate UI.
  document.getElementById('i18n-strings').textContent = JSON.stringify({ locale: 'vi', translations: { livemap: { route: { badges: { toll: 'Bản dịch mới' } } } } });
  await frame();
  assert.equal(panel.querySelector('[data-i18n="tolls"]').textContent, 'Bản dịch mới');
  assert.equal(panel.querySelectorAll('.w-icon').length, 0, 'Avoid controls consistently use text labels');
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);

  // React replacing the scrollable panel must reattach the existing controls.
  const replacement = schedule.cloneNode(true);
  panel.remove(); schedule.replaceWith(replacement);
  await frame();
  const remounted = document.getElementById('waze-route-avoids');
  assert.equal(scrollable.previousElementSibling, remounted);
  assert.equal(remounted.closest('.wm-routing__scrollable'), null);
  assert.equal(remounted.querySelector('[data-avoid="AVOID_FERRIES"]').checked, true);
  assert.equal(remounted.querySelector('[data-avoid="unpaved"]').dataset.value, 'allow');

  // History navigation restores controls from the URL rather than stale DOM.
  window.history.replaceState(null, '', '?rp_vehicleType=TAXI&rp_options=AVOID_FERRIES:f,AVOID_TRAILS:f,AVOID_LONG_TRAILS:t');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  await frame();
  assert.equal(remounted.querySelector('[data-avoid="AVOID_FERRIES"]').checked, false);
  assert.equal(remounted.querySelector('[data-avoid="unpaved"]').dataset.value, 'avoid_long');
  assert.equal(document.querySelector('wz-button[data-vehicle="TAXI"]').getAttribute('aria-pressed'), 'true');
  assert.equal(document.querySelector('wz-button[data-vehicle="TAXI"]').getAttribute('color'), 'primary');
  assert.equal(document.querySelector('wz-button[data-vehicle="MOTORCYCLE"]').getAttribute('color'), 'clear-icon');

  // Missing route bridge: preserve URL, restore checkbox and expose Retry.
  window.history.replaceState(null, '', '?from=ll.1,2&to=ll.3,4&rp_options=AVOID_FERRIES:f');
  const before = window.location.href;
  const unavailable = remounted.querySelector('[data-avoid="AVOID_FERRIES"]');
  unavailable.checked = true; change(unavailable);
  await frame();
  assert.equal(window.location.href, before);
  assert.equal(unavailable.checked, false);
  assert.equal(remounted.querySelector('[data-i18n="retry"]'), null);
  assert.equal(document.querySelector('.wlmrt-status'), null);
  title.remove();
  await frame();
  assert.equal(document.querySelector('#waze-route-refresh-host'), null, 'unmount the React root when the routing panel closes');
  assert.equal(document.querySelector('body > .waze-tooltip'), null);
  console.log('PASS: collapsed disclosure, Waze component contracts, no startup route, UI placement, translations, URL interaction, remounting, history, bridge failure without extra error UI.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => window.close());
