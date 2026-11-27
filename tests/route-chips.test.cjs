const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'waze-live-map-route-toolkit.user.js'), 'utf8');
const dom = new JSDOM('<html lang="vi"><head></head><body><div class="wm-routing__title"></div></body></html>', {
  url: 'https://www.waze.com/live-map', runScripts: 'outside-only', pretendToBeVisual: true,
});
const { window } = dom;
const { document } = window;
// Flush the real scheduled update explicitly instead of assuming synchronous events.
let pendingFrame;
window.requestAnimationFrame = (callback) => { pendingFrame = callback; return 1; };
const flushFrame = () => { const callback = pendingFrame; pendingFrame = null; callback?.(); };
const routes = [
  { isToll: true, tollPriceInfo: { tollPrice: 47000, tollPriceCurrencyCode: 'VND' }, jams: [{ id: 1, severity: 0 }, { id: 2, severity: 2 }, { id: 2, severity: 2 }] },
  { isToll: true, tollPriceInfo: { tollPrice: 61000, tollPriceCurrencyCode: 'VND' }, jams: [] },
  { isToll: false, tollPriceInfo: {}, jams: [] },
];
const cards = routes.map(route => {
  const card = document.createElement('li');
  card.className = 'wm-routes-item-desktop';
  card.innerHTML = '<div class="wm-routes-item-desktop__details"><span><div class="wm-routes-item-desktop__footer">100 KM</div></span></div>';
  // The DOM fiber points to its card component, which owns route.raw.
  card.__reactFiber$test = { stateNode: card, return: { memoizedProps: { route: { raw: route } } } };
  document.body.append(card);
  return card;
});
window.eval(source);
flushFrame();
const chips = card => [...card.querySelectorAll('.wlmrt-route-badges li')].map(node => node.textContent);
assert.equal(chips(cards[0])[0], `Thu phí: ${new Intl.NumberFormat('vi', { style: 'currency', currency: 'VND', currencyDisplay: 'symbol' }).format(47000)}`);
assert.equal(chips(cards[0])[1], 'Kẹt xe vừa ×1');
assert.match(chips(cards[1])[0], /61/);
assert.deepEqual(chips(cards[2]), []);
assert.ok(cards[0].querySelector('.wm-routes-item-desktop__footer').nextElementSibling.matches('ul.wm-routing-badges.wlmrt-route-badges'));
assert.equal(window.getComputedStyle(cards[0].querySelector('.wlmrt-route-badges')).flexWrap, 'wrap');
const refresh = () => { window.dispatchEvent(new window.Event('pageshow')); flushFrame(); };
routes[2].meters = 100000;
routes[2].seconds = 7200;
refresh();
const footer = cards[2].querySelector('.wm-routes-item-desktop__footer');
assert.equal(footer.querySelector('.wlmrt-average-speed').textContent, 'Tốc độ trung bình: 50 km/h');
assert.equal(window.getComputedStyle(footer.querySelector('.wlmrt-average-speed')).display, 'block');
assert.equal(cards[2].querySelector('.wlmrt-route-badges'), null, 'speed also renders on routes without chips');
routes[2].isImperial = true; refresh();
assert.equal(footer.querySelector('.wlmrt-average-speed').textContent, 'Tốc độ trung bình: 31,1 mph');
refresh();
assert.equal(footer.querySelectorAll('.wlmrt-average-speed').length, 1);
footer.textContent = '62.1 MI'; refresh();
assert.equal(footer.firstChild.textContent, '62.1 MI');
assert.equal(footer.querySelector('.wlmrt-average-speed').textContent, 'Tốc độ trung bình: 31,1 mph');
routes[2].seconds = 0; refresh();
assert.equal(footer.textContent, '62.1 MI');
routes[2].seconds = 7200;
routes[2].meters = 0; refresh();
assert.match(footer.textContent, /0 mph/);
routes[2].meters = NaN; refresh();
assert.equal(footer.querySelector('.wlmrt-average-speed'), null);
routes[2].routeAttr = ['FERRY', 'UNPAVED', 'FERRY', 'ETA_FROM_ML']; refresh();
assert.deepEqual(chips(cards[2]), ['Phà', 'Đường chưa trải nhựa']);
assert.equal(cards[2].querySelector('.w-icon-avoid-ferries'), null, 'a ferry route must not use an avoid-ferries icon');
assert.equal(cards[2].querySelector('.wlmrt-route-badges li').querySelector('.w-icon'), null);
routes[2].routeAttr = new window.Set(['UNPAVED']); refresh();
assert.deepEqual(chips(cards[2]), ['Đường chưa trải nhựa']);
routes[2].routeAttr = []; refresh();
assert.deepEqual(chips(cards[2]), []);
const originalJams = routes[0].jams;
routes[0].jams = [0, 1, 1, 2, 3, 4, 5, 99, -1, null, '2'].map((severity, id) => ({ id, severity }));
refresh();
assert.deepEqual(chips(cards[0]).slice(1), [
  'Kẹt xe vừa ×1', 'Kẹt xe nặng ×2', 'Kẹt xe nghiêm trọng ×1', 'Kẹt xe ×7',
]);
const trafficChips = [...cards[0].querySelectorAll('.wlmrt-traffic')];
assert.deepEqual(trafficChips.map(chip => chip.classList[2]), [
  'wlmrt-traffic--moderate', 'wlmrt-traffic--heavy', 'wlmrt-traffic--bumperToBumper', 'wlmrt-traffic--unknown',
]);
assert.deepEqual(trafficChips.map(chip => window.getComputedStyle(chip).getPropertyValue('--wlmrt-traffic-color').trim()),
  ['#ffa600', '#ff5252', '#ff5252', '#ffc400']);
