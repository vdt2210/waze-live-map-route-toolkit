// ==UserScript==
// @name           Waze Map Vehicle Selector
// @name:vi        Chọn phương tiện trên Waze Map
// @namespace      https://greasyfork.org/en/users/1603731-vdt2210
// @version        1.0
// @author         vdt2210
// @description    Switch between car, motorcycle, and taxi routes on Waze Map.
// @description:vi Chọn Ô tô / Xe máy / Taxi trên Waze Map.
// @include        /^https:\/\/(www|beta)\.waze\.com\/.*live-map.*$/
// @license         MIT
// @grant          none
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  const I18N = {
    en: {
      vehicles: { PRIVATE: 'Car', MOTORCYCLE: 'Motorcycle', TAXI: 'Taxi' },
      vehicleType: 'Vehicle type',
      unavailable: 'Waze route controls are unavailable. Please update the script.',
      updateFailed: 'Route update failed. Click an icon to retry.'
    },
    vi: {
      vehicles: { PRIVATE: 'Ô tô', MOTORCYCLE: 'Xe máy', TAXI: 'Taxi' },
      vehicleType: 'Chọn phương tiện',
      unavailable: 'Không kết nối được bộ tính tuyến Waze. Cần cập nhật script.',
      updateFailed: 'Chưa cập nhật được tuyến. Bấm icon để thử lại.'
    }
  };
  const ID = 'waze-vehicle-icons';
  const STYLE_ID = `${ID}-style`;
  const PARAM = 'rp_vehicleType';
  const vehicles = [
    { type: 'PRIVATE', icon: 'car' },
    { type: 'MOTORCYCLE', icon: 'motorcycle' },
    { type: 'TAXI', icon: 'taxi' }
  ];
  let locale = document.documentElement.lang || 'en';
  try {
    const data = JSON.parse(document.getElementById('i18n-strings')?.textContent || '{}');
    locale = data.locale || locale;
  } catch (error) { console.warn('[Waze Map Vehicle Selector] Cannot read translations', error); }
  const normalizeLocale = value => value.toLowerCase().replace(/_/g, '-');
  const language = normalizeLocale(locale);
  const locales = [...new Set([language, language.split('-')[0], 'en'])];
  const lookup = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  const usable = value => typeof value === 'string' && value.trim().length > 0;
  function t(key) {
    for (const candidate of locales) {
      const dictionary = I18N[candidate] || Object.entries(I18N)
        .find(([name]) => normalizeLocale(name) === candidate)?.[1];
      const value = lookup(dictionary, key);
      if (usable(value)) return value;
    }
    return key;
  }
  let requestSequence = 0;
  let activeRequest = null;
  let failed = false;
  let message = '';

  function samePoint(a, b) {
    return a && b && a.lat === b.lat && a.lng === b.lng;
  }

  function routeBridge() {
    const title = document.querySelector('.wm-routing__title');
    if (!title) return null;
    const key = Object.keys(title).find(name => name.startsWith('__reactFiber$'));
    let fiber = key && title[key];
    if (!fiber) return null;
    // A DOM fiber can refer to the previous render. Resolve the committed tree.
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current) {
      const stack = [root.stateNode.current];
      let count = 0;
      let current = null;
      while (stack.length && count++ < 20000) {
        const node = stack.pop();
        if (node.stateNode === title) { current = node; break; }
        if (node.sibling) stack.push(node.sibling);
        if (node.child) stack.push(node.child);
      }
      if (!current) return null;
      fiber = current;
    }
    for (; fiber; fiber = fiber.return) {
      const routing = fiber.memoizedProps?.value;
      if (!routing?.from?.latLng || !routing?.to?.latLng) continue;
      const last = fiber.updateQueue?.lastEffect;
      let effect = last?.next;
      if (!effect) continue;
      const seen = new Set();
      while (effect && !seen.has(effect)) {
        seen.add(effect);
        const deps = effect.deps;
        // Waze's native route effect depends on origin, destination, time, reverse.
        if (deps?.length === 4 && (effect.tag & 8) &&
          samePoint(deps[0], routing.from.latLng) && samePoint(deps[1], routing.to.latLng) &&
          deps[2] === (routing.at || 'now') && deps[3] === routing.reverse &&
          typeof effect.create === 'function') {
          return { routing, effect };
        }
        effect = effect.next;
      }
    }
    return null;
  }

  function selectedType() {
    const type = new URL(location.href).searchParams.get(PARAM);
    return vehicles.some(vehicle => vehicle.type === type) ? type : 'PRIVATE';
  }

  async function selectVehicle(type) {
    if (type === selectedType() && !failed) return;
    const requestId = ++requestSequence;
    // Keep our own reference: React may replace the effect between rapid clicks.
    const previousCancel = activeRequest?.cancel;
    activeRequest = null;
    if (typeof previousCancel === 'function') previousCancel();
    const url = new URL(location.href);
    const oldURL = url.href;
    const bridge = routeBridge();
    const hasRoute = url.searchParams.has('from') && url.searchParams.has('to');
    if (hasRoute && !bridge) {
      message = t('unavailable');
      failed = true;
      mount();
      return;
    }
    url.searchParams.delete('vehicle_type');
    url.searchParams.delete('vehicleType');
    url.searchParams.set(PARAM, type);
    failed = false;
    message = '';
    let started = false;
    try {
      history.replaceState(history.state, '', url.href);
      if (!bridge) { mount(); return; }
      mount();
      // Reuse Waze's request, response parsing, loading state and map rendering.
      // Its existing cleanup cancels the old request, including on unmount.
      const holder = bridge.effect.inst || bridge.effect;
      if (typeof holder.destroy === 'function' && holder.destroy !== previousCancel) holder.destroy();
      const before = bridge.routing.routes;
      started = true;
      const cancel = bridge.effect.create();
      holder.destroy = cancel;
      activeRequest = { id: requestId, cancel };
      // Let Waze own the network timeout. A slow request is not a script error.
      while (requestId === requestSequence) {
        await new Promise(resolve => setTimeout(resolve, 150));
        // Superseded requests must not clear a newer message or mark it failed.
        if (requestId !== requestSequence) return;
        const current = routeBridge()?.routing;
        // Waze cleans up its request when the panel unmounts or endpoints change.
        if (!current || !samePoint(current.from?.latLng, bridge.routing.from?.latLng) ||
          !samePoint(current.to?.latLng, bridge.routing.to?.latLng)) return;
        if (current.error) throw new Error('Waze could not calculate this route');
        if (!current.locked && Array.isArray(current.routes) && current.routes !== before) {
          message = '';
          return;
        }
      }
    } catch (error) {
      if (requestId !== requestSequence) return;
      failed = true;
      // Keep the chosen URL on request errors so clicking the same icon retries.
      if (!started) history.replaceState(history.state, '', oldURL);
      message = t('updateFailed');
      console.warn('[Waze Map Vehicle Selector]', error);
    } finally {
      if (requestId === requestSequence) {
        if (activeRequest?.id === requestId) activeRequest = null;
        mount();
      }
    }
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ID} {
        display: flex; flex-wrap: wrap; align-items: center; justify-content: space-evenly;
        gap: 12px; padding: 0 8px 12px; flex: 0 0 auto;
        box-sizing: border-box; width: 100%; background: #fff; color: #202124;
      }
      #${ID} button {
        appearance: none; border: 0; background: transparent; color: inherit;
        display: flex; align-items: center; justify-content: center;
        padding: 0; margin: 0; min-width: 64px;
        cursor: pointer; font: 12px/1.4 Arial, sans-serif;
      }
      #${ID} .wvi-icon {
        display: flex; align-items: center; justify-content: center;
        width: 56px; height: 34px; border-radius: 100px;
        transition: background-color .15s ease, color .15s ease;
      }
      #${ID} button:hover .wvi-icon { background: #edf3f5; }
      #${ID} button[aria-pressed="true"] .wvi-icon {
        background-color: var(--wz-button-background-color, var(--primary, #0099ff));
        color: var(--on_primary, #ffffff);
      }
      #${ID} button:focus-visible { outline: 2px solid var(--primary, #0099ff); outline-offset: 4px; border-radius: 8px; }
      #${ID} .w-icon { font-size: 24px; line-height: 1; }
      #${ID} .wvi-status { width: 100%; text-align: center; font-size: 12px; line-height: 1.4; color: var(--content_p2, #55595e); }
      #${ID} .wvi-status:empty { display: none; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function mount() {
    // Wait for Waze to render its routing panel before attaching the controls.
    const title = document.querySelector('.wm-routing__title');
    if (!title) return;
    addStyle();
    let row = document.getElementById(ID);
    if (!row) {
      row = document.createElement('div');
      row.id = ID;
      row.setAttribute('role', 'group');
      row.setAttribute('aria-label', t('vehicleType'));
      for (const vehicle of vehicles) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.vehicle = vehicle.type;
        const name = t(`vehicles.${vehicle.type}`);
        button.title = name;
        button.setAttribute('aria-label', name);
        const icon = document.createElement('span');
        icon.className = 'wvi-icon';
        const glyph = document.createElement('i');
        glyph.className = `w-icon w-icon-${vehicle.icon}`;
        glyph.setAttribute('aria-hidden', 'true');
        icon.append(glyph);
        button.append(icon);
        button.addEventListener('click', () => selectVehicle(vehicle.type));
        row.append(button);
      }
      const status = document.createElement('span');
      status.className = 'wvi-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      row.append(status);
    }
    if (title.nextElementSibling !== row) title.after(row);
    const selected = selectedType();
    for (const button of row.querySelectorAll('button')) {
      const pressed = String(button.dataset.vehicle === selected);
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed);
    }
    const status = row.querySelector('.wvi-status');
    if (status && status.textContent !== message) status.textContent = message;
  }

  // Waze mounts and replaces its React panels after navigation and search.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; mount(); });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', mount);
  window.addEventListener('pageshow', mount);
  mount();
})();
