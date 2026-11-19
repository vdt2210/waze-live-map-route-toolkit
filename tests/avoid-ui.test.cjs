const fs = require('node:fs');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
const fixture = `<html lang="vi"><head></head><body>
  <script id="i18n-strings" type="application/json">${JSON.stringify({ locale: 'vi', translations: { livemap: { route: { badges: { toll: 'Thu phí cộng đồng' } } } } })}</script>
  <div class="wm-routing"><div class="wm-routing__title"></div>
  <div class="wz-search-from-to">Native search</div><div class="wm-routing__scrollable">
  <div class="wm-routing-schedule wm-routing__reducer">Native schedule</div></div></div>
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
const frame = () => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
const change = node => node.dispatchEvent(new window.Event('change', { bubbles: true }));
(async () => {
  window.eval(source);
  const panel = document.getElementById('waze-route-avoids');
  const schedule = document.querySelector('.wm-routing-schedule');
  assert.equal(schedule.previousElementSibling, panel);
  assert.equal(panel.tagName, 'DETAILS');
  assert.equal(panel.open, false);
  const initialURL = window.location.href;
  await frame();
  assert.equal(window.location.href, initialURL, 'component initialization must not change routing parameters');
  panel.open = true;
  document.body.append(document.createElement('div'));
  await frame();
  assert.equal(panel.open, true, 'ordinary remount preserves expansion');
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);
  assert.equal(panel.querySelectorAll('wz-checkbox').length, 4);
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
  unpaved.click();
  const menu = document.querySelector('.wvi-avoid-menu');
  assert.ok(menu);
  assert.equal(unpaved.getAttribute('aria-expanded'), 'true');
  assert.equal(menu.querySelectorAll('[role="option"]').length, 3);
  menu.querySelector('[data-value="allow"]').click();
  assert.equal(document.querySelector('.wvi-avoid-menu'), null);
  unpaved.click();
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key:'ArrowDown', bubbles:true}));
  assert.equal(document.activeElement.dataset.value, 'avoid_long');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
  assert.equal(document.activeElement, unpaved);
  assert.equal(unpaved.getAttribute('aria-expanded'), 'false');
  unpaved.click();
  document.body.click();
  assert.equal(document.querySelector('.wvi-avoid-menu'), null);
  assert.match(new URL(window.location.href).searchParams.get('rp_options'), /AVOID_TRAILS:f/);
  assert.ok(!new URL(window.location.href).searchParams.get('rp_options').includes('AVOID_LONG_TRAILS:'));

  const suggestions = document.createElement('div');
  suggestions.className = 'wz-search-suggestions';
  schedule.parentElement.before(suggestions);
  unpaved.click();
  suggestions.textContent = 'Search result';
  await frame();
  assert.equal(window.getComputedStyle(panel).display, 'none');
  assert.equal(document.querySelector('.wvi-avoid-menu'), null, 'hide the portaled menu along with the avoid panel');
  suggestions.textContent = '';
  await frame();
  assert.notEqual(window.getComputedStyle(panel).display, 'none');

  // A changed community string must replace the old label, without duplicate UI.
  document.getElementById('i18n-strings').textContent = JSON.stringify({ locale: 'vi', translations: { livemap: { route: { badges: { toll: 'Bản dịch mới' } } } } });
  await frame();
  assert.equal(panel.querySelector('[data-i18n="tolls"]').textContent, 'Bản dịch mới');
  assert.equal(document.querySelectorAll('#waze-route-avoids').length, 1);

  // React replacing the scrollable panel must reattach the existing controls.
  const replacement = schedule.cloneNode(true);
  panel.remove(); schedule.replaceWith(replacement);
  await frame();
  const remounted = document.getElementById('waze-route-avoids');
  assert.equal(replacement.previousElementSibling, remounted);
  assert.equal(remounted.querySelector('[data-avoid="AVOID_FERRIES"]').checked, true);
  assert.equal(remounted.querySelector('[data-avoid="unpaved"]').dataset.value, 'allow');

  // History navigation restores controls from the URL rather than stale DOM.
  window.history.replaceState(null, '', '?rp_vehicleType=TAXI&rp_options=AVOID_FERRIES:f,AVOID_TRAILS:f,AVOID_LONG_TRAILS:t');
  window.dispatchEvent(new window.PopStateEvent('popstate'));
  assert.equal(remounted.querySelector('[data-avoid="AVOID_FERRIES"]').checked, false);
  assert.equal(remounted.querySelector('[data-avoid="unpaved"]').dataset.value, 'avoid_long');
  assert.equal(document.querySelector('button[data-vehicle="TAXI"]').getAttribute('aria-pressed'), 'true');

  // Missing route bridge: preserve URL, restore checkbox and expose Retry.
  window.history.replaceState(null, '', '?from=ll.1,2&to=ll.3,4&rp_options=AVOID_FERRIES:f');
  const before = window.location.href;
  const unavailable = remounted.querySelector('[data-avoid="AVOID_FERRIES"]');
  unavailable.checked = true; change(unavailable);
  assert.equal(window.location.href, before);
  assert.equal(unavailable.checked, false);
  assert.equal(remounted.querySelector('[data-i18n="retry"]'), null);
  assert.equal(document.querySelector('.wvi-status'), null);
  console.log('PASS: collapsed disclosure, Waze component contracts, no startup route, UI placement, translations, URL interaction, remounting, history, bridge failure without extra error UI.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => window.close());