assert.ok(trafficChips.every(chip => chip.querySelector('.wlmrt-traffic-dot[aria-hidden="true"]')));
assert.equal(cards[0].querySelectorAll('.is-jam, .is-toll').length, 0);
const unchangedList = cards[0].querySelector('.wlmrt-route-badges');
refresh();
assert.equal(cards[0].querySelector('.wlmrt-route-badges'), unchangedList);
routes[0].jams = [{ id: 1, severity: 0 }]; refresh();
assert.equal(chips(cards[0])[1], 'Kẹt xe vừa ×1', 'severity zero must display moderate traffic');
routes[0].jams = originalJams;
refresh();
assert.equal(cards[0].querySelectorAll('.wlmrt-route-badges').length, 1);
document.documentElement.lang = 'en-US';
const translations = document.createElement('script');
translations.id = 'i18n-strings';
translations.type = 'application/json';
translations.textContent = JSON.stringify({ locale: 'en-US', translations: {} });
document.body.append(translations);
refresh();
assert.equal(chips(cards[0])[0], 'Tolls: ₫47,000');
assert.equal(chips(cards[0])[1], 'Moderate traffic ×1');
routes[0].tollPriceInfo.tollPrice = 0; refresh();
assert.equal(chips(cards[0])[0], 'Tolls: ₫0');
routes[0].tollPriceInfo.tollPrice = NaN; refresh();
assert.equal(chips(cards[0]).length, 2);
routes[0].jams = []; refresh();
assert.deepEqual(chips(cards[0]), []);
routes[1].isToll = false; refresh();
assert.deepEqual(chips(cards[1]), []);
// Resolve the committed root instead of displaying an old fiber's prices.
const current = { stateNode: cards[1], return: { memoizedProps: { route: { raw: { isToll: true, tollPriceInfo: { tollPrice: 12.5, tollPriceCurrencyCode: 'USD' } } } } } };
cards[1].__reactFiber$test.return.return = { stateNode: { current } };
refresh();
assert.equal(chips(cards[1])[0], 'Tolls: $12.50');
// Cards sharing a React root must share one traversal per mount, then refresh
// the index on the next mount so updated committed fibers remain visible.
const firstCurrent = { stateNode: cards[0], return: { memoizedProps: { route: { raw: routes[0] } } }, sibling: current };
let rootReads = 0;
const sharedCurrentRoot = { get child() { rootReads++; return firstCurrent; } };
const sharedRoot = { stateNode: { current: sharedCurrentRoot } };
cards[0].__reactFiber$test.return.return = sharedRoot;
cards[1].__reactFiber$test.return.return = sharedRoot;
refresh();
assert.equal(rootReads, 2, 'one traversal reads the root child for its check and push');
current.return.memoizedProps.route.raw.tollPriceInfo.tollPrice = 13;
refresh();
assert.equal(rootReads, 4, 'the next mount builds a fresh index');
assert.equal(chips(cards[1])[0], 'Tolls: $13.00');
current.return.memoizedProps.route.raw.tollPriceInfo.tollPrice = 12.5;
const NativeNumberFormat = window.Intl.NumberFormat;
const warnings = [];
window.console.warn = (...args) => warnings.push(args);
window.Intl.NumberFormat = function (locale, options) {
  if (options?.style === 'currency') throw new RangeError('format failure');
  return new NativeNumberFormat(locale, options);
};
const previousPrice = routes[0].tollPriceInfo.tollPrice;
routes[0].tollPriceInfo.tollPrice = 47000;
refresh(); refresh();
assert.equal(warnings.length, 2, 'one warning per affected route, not per remount');
assert.ok(warnings.every(args => args[0].includes('Cannot format toll price')));
assert.deepEqual(chips(cards[1]), [], 'format failure must omit only the price chip');
window.Intl.NumberFormat = NativeNumberFormat;
routes[0].tollPriceInfo.tollPrice = previousPrice;
refresh();
assert.equal(chips(cards[1])[0], 'Tolls: $12.50');
// Prefer the live page dictionary for all route chips, including other locales.
translations.textContent = JSON.stringify({ locale: 'vi', translations: { livemap: {
  route: { badges: { toll: 'Thu phí' }, attributes: { ferry: 'Lộ trình có đi qua phà' } },
  alerts: { jam: {
    default: 'Kẹt xe', jam_light_traffic: 'Giao thông thưa thớt',
    jam_moderate_traffic: 'Giao thông trung bình', jam_heavy_traffic: 'Giao thông đông đúc',
    jam_stand_still_traffic: 'Kẹt cứng', jam_standstill_traffic: 'Ùn tắc nghiêm trọng',
  }, road_closed: { default: 'Đường bị đóng' } },
} } });
routes[0].tollPriceInfo.tollPrice = 47000;
routes[0].jams = [0, 1, 2, 3, 4, 5, 99].map((severity, id) => ({ id, severity }));
refresh();
assert.match(chips(cards[0])[0], /^Thu phí: /);
assert.equal(cards[0].querySelector('.wlmrt-route-badges li .w-icon'), null);
assert.equal(cards[0].querySelector('.wlmrt-route-badges li').hasAttribute('title'), false);
routes[2].routeAttr = new window.Set(['FERRY', 'UNPAVED']); refresh();
assert.deepEqual(chips(cards[2]), ['Phà', 'Đường chưa trải nhựa'], 'attribute chips reuse short Avoid labels instead of Waze route sentences');
assert.deepEqual(chips(cards[0]).slice(1), [
  'Giao thông trung bình ×1', 'Giao thông đông đúc ×1', 'Ùn tắc nghiêm trọng ×1', 'Kẹt xe ×4',
]);
translations.textContent = JSON.stringify({ locale: 'fr', translations: { livemap: { alerts: { jam: {
  jam_light_traffic: 'Trafic fluide', jam_moderate_traffic: ' ',
  jam_standstill_traffic: 'Trafic bloqué',
} } } } });
refresh();
assert.equal(chips(cards[0])[1], 'Moderate traffic ×1', 'blank translation uses fallback');
assert.equal(chips(cards[0])[2], 'Heavy traffic ×1', 'missing translation uses fallback');
assert.equal(chips(cards[0])[3], 'Trafic bloqué ×1', 'bumper-to-bumper uses the Waze translation');
assert.equal(chips(cards[0])[4], 'Traffic ×4', 'unverified severities remain generic');
assert.equal(cards[0].querySelectorAll('.wlmrt-traffic--closed').length, 0);
setTimeout(() => window.close(), 50);
console.log('PASS: per-route tolls, locale, zero/missing prices, jams, placement, wrapping, remount and committed fibers.');
