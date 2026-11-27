// ==UserScript==
// @name           Waze Live Map Route Toolkit
// @namespace      https://greasyfork.org/en/users/1603731-vdt2210
// @version        1.2.2
// @author         vdt2210
// @description    Select a vehicle and avoid tolls, ferries, freeways, difficult turns, or unpaved roads on Waze Map.
// @description:vi Chọn phương tiện và tùy chọn tránh thu phí, phà, cao tốc, rẽ khó, đường chưa trải nhựa trên Waze Map.
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
      clearRoute: 'Clear all and exit directions',
      refreshRoute: 'Refresh route',
      refreshMap: 'Refresh map',
      refreshFailed: 'Failed to refresh',
      refreshCancelled: 'Refresh interrupted by changes. Retry',
      retry: 'Retry',
      refreshParts: { tiles: 'map tiles', data: 'traffic data', route: 'route' },
      zoomLevel: 'Zoom level',
      avoid: 'Avoid',
      tolls: 'Tolls',
      ferries: 'Ferries',
      freeways: 'Freeways',
      difficult: 'Difficult turns',
      unpaved: 'Unpaved roads',
      allow: 'Allow',
      avoid_long: 'Avoid long ones',
      avoid_all: "Don't allow",
      averageSpeed: 'Average speed',
      traffic: 'Traffic',
      trafficLevels: {
        light: 'Light traffic',
        moderate: 'Moderate traffic',
        heavy: 'Heavy traffic',
        bumperToBumper: 'Bumper to bumper traffic',
      },
    },
    vi: {
      vehicles: { PRIVATE: 'Ô tô', MOTORCYCLE: 'Xe máy', TAXI: 'Taxi' },
      vehicleType: 'Chọn phương tiện',
      clearRoute: 'Xóa tất cả và thoát tìm đường',
      refreshRoute: 'Làm mới tuyến đường',
      refreshMap: 'Làm mới bản đồ',
      refreshFailed: 'Không thể làm mới',
      refreshCancelled: 'Lần làm mới bị gián đoạn do thay đổi. Thử lại',
      retry: 'Thử lại',
      refreshParts: { tiles: 'tile bản đồ', data: 'dữ liệu giao thông', route: 'tuyến đường' },
      zoomLevel: 'Mức thu phóng',
      avoid: 'Tránh',
      tolls: 'Thu phí',
      ferries: 'Phà',
      freeways: 'Cao tốc',
      difficult: 'Rẽ khó',
      unpaved: 'Đường chưa trải nhựa',
      allow: 'Cho phép',
      avoid_long: 'Tránh đoạn dài',
      avoid_all: 'Không cho phép',
      averageSpeed: 'Tốc độ trung bình',
      traffic: 'Kẹt xe',
      trafficLevels: {
        light: 'Kẹt xe nhẹ',
        moderate: 'Kẹt xe vừa',
        heavy: 'Kẹt xe nặng',
        bumperToBumper: 'Kẹt xe nghiêm trọng',
      },
    },
  };
  const ID = 'waze-vehicle-icons';
  const AVOID_ID = 'waze-route-avoids';
  const REFRESH_ID = 'waze-route-refresh';
  const CLEAR_ID = 'waze-route-clear';
  const MAP_REFRESH_ID = 'waze-map-refresh';
  const ZOOM_VALUE_ID = 'waze-map-zoom-value';
  const MAX_MAP_ZOOM = 19;
  const STYLE_ID = `${ID}-style`;
  const PARAM = 'rp_vehicleType';
  const vehicles = [
    { type: 'PRIVATE', icon: 'car' },
    { type: 'MOTORCYCLE', icon: 'motorcycle' },
    { type: 'TAXI', icon: 'taxi' },
  ];
  let locale = document.documentElement.lang || 'en';
  let liveTranslations = {};
  let translationText;
  const liveKeys = {
    averageSpeed: ['livemap.alerts.jam.average_speed'],
    traffic: ['livemap.alerts.jam.default'],
    'trafficLevels.light': ['livemap.alerts.jam.jam_light_traffic'],
    'trafficLevels.moderate': ['livemap.alerts.jam.jam_moderate_traffic'],
    'trafficLevels.heavy': ['livemap.alerts.jam.jam_heavy_traffic'],
    'trafficLevels.bumperToBumper': ['livemap.alerts.jam.jam_standstill_traffic'],
    tolls: [
      'livemap.route.badges.toll',
      'livemap.route_list.badges.toll',
      'livemap.route.type.$$Toll',
    ],
  };
  function readTranslations() {
    const text = document.getElementById('i18n-strings')?.textContent || '{}';
    if (text === translationText) return;
    translationText = text;
    try {
      const data = JSON.parse(text);
      liveTranslations = data.translations || {};
      locale = data.locale || document.documentElement.lang || 'en';
    } catch (error) {
      liveTranslations = {};
      console.warn('[Waze Live Map Route Toolkit] Cannot read translations', error);
    }
  }
  readTranslations();
  const normalizeLocale = (value) => value.toLowerCase().replace(/_/g, '-');
  const lookup = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
  const usable = (value) => typeof value === 'string' && value.trim().length > 0;
  function t(key) {
    for (const path of liveKeys[key] || []) {
      const value = lookup(liveTranslations, path);
      if (usable(value)) return value;
    }
    const language = normalizeLocale(locale);
    const locales = [...new Set([language, language.split('-')[0], 'en'])];
    for (const candidate of locales) {
      const dictionary =
        I18N[candidate] ||
        Object.entries(I18N).find(([name]) => normalizeLocale(name) === candidate)?.[1];
      const value = lookup(dictionary, key);
      if (usable(value)) return value;
    }
    return key;
  }
  let requestSequence = 0;
  let activeRequest = null;
  let failed = false;
  let unpavedControl = null;
  let refreshControl = null;
  let vehicleControl = null;
  let clearControl = null;
  let clearingRoute = false;

  function hasDirections() {
    return Boolean(document.querySelector('.wm-cards.is-destination.with-routing'));
  }

  async function waitForNative(check) {
    for (let frame = 0; frame < 60; frame++) {
      const result = check();
      if (result) return result;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    throw new Error('Waze search controls did not update');
  }

  async function clearRoute() {
    if (clearingRoute || !hasDirections()) return;
    clearingRoute = true;
    ++requestSequence;
    const cancel = activeRequest?.cancel;
    activeRequest = null;
    failed = false;
    scheduleMount(false);
    try {
      try {
        if (typeof cancel === 'function') cancel();
      } catch (error) {
        console.warn('[Waze Live Map Route Toolkit] Cannot cancel route request', error);
      }
      // Waze owns endpoint, URL, marker and route updates through its controls.
      for (const endpoint of ['origin', 'destination']) {
        const selector = `.wz-search-container.is-${endpoint} .wm-search`;
        const search = document.querySelector(selector);
        if (!search) throw new Error('Waze search control is unavailable');
        search.querySelector('.wm-search__selected')?.click();
        const clear = await waitForNative(() =>
          document.querySelector(`${selector} .wm-search__clear-icon[role="button"]`)
        );
        clear.click();
        const param = endpoint === 'origin' ? 'from' : 'to';
        await waitForNative(() => !new URL(location.href).searchParams.has(param));
      }
      document.querySelector('.wz-search-container.is-destination .wm-search__input')?.blur();
    } catch (error) {
      console.warn('[Waze Live Map Route Toolkit] Cannot clear directions', error);
    } finally {
      clearingRoute = false;
      scheduleMount();
    }
  }

  function samePoint(a, b) {
    return a && b && a.lat === b.lat && a.lng === b.lng;
  }

  function routeBridge() {
    const title = document.querySelector('.wm-routing__title');
    if (!title) return null;
    const key = Object.keys(title).find((name) => name.startsWith('__reactFiber$'));
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
        if (node.stateNode === title) {
          current = node;
          break;
        }
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
        if (
          deps?.length === 4 &&
          effect.tag & 8 &&
          samePoint(deps[0], routing.from.latLng) &&
          samePoint(deps[1], routing.to.latLng) &&
          deps[2] === (routing.at || 'now') &&
          deps[3] === routing.reverse &&
          typeof effect.create === 'function'
        ) {
          return { routing, effect };
        }
        effect = effect.next;
      }
    }
    return null;
  }

  function selectedType() {
    const type = new URL(location.href).searchParams.get(PARAM);
    return vehicles.some((vehicle) => vehicle.type === type) ? type : 'PRIVATE';
  }

  function selectVehicle(type) {
    if (!vehicles.some((vehicle) => vehicle.type === type)) return;
    return updateRoute((url) => {
      url.searchParams.delete('vehicle_type');
      url.searchParams.delete('vehicleType');
      url.searchParams.set(PARAM, type);
    });
  }

  const OPTION_PARAM = 'rp_options';
  const avoidFlags = [
    'AVOID_TOLL_ROADS',
    'AVOID_FERRIES',
    'AVOID_PRIMARIES',
    'AVOID_DANGEROUS_TURNS',
  ];
  const optionDefaults = {
    AVOID_TOLL_ROADS: false,
    AVOID_FERRIES: false,
    AVOID_PRIMARIES: false,
    AVOID_DANGEROUS_TURNS: true,
    AVOID_TRAILS: true,
    AVOID_LONG_TRAILS: false,
  };
  function routeOptions(url = new URL(location.href)) {
    return url.searchParams
      .getAll(OPTION_PARAM)
      .flatMap((value) => value.split(','))
      .filter(Boolean);
  }

  function selectedAvoids(url = new URL(location.href)) {
    const flags = { ...optionDefaults };
    let explicitTrails = false;
    for (const token of routeOptions(url)) {
      const match = /^(AVOID_[A-Z_]+):([tf])$/.exec(token);
      if (match && Object.hasOwn(flags, match[1])) flags[match[1]] = match[2] === 't';
      if (match?.[1] === 'AVOID_TRAILS') explicitTrails = true;
    }
    if (flags.AVOID_LONG_TRAILS && !explicitTrails) flags.AVOID_TRAILS = false;
    return {
      ...flags,
      unpaved: flags.AVOID_TRAILS ? 'avoid_all' : flags.AVOID_LONG_TRAILS ? 'avoid_long' : 'allow',
    };
  }

  function selectAvoid(name, value) {
    if (!avoidFlags.includes(name) && name !== 'unpaved') return;
    if (
      name === 'unpaved'
        ? !['allow', 'avoid_long', 'avoid_all'].includes(value)
        : typeof value !== 'boolean'
    )
      return;
    return updateRoute((url) => {
      // Waze avoids all unpaved roads when AVOID_TRAILS is absent.
      // Send AVOID_TRAILS:f to allow them; omit flags that match their defaults.
      const { unpaved, ...changes } = selectedAvoids(url);
      if (name === 'unpaved') {
        changes.AVOID_TRAILS = value === 'avoid_all';
        changes.AVOID_LONG_TRAILS = value === 'avoid_long';
      } else changes[name] = value;
      const tokens = routeOptions(url).filter(
        (token) => !Object.hasOwn(changes, token.split(':')[0])
      );
      for (const [flag, enabled] of Object.entries(changes)) {
        if (enabled !== optionDefaults[flag]) tokens.push(`${flag}:${enabled ? 't' : 'f'}`);
      }
      url.searchParams.delete(OPTION_PARAM);
      if (tokens.length) url.searchParams.set(OPTION_PARAM, tokens.join(','));
    });
  }

  async function updateRoute(change, force = false) {
    if (clearingRoute) return null;
    const url = new URL(location.href);
    const oldURL = url.href;
    change(url);
    if (url.href === oldURL && !failed && !force) return true;
    const requestId = ++requestSequence;
    // Keep our own reference: React may replace the effect between rapid clicks.
    const previousCancel = activeRequest?.cancel;
    activeRequest = null;
    failed = false;
    let started = false;
    try {
      // If native cleanup fails, do not start a competing native request.
      if (typeof previousCancel === 'function') previousCancel();
      const bridge = routeBridge();
      const hasRoute = url.searchParams.has('from') && url.searchParams.has('to');
      if (hasRoute && !bridge) {
        failed = true;
        return false;
      }
      history.replaceState(history.state, '', url.href);
      if (!bridge) return null;
      // Reuse Waze's request, response parsing, loading state and map rendering.
      // Its existing cleanup cancels the old request, including on unmount.
      const holder = bridge.effect.inst || bridge.effect;
      if (typeof holder.destroy === 'function' && holder.destroy !== previousCancel)
        holder.destroy();
      const before = bridge.routing.routes;
      started = true;
      const cancel = bridge.effect.create();
      holder.destroy = cancel;
      activeRequest = { id: requestId, cancel };
      scheduleMount(false);
      // Let Waze own the network timeout. A slow request is not a script error.
      while (requestId === requestSequence) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        // Superseded requests must not mark a newer request failed.
        if (requestId !== requestSequence) return null;
        const current = routeBridge()?.routing;
        // Waze cleans up its request when the panel unmounts or endpoints change.
        if (
          !current ||
          !samePoint(current.from?.latLng, bridge.routing.from?.latLng) ||
          !samePoint(current.to?.latLng, bridge.routing.to?.latLng)
        )
          return null;
        if (current.error) throw new Error('Waze could not calculate this route');
        if (!current.locked && Array.isArray(current.routes) && current.routes !== before) {
          return true;
        }
      }
      return null;
    } catch (error) {
      if (requestId !== requestSequence) return null;
      failed = true;
      // Keep the chosen URL on request errors so clicking the same icon retries.
      if (!started) history.replaceState(history.state, '', oldURL);
      console.warn('[Waze Live Map Route Toolkit]', error);
      return false;
    } finally {
      if (requestId === requestSequence) {
        if (activeRequest?.id === requestId) activeRequest = null;
        scheduleMount(started);
      }
    }
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CLEAR_ID}-host {
        grid-column: 3; grid-row: 1; align-self: center; justify-self: center;
        display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;
      }
      #${CLEAR_ID} { flex: none; }
      .wz-desktop-controls[data-wlmrt-map-controls] {
        bottom: calc(var(--wlmrt-controls-bottom) + var(--wlmrt-zoom-extra-height, 15px));
      }
      #${MAP_REFRESH_ID}-status {
        position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
        border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap;
      }
      #${ZOOM_VALUE_ID} {
        display: block; box-sizing: border-box; width: 100%; padding: 0;
        text-align: center; font: 600 12px/1.2 Arial, sans-serif;
        font-variant-numeric: tabular-nums; background: #fff; color: #202124;
      }
      .wm-routes__header:has(> #${REFRESH_ID}-host) { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      #${REFRESH_ID} .w-icon { display: inline-block; font-size: 20px; }
      .wm-routing__scrollable:has(> .wm-routing-status:not(.wm-routing-status--mobile)) > .wm-routes { display: none; }
      .wlmrt-route-badges { display: flex; flex-wrap: wrap; margin-top: 6px; }
      .wm-routes-item-desktop__footer:has(> .wlmrt-average-speed) { flex-wrap: wrap; }
      .wlmrt-average-speed { display: block; flex-basis: 100%; width: 100%; }
      .wlmrt-route-badges .wm-routing-badges__item { white-space: normal; overflow-wrap: anywhere; max-width: 100%; padding: 2px 6px; }
      .wlmrt-route-badges .wlmrt-traffic { --wlmrt-traffic-color: #ffc400; }
      .wlmrt-route-badges .wlmrt-traffic--light { --wlmrt-traffic-color: #ffc400; }
      .wlmrt-route-badges .wlmrt-traffic--moderate { --wlmrt-traffic-color: #ffa600; }
      .wlmrt-route-badges .wlmrt-traffic--heavy { --wlmrt-traffic-color: #ff5252; }
      .wlmrt-route-badges .wlmrt-traffic--bumperToBumper { --wlmrt-traffic-color: #ff5252; }
      .wlmrt-route-badges .wlmrt-traffic-dot {
        display: inline-block; width: 8px; height: 8px; border-radius: 50%;
        margin-inline-end: 6px; background-color: var(--wlmrt-traffic-color);
        vertical-align: middle;
      }
      #${ID} {
        display: flex; flex-wrap: wrap; align-items: center; justify-content: space-evenly;
        gap: 12px; padding: 0 20px 16px; flex: 0 0 auto;
        box-sizing: border-box; width: 100%; background: #fff; color: #202124;
      }
      #${ID} wz-button { min-width: 48px; }
      #${ID} wz-button[aria-pressed="true"][disabled] {
        --wz-button-disabled-background-color: var(--primary, #0099ff);
        --wz-button-disabled-color: var(--on_primary, #fff);
        --wz-button-cursor: default;
      }
      #${ID} .w-icon { font-size: 24px; line-height: 1; }
      #${AVOID_ID} {
        box-sizing: border-box; width: 100%; padding: 0 20px 16px; flex: 0 0 auto;
        color: var(--content_default, #202124); background: #fff;
        font-family: inherit; font-size: 14px; line-height: 24px;
      }
      #${AVOID_ID} fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
      #${AVOID_ID} summary { cursor: pointer; }
      #${AVOID_ID}[open] summary { margin-bottom: 8px; }
      #${AVOID_ID} .wlmrt-avoid-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin-bottom: 8px; }
      #${AVOID_ID} label { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
      #${AVOID_ID} wz-checkbox { --wz-checkbox-margin: 8px; min-width: 0; }
      #${AVOID_ID} .wlmrt-unpaved { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      #${AVOID_ID} button { font: inherit; color: var(--primary, #0099ff); background: transparent; border: 0; padding: 8px 0 0; cursor: pointer; }
      #${AVOID_ID} .wlmrt-unpaved .wz-react-dropdown__head { padding: 0; color: var(--content_default, #202124); font: inherit; text-align: start; }
      #${AVOID_ID} .wz-react-dropdown__head:focus-visible { outline: 2px solid var(--primary, #0099ff); outline-offset: 3px; border-radius: 3px; }
      .wlmrt-avoid-menu { box-sizing: border-box; max-width: calc(100vw - 16px); color: var(--content_default, #202124); }
      .wlmrt-avoid-menu .wz-react-dropdown__list { min-width: min(240px, calc(100vw - 16px)); font-size: inherit; }
      .wlmrt-avoid-menu .wz-react-dropdown__option { font-size: inherit; outline: none; }
      .wlmrt-avoid-menu .wz-react-dropdown__option:focus { background-color: rgba(0, 0, 0, .04); }
      #${AVOID_ID} [hidden] { display: none; }
      .wz-search-suggestions:not(:empty) ~ #${AVOID_ID} { display: none; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function createUnpavedDropdown(labelId) {
    const element = document.createElement('div');
    element.className = 'wz-react-dropdown';
    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'wz-react-dropdown__head is-default';
    head.dataset.avoid = 'unpaved';
    head.id = `${AVOID_ID}-unpaved-value`;
    head.setAttribute('aria-labelledby', `${labelId} ${head.id}`);
    head.setAttribute('aria-haspopup', 'listbox');
    head.setAttribute('aria-expanded', 'false');
    const menu = document.createElement('div');
    menu.className = 'wz-react-dropdown__list-container wlmrt-avoid-menu';
    const list = document.createElement('div');
    list.className = 'wz-react-dropdown__list';
    list.id = `${AVOID_ID}-unpaved-menu`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', labelId);
    head.setAttribute('aria-controls', list.id);
    menu.append(list);
    const options = ['allow', 'avoid_long', 'avoid_all'].map((value) => {
      const option = document.createElement('div');
      option.className = 'wz-react-dropdown__option';
      option.setAttribute('role', 'option');
      option.tabIndex = -1;
      option.dataset.i18n = value;
      option.dataset.value = value;
      const choose = () => {
        close(true);
        if (value !== selectedAvoids().unpaved) selectAvoid('unpaved', value);
      };
      option.addEventListener('click', choose);
      option.addEventListener('keydown', (event) => {
        if (['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          choose();
        }
      });
      list.append(option);
      return option;
    });
    function close(focus = false) {
      menu.remove();
      head.setAttribute('aria-expanded', 'false');
      head.classList.remove('is-active');
      if (focus) head.focus();
    }
    function open(last = false) {
      if (!element.isConnected) return;
      const typography = getComputedStyle(head);
      menu.style.fontFamily = typography.fontFamily;
      menu.style.fontSize = typography.fontSize;
      menu.style.fontWeight = typography.fontWeight;
      menu.style.lineHeight = typography.lineHeight;
      document.body.append(menu);
      const rect = head.getBoundingClientRect();
      menu.style.minWidth = `${Math.min(Math.max(240, rect.width), window.innerWidth - 16)}px`;
      menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8))}px`;
      const height = menu.offsetHeight;
      menu.style.top = `${rect.bottom + height + 16 <= window.innerHeight ? rect.bottom : Math.max(8, rect.top - height - 16)}px`;
      head.setAttribute('aria-expanded', 'true');
      head.classList.add('is-active');
      (last
        ? options.at(-1)
        : options.find((option) => option.dataset.value === selectedAvoids().unpaved) || options[0]
      ).focus();
    }
    function outside(event) {
      if (!element.contains(event.target) && !menu.contains(event.target)) close();
    }
    function keydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
      if (event.key === 'Tab') close();
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const current = options.indexOf(document.activeElement);
        const index =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : (current + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
        options[index].focus();
      }
    }
    function viewport(event) {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) close();
    }
    head.addEventListener('click', () => (menu.isConnected ? close() : open()));
    head.addEventListener('keydown', (event) => {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        open(event.key === 'ArrowUp');
      }
    });
    menu.addEventListener('keydown', keydown);
    document.addEventListener('click', outside);
    window.addEventListener('resize', viewport);
    window.addEventListener('scroll', viewport, true);
    element.append(head);
    return {
      element,
      close,
      update(value) {
        head.dataset.value = value;
        if (head.textContent !== t(value)) head.textContent = t(value);
        for (const option of options) {
          const text = t(option.dataset.i18n);
          if (option.textContent !== text) option.textContent = text;
          option.setAttribute('aria-selected', String(option.dataset.value === value));
          option.classList.toggle('is-selected', option.dataset.value === value);
        }
      },
      destroy() {
        close();
        document.removeEventListener('click', outside);
        window.removeEventListener('resize', viewport);
        window.removeEventListener('scroll', viewport, true);
      },
    };
  }

  function unmountAvoids() {
    unpavedControl?.destroy();
    unpavedControl = null;
    document.getElementById(AVOID_ID)?.remove();
  }

  function mountAvoids() {
    const suggestions = document.getElementById('search-suggestions');
    if (!suggestions || !customElements.get('wz-checkbox')) {
      unmountAvoids();
      return;
    }
    if (unpavedControl && !unpavedControl.element.isConnected) unmountAvoids();
    let panel = document.getElementById(AVOID_ID);
    if (!panel) {
      panel = document.createElement('details');
      panel.id = AVOID_ID;
      panel.addEventListener('toggle', () => {
        if (!panel.open) unpavedControl?.close();
      });
      const summary = document.createElement('summary');
      summary.dataset.i18n = 'avoid';
      panel.append(summary);
      const fieldset = document.createElement('fieldset');
      fieldset.setAttribute('aria-label', t('avoid'));
      const grid = document.createElement('div');
      grid.className = 'wlmrt-avoid-grid';
      for (const [index, key] of ['tolls', 'ferries', 'freeways', 'difficult'].entries()) {
        const input = document.createElement('wz-checkbox');
        input.dataset.avoid = avoidFlags[index];
        input.addEventListener('change', () => {
          if (input.checked !== selectedAvoids()[input.dataset.avoid])
            selectAvoid(input.dataset.avoid, input.checked);
        });
        const text = document.createElement('span');
        text.dataset.i18n = key;
        input.append(text);
        grid.append(input);
      }
      fieldset.append(grid);
      panel.append(fieldset);
      const label = document.createElement('div');
      label.className = 'wlmrt-unpaved';
      const text = document.createElement('span');
      text.dataset.i18n = 'unpaved';
      text.id = `${AVOID_ID}-unpaved-label`;
      unpavedControl = createUnpavedDropdown(text.id);
      label.append(text, unpavedControl.element);
      panel.append(label);
    }
    if (suggestions.nextElementSibling !== panel) suggestions.after(panel);
    if (panel.matches('.wz-search-suggestions:not(:empty) ~ #' + AVOID_ID)) {
      unpavedControl?.close();
    }
    for (const node of panel.querySelectorAll('[data-i18n]')) {
      const text = t(node.dataset.i18n);
      if (node.textContent !== text) node.textContent = text;
    }
    const selected = selectedAvoids();
    panel.querySelector('fieldset').setAttribute('aria-label', t('avoid'));
    for (const input of panel.querySelectorAll('wz-checkbox')) {
      if (input.checked !== selected[input.dataset.avoid])
        input.checked = selected[input.dataset.avoid];
    }
    unpavedControl.update(selected.unpaved);
  }

  // Read the committed component's route, never pair cards by their list index.
  function cardRoute(card, committedTrees) {
    const key = Object.keys(card).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key && card[key];
    if (!fiber) return null;
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current) {
      const currentRoot = root.stateNode.current;
      let nodes = committedTrees.get(currentRoot);
      if (!nodes) {
        nodes = new Map();
        const stack = [currentRoot];
        let count = 0;
        while (stack.length && count++ < 20000) {
          const node = stack.pop();
          if (node.stateNode instanceof HTMLElement) nodes.set(node.stateNode, node);
          if (node.sibling) stack.push(node.sibling);
          if (node.child) stack.push(node.child);
        }
        committedTrees.set(currentRoot, nodes);
      }
      fiber = nodes.get(card);
    }
    for (; fiber; fiber = fiber.return) {
      const route = fiber.memoizedProps?.route?.raw;
      if (route) return route;
      if (fiber.stateNode instanceof HTMLElement && fiber.stateNode !== card) break;
    }
    return null;
  }

  const tollFormatWarnings = new WeakMap();
  function routeChips(route) {
    const chips = [];
    if (!route) return chips;
    let number;
    try {
      number = new Intl.NumberFormat(normalizeLocale(locale));
    } catch {
      number = new Intl.NumberFormat('en');
    }
    const price = route.tollPriceInfo;
    if (
      route.isToll === true &&
      typeof price?.tollPrice === 'number' &&
      Number.isFinite(price.tollPrice) &&
      price.tollPrice >= 0 &&
      typeof price.tollPriceCurrencyCode === 'string' &&
      /^[A-Z]{3}$/.test(price.tollPriceCurrencyCode)
    ) {
      try {
        const formatted = new Intl.NumberFormat(number.resolvedOptions().locale, {
          style: 'currency',
          currency: price.tollPriceCurrencyCode,
          currencyDisplay: 'symbol',
        }).format(price.tollPrice);
        tollFormatWarnings.delete(route);
        chips.push(['', `${t('tolls')}: ${formatted}`]);
      } catch (error) {
        const signature = JSON.stringify([locale, price.tollPrice, price.tollPriceCurrencyCode]);
        if (tollFormatWarnings.get(route) !== signature) {
          tollFormatWarnings.set(route, signature);
          console.warn('[Waze Live Map Route Toolkit] Cannot format toll price', error);
        }
      }
    }
    const attributes = route.routeAttr;
    for (const [attribute, key] of [
      ['FERRY', 'ferries'],
      ['UNPAVED', 'unpaved'],
    ]) {
      if (
        (Array.isArray(attributes) && attributes.includes(attribute)) ||
        (attributes instanceof Set && attributes.has(attribute))
      ) {
        chips.push(['', t(key)]);
      }
    }
    if (Array.isArray(route.jams) && route.jams.length) {
      const jams = [
        ...new Map(
          route.jams
            .filter((jam) => jam && typeof jam === 'object')
            .map((jam) => [jam.id ?? jam, jam])
        ).values(),
      ];
      const levels = ['moderate', 'heavy', 'bumperToBumper'];
      // Observed user-drive statuses; do not extrapolate other severity values.
      // Other severities remain generic; no road closure is inferred.
      const counts = new Map();
      for (const jam of jams) {
        const level = Number.isInteger(jam.severity) ? levels[jam.severity] : undefined;
        const key = level || 'unknown';
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const level of [...levels, 'unknown']) {
        const count = counts.get(level);
        if (!count) continue;
        const label = level === 'unknown' ? t('traffic') : t(`trafficLevels.${level}`);
        chips.push([`wlmrt-traffic wlmrt-traffic--${level}`, `${label} ×${number.format(count)}`]);
      }
    }
    return chips;
  }

  function mountAverageSpeed(footer, route) {
    const previous = footer.querySelector('.wlmrt-average-speed');
    if (
      !route ||
      !Number.isFinite(route.meters) ||
      route.meters < 0 ||
      !Number.isFinite(route.seconds) ||
      route.seconds <= 0
    ) {
      previous?.remove();
      return;
    }
    const speed = (route.meters / route.seconds) * (route.isImperial ? 3600 / 1609.344 : 3.6);
    if (!Number.isFinite(speed)) {
      previous?.remove();
      return;
    }
    let formatter;
    try {
      formatter = new Intl.NumberFormat(normalizeLocale(locale), { maximumFractionDigits: 1 });
    } catch {
      formatter = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
    }
    const text = `${t('averageSpeed')}: ${formatter.format(speed)} ${route.isImperial ? 'mph' : 'km/h'}`;
    if (previous?.textContent === text && footer.lastChild === previous) return;
    const node = previous || document.createElement('span');
    node.className = 'wlmrt-average-speed';
    if (node.textContent !== text) node.textContent = text;
    footer.append(node);
  }

  function mountRouteChips() {
    // Share each committed root lookup across cards, only for this mount.
    const committedTrees = new Map();
    for (const card of document.querySelectorAll('.wm-routes-item-desktop')) {
      const details = card.querySelector('.wm-routes-item-desktop__details');
      const footer = details?.querySelector('.wm-routes-item-desktop__footer');
      const previous = details?.querySelector('.wlmrt-route-badges');
      const route = cardRoute(card, committedTrees);
      if (footer) mountAverageSpeed(footer, route);
      const chips = routeChips(route);
      if (!footer || !chips.length) {
        previous?.remove();
        continue;
      }
      const signature = JSON.stringify(chips);
      if (previous?.dataset.signature === signature && footer.nextElementSibling === previous)
        continue;
      const list = document.createElement('ul');
      list.className = 'wm-routing-badges wlmrt-route-badges';
      list.dataset.signature = signature;
      for (const [kind, text] of chips) {
        const chip = document.createElement('li');
        chip.className = ['wm-routing-badges__item', kind].filter(Boolean).join(' ');
        if (kind.startsWith('wlmrt-traffic ')) {
          const dot = document.createElement('span');
          dot.className = 'wlmrt-traffic-dot';
          dot.setAttribute('aria-hidden', 'true');
          chip.append(dot);
        }
        chip.append(document.createTextNode(text));
        list.append(chip);
      }
      previous?.remove();
      footer.after(list);
    }
  }

  let tooltipRuntime = null;
  let wazeRequire = null;
  let tooltipModuleCount = -1;
  let tooltipModules = null;
  let tooltipWarning = false;

  function nativeTooltipRuntime() {
    if (tooltipRuntime) return tooltipRuntime;
    let Tooltip = null;
    // Map controls exist even when no route is selected.
    const anchors = document.querySelectorAll(
      '[data-hook="SAVE_TO_APP_BUTTON"], .wz-map-control-container .wz-control-button'
    );
    for (const anchor of anchors) {
      const fiberKey = Object.keys(anchor).find((key) => key.startsWith('__reactFiber$'));
      let fiber = fiberKey && anchor[fiberKey];
      for (let depth = 0; fiber && depth < 30; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        const child = props?.children?.props;
        if (
          typeof fiber.type === 'function' &&
          typeof props?.text === 'string' &&
          ((child?.['data-hook'] === 'SAVE_TO_APP_BUTTON' && props.placement === 'top') ||
            (child?.className?.split(' ').includes('wz-control-button') &&
              props.placement === 'left'))
        ) {
          Tooltip = fiber.type;
          break;
        }
      }
      if (Tooltip) break;
    }
    if (!Tooltip) return null;
    try {
      // Capture Waze's existing webpack runtime; do not load another React copy.
      if (!wazeRequire) {
        const chunks = window.webpackChunklivemap;
        if (!Array.isArray(chunks)) return null;
        const token = `wlmrt-tooltip-${Date.now()}`;
        chunks.push([
          [token],
          {},
          (require) => {
            wazeRequire = require;
          },
        ]);
      }
      if (!wazeRequire?.m) return null;
      const factories = Object.entries(wazeRequire.m);
      if (tooltipModuleCount !== factories.length) {
        tooltipModuleCount = factories.length;
        tooltipModules = null;
        let React = null;
        let renderer = null;
        for (const [id, factory] of factories) {
          const source = Function.prototype.toString.call(factory);
          // Inspect only factories advertising the required APIs, then validate.
          if (!React && /\.createElement\s*=/.test(source) && /\.useState\s*=/.test(source)) {
            const candidate = wazeRequire(id);
            if (
              typeof candidate.createElement === 'function' &&
              typeof candidate.useState === 'function'
            )
              React = candidate;
          }
          if (!renderer && /\.createRoot\s*=/.test(source) && /\.hydrateRoot\s*=/.test(source)) {
            const candidate = wazeRequire(id);
            if (typeof candidate.createRoot === 'function') renderer = candidate;
          }
          if (React && renderer) break;
        }
        if (React && renderer) tooltipModules = { React, createRoot: renderer.createRoot };
      }
      if (tooltipModules) tooltipRuntime = { ...tooltipModules, Tooltip };
    } catch (error) {
      if (!tooltipWarning) {
        tooltipWarning = true;
        console.warn('[Waze Live Map Route Toolkit] Cannot access Waze tooltip', error);
      }
    }
    return tooltipRuntime;
  }

  function unmountRefresh() {
    if (!refreshControl) return;
    refreshControl.root.unmount();
    refreshControl.host.remove();
    refreshControl = null;
  }

  function mountRefresh() {
    const title = document.querySelector(
      '.wm-routes__header.wm-routing__reducer .wm-routes__title'
    );
    if (!title) {
      unmountRefresh();
      return;
    }
    const runtime = nativeTooltipRuntime();
    if (!runtime) return;
    if (!refreshControl) {
      const host = document.createElement('div');
      host.id = `${REFRESH_ID}-host`;
      const root = runtime.createRoot(host);
      // Forward keyboard focus/Escape to the native hover trigger as well.
      const hover = (enter) => {
        host.firstElementChild?.dispatchEvent(
          new MouseEvent(enter ? 'mouseover' : 'mouseout', {
            bubbles: true,
            relatedTarget: enter ? null : document.body,
          })
        );
      };
      host.addEventListener('focusin', () => hover(true));
      host.addEventListener('focusout', () => hover(false));
      host.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hover(false);
      });
      refreshControl = { host, root, signature: null };
    }
    const { host, root } = refreshControl;
    if (title.nextElementSibling !== host) title.after(host);
    const label = t('refreshRoute');
    const bridge = routeBridge();
    const busy = Boolean(activeRequest) || Boolean(bridge?.routing.locked);
    const disabled = busy || !bridge;
    const signature = JSON.stringify([label, busy, disabled]);
    if (refreshControl.signature === signature) return;
    refreshControl.signature = signature;
    const { React, Tooltip } = runtime;
    const button = React.createElement(
      'wz-button',
      {
        id: REFRESH_ID,
        type: 'button',
        color: 'secondary',
        size: 'sm',
        disabled,
        'aria-label': label,
        'aria-busy': String(busy),
        onClick: () => {
          if (!disabled && !activeRequest) updateRoute(() => {}, true);
        },
      },
      React.createElement(busy ? 'span' : 'i', {
        className: busy ? 'wz-spinner' : 'w-icon w-icon-refresh',
        'aria-hidden': 'true',
      })
    );
    // Removing the native tooltip while busy also cleans up its portal/observers.
    root.render(
      disabled
        ? button
        : React.createElement(Tooltip, { text: label, placement: 'top', delayMs: 400 }, button)
    );
  }

  let mapControl = null;

  function mapBridge(anchor) {
    const key = Object.keys(anchor).find((name) => name.startsWith('__reactFiber$'));
    let fiber = key && anchor[key];
    if (!fiber) return null;
    let root = fiber;
    while (root.return) root = root.return;
    if (root.stateNode?.current) {
      const stack = [root.stateNode.current];
      fiber = null;
      for (let count = 0; stack.length && count < 20000; count++) {
        const node = stack.pop();
        if (node.stateNode === anchor) {
          fiber = node;
          break;
        }
        if (node.sibling) stack.push(node.sibling);
        if (node.child) stack.push(node.child);
      }
    }
    const isMap = (value) =>
      value &&
      typeof value.getOLMap === 'function' &&
      typeof value.getLayerByName === 'function' &&
      typeof value.getZoom === 'function' &&
      Number.isFinite(value.maxZoomLevel);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      if (isMap(fiber.memoizedProps?.value)) return fiber.memoizedProps.value;
      for (let context = fiber.dependencies?.firstContext; context; context = context.next) {
        if (isMap(context.memoizedValue)) return context.memoizedValue;
      }
    }
    return null;
  }

  function findMapFiber(state, match) {
    const key = Object.keys(state.recenter).find((name) => name.startsWith('__reactFiber$'));
    let root = key && state.recenter[key];
    if (!root) return null;
    while (root.return) root = root.return;
    const stack = [root.stateNode?.current || root];
    for (let count = 0; stack.length && count < 20000; count++) {
      const node = stack.pop();
      const result = match(node);
      if (result) return result;
      if (node.sibling) stack.push(node.sibling);
      if (node.child) stack.push(node.child);
    }
    return null;
  }

  function geoRssBridge(state) {
    return findMapFiber(state, (node) => {
      if (typeof node.type !== 'function') return null;
      const source = Function.prototype.toString.call(node.type);
      if (!source.includes('fetchGeoRssData') || !source.includes('Error rendering closures'))
        return null;
      let sequenceRef = null;
      for (let hook = node.memoizedState; hook; hook = hook.next) {
        if (!sequenceRef && Number.isFinite(hook.memoizedState?.current))
          sequenceRef = hook.memoizedState;
        const callback = Array.isArray(hook.memoizedState) && hook.memoizedState[0];
        // Waze uses Underscore debounce: cancel() exists, flush() does not.
        if (
          typeof callback !== 'function' ||
          typeof callback.cancel !== 'function' ||
          !state.map.mapEventHandlers?.has(callback)
        )
          continue;
        let closePopup = null;
        const last = node.updateQueue?.lastEffect;
        let effect = last?.next;
        const seen = new Set();
        while (effect && !seen.has(effect)) {
          seen.add(effect);
          if (
            effect.deps?.[0] === state.map &&
            effect.deps?.[1] === callback &&
            typeof effect.deps[2] === 'function'
          )
            closePopup = effect.deps[2];
          effect = effect.next;
        }
        return { refresh: callback, closePopup, sequenceRef };
      }
      return null;
    });
  }

  let mapHttpClient = null;
  function nativeMapHttpClient() {
    if (mapHttpClient) return mapHttpClient;
    for (const [id, factory] of Object.entries(wazeRequire?.m || {})) {
      const source = Function.prototype.toString.call(factory);
      if (!/\.AxiosHeaders\s*=/.test(source) || !/\.isAxiosError\s*=/.test(source)) continue;
      const exports = wazeRequire(id);
      const client = exports.default || exports;
      if (
        typeof client.get === 'function' &&
        client.interceptors?.request?.use &&
        client.interceptors?.request?.eject &&
        client.interceptors?.response?.use &&
        client.interceptors?.response?.eject
      )
        return (mapHttpClient = client);
    }
    return null;
  }

  async function refreshMapData(state, run) {
    const bridge = geoRssBridge(state);
    if (!bridge) throw new Error('Waze GeoRSS refresh is unavailable');
    const client = nativeMapHttpClient();
    if (!client) throw new Error('Waze GeoRSS request tracking is unavailable');
    const controller = new AbortController();
    const { promise: responseReady, resolve: complete } = Promise.withResolvers();
    const nonce = `${Date.now()}-${run.id}`;
    let request = null;
    let sequence;
    const cancel = () => {
      controller.abort();
      complete({ cancelled: true });
    };
    run.controller.signal.addEventListener('abort', cancel, { once: true });
    // Moving the viewport supersedes this manual refresh. Leave Waze's next
    // debounced background load untouched instead of borrowing that request.
    state.ol.events.register('movestart', run, cancel);
    const owns = (config) => config && (config === request || config.params?._wlmrt === nonce);
    // Keep tracking until Waze's native debounce actually starts its request.
    const requestId = client.interceptors.request.use((config) => {
      if (
        controller.signal.aborted ||
        new URL(config.url, location.href).pathname !== '/live-map/api/georss' ||
        request
      )
        return config;
      request = config;
      sequence = bridge.sequenceRef?.current;
      config.params = { ...config.params, _wlmrt: nonce };
      if (!config.timeout) config.timeout = 15000;
      config.signal =
        config.signal && typeof AbortSignal.any === 'function'
          ? AbortSignal.any([config.signal, controller.signal])
          : config.signal || controller.signal;
      // Axios already captured the current chain; subsequent calls stay native.
      client.interceptors.request.eject(requestId);
      return config;
    });
    const responseId = client.interceptors.response.use(
      (value) => {
        if (owns(value.config)) complete({ response: value });
        return value;
      },
      (error) => {
        if (owns(error.config)) complete({ error });
        return Promise.reject(error);
      }
    );
    const deadline = setTimeout(
      () => complete({ error: new Error('Waze GeoRSS refresh timed out') }),
      20000
    );
    const lowZoom =
      state.map.getZoom() < 10
        ? setTimeout(() => {
            if (!request) complete({ skipped: true });
          }, 1000)
        : null;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearTimeout(deadline);
      clearTimeout(lowZoom);
      run.controller.signal.removeEventListener('abort', cancel);
      state.ol.events.unregister('movestart', run, cancel);
      client.interceptors.request.eject(requestId);
      client.interceptors.response.eject(responseId);
      controller.abort();
    };
    run.cleanups.add(cleanup);
    try {
      bridge.refresh();
      const outcome = await responseReady;
      if (outcome.cancelled || run.controller.signal.aborted || mapControl !== state)
        return 'cancelled';
      if (outcome.error) throw outcome.error;
      if (outcome.skipped) return 'skipped';
      // The HTTP interceptor runs before Waze parses and renders the response.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (controller.signal.aborted || mapControl !== state) return 'cancelled';
      if (bridge.sequenceRef && sequence !== bridge.sequenceRef.current) return 'cancelled';
      const { response } = outcome;
      if (
        !response ||
        response.status < 200 ||
        response.status >= 300 ||
        !response.data ||
        typeof response.data !== 'object' ||
        Array.isArray(response.data)
      ) {
        throw new Error('Waze GeoRSS did not return map data');
      }
      // Popups contain snapshots. Close the old popup instead of showing stale details.
      bridge.closePopup?.();
      return 'ok';
    } finally {
      cleanup();
      run.cleanups.delete(cleanup);
    }
  }

  function sameRoute(a, b) {
    return (
      Array.isArray(a?.latLngs) &&
      a.latLngs.length > 0 &&
      a.latLngs.length === b?.latLngs?.length &&
      a.latLngs.every((point, index) => samePoint(point, b.latLngs[index]))
    );
  }

  async function refreshMapRoute(state, run) {
    const before = routeBridge()?.routing;
    if (!before || !hasDirections() || clearingRoute)
      throw new Error('Waze route refresh is unavailable');
    const selected = before.highlightedRoute;
    const originalFit = state.map.zoomToExtent;
    const ownFit = Object.getOwnPropertyDescriptor(state.map, 'zoomToExtent');
    const sameDirections = (routing) =>
      samePoint(before.from.latLng, routing?.from?.latLng) &&
      samePoint(before.to.latLng, routing?.to?.latLng) &&
      before.at === routing.at &&
      before.reverse === routing.reverse;
    // Suppress only fitting the refreshed route bounds, not arbitrary place/cluster fits.
    const fit = function (bounds, ...args) {
      const routing = routeBridge()?.routing;
      if (sameDirections(routing) && Array.isArray(bounds) && bounds.length === 4) {
        const points = [
          routing.from.latLng,
          routing.to.latLng,
          ...(routing.routes || []).flatMap((route) => route.latLngs || []),
        ];
        let minLat = Infinity,
          maxLat = -Infinity,
          minLng = Infinity,
          maxLng = -Infinity;
        for (const point of points) {
          minLat = Math.min(minLat, point.lat);
          maxLat = Math.max(maxLat, point.lat);
          minLng = Math.min(minLng, point.lng);
          maxLng = Math.max(maxLng, point.lng);
        }
        if (
          Math.abs(bounds[1] - minLat) < 1e-9 &&
          Math.abs(bounds[3] - maxLat) < 1e-9 &&
          bounds[0] <= minLng &&
          bounds[2] >= maxLng
        )
          return;
      }
      return originalFit.apply(this, [bounds, ...args]);
    };
    if (typeof originalFit === 'function') state.map.zoomToExtent = fit;
    const restoreFit = () => {
      if (state.map.zoomToExtent === fit) {
        if (ownFit) Object.defineProperty(state.map, 'zoomToExtent', ownFit);
        else delete state.map.zoomToExtent;
      }
    };
    run.cleanups.add(restoreFit);
    try {
      const result = await updateRoute(() => {}, true);
      const current = routeBridge()?.routing;
      if (
        run.controller.signal.aborted ||
        mapControl !== state ||
        result === null ||
        !sameDirections(current)
      )
        return 'cancelled';
      if (!result) throw new Error('Waze could not refresh the route');
      const match = current.routes?.find((route) => sameRoute(selected, route));
      if (
        match &&
        current.highlightedRoute === current.routes[0] &&
        match !== current.highlightedRoute
      ) {
        const store = findMapFiber(state, (node) => {
          const candidates = [node.memoizedProps?.value];
          for (let context = node.dependencies?.firstContext; context; context = context.next)
            candidates.push(context.memoizedValue);
          return candidates.find(
            (value) => value?.state?.routing === current && typeof value.dispatch === 'function'
          );
        });
        if (!store) throw new Error('Waze route selection could not be restored');
        store.dispatch({ type: 'HIGHLIGHT', payload: match });
      }
      // Let native route-layer passive effects run while the fit guard is installed.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return 'ok';
    } finally {
      restoreFit();
      run.cleanups.delete(restoreFit);
    }
  }

  async function refreshMap(state) {
    if (
      mapControl !== state ||
      state.busy ||
      activeRequest ||
      clearingRoute ||
      routeBridge()?.routing.locked
    )
      return;
    const run = { id: ++state.sequence, controller: new AbortController(), cleanups: new Set() };
    state.run = run;
    state.busy = true;
    state.tileFailed = false;
    state.parts = {
      tiles: 'pending',
      data: 'pending',
      ...(hasDirections() && { route: 'pending' }),
    };
    renderMapRefresh(state);
    const execute = async (part, action) => {
      try {
        const result = await action();
        if (state.run === run) state.parts[part] = result || 'ok';
      } catch (error) {
        if (state.run === run)
          state.parts[part] = run.controller.signal.aborted ? 'cancelled' : 'error';
        if (!run.controller.signal.aborted)
          console.warn(`[Waze Live Map Route Toolkit] Cannot refresh ${part}`, error);
      }
    };
    const jobs = [
      execute(
        'tiles',
        () =>
          new Promise((resolve, reject) => {
            state.finish = (error = false) => {
              clearTimeout(state.timer);
              state.timer = null;
              state.finish = null;
              if (error === true) reject(new Error('Map tiles could not be reloaded'));
              else resolve('ok');
            };
            run.cleanups.add(() => state.finish?.(true));
            state.timer = setTimeout(() => state.finish?.(true), 15000);
            try {
              if (!state.layer.redraw(true)) state.finish?.(true);
            } catch (error) {
              state.finish?.(true);
            }
          })
      ),
      execute('data', () => refreshMapData(state, run)),
    ];
    if (state.parts.route) jobs.push(execute('route', () => refreshMapRoute(state, run)));
    await Promise.allSettled(jobs);
    for (const cleanup of run.cleanups) cleanup();
    if (mapControl !== state || state.run !== run) return;
    state.run = null;
    state.busy = false;
    renderMapRefresh(state);
  }

  function unmountMapControls() {
    const state = mapControl;
    if (!state) return;
    mapControl = null;
    state.run?.controller.abort();
    for (const cleanup of state.run?.cleanups || []) cleanup();
    clearTimeout(state.timer);
    state.ol.events.unregister('zoomend', state, state.updateZoom);
    state.layer.events.unregister('loadend', state, state.onTilesLoaded);
    state.layer.events.unregister('tileerror', state, state.onTileError);
    state.root.unmount();
    state.valueRoot.unmount();
    state.resizeObserver?.disconnect();
    if (state.desktopControls) {
      state.desktopControls.removeAttribute('data-wlmrt-map-controls');
      state.desktopControls.style.removeProperty('--wlmrt-controls-bottom');
      state.desktopControls.style.removeProperty('--wlmrt-zoom-extra-height');
    }
    state.host.remove();
    state.value.remove();
    // Restore only our own configuration, without overwriting another extension.
    if (state.layer.resolutions === state.resolutions) {
      if (state.ol.div?.isConnected && state.map.getZoom() > state.original.maxZoomLevel) {
        state.ol.setCenter(null, state.original.maxZoomLevel);
      }
      Object.assign(state.layer, state.original.layer);
    }
    if (state.map.maxZoomLevel === MAX_MAP_ZOOM) {
      state.map.maxZoomLevel = state.original.maxZoomLevel;
    }
  }

  function renderMapRefresh(state) {
    if (mapControl !== state) return;
    const errors = Object.keys(state.parts || {}).filter((part) => state.parts[part] === 'error');
    const cancelled = Object.values(state.parts || {}).includes('cancelled');
    const base = t('refreshMap');
    const problem = errors.length
      ? `${t('refreshFailed')}: ${errors.map((part) => t(`refreshParts.${part}`)).join(', ')}. ${t('retry')}`
      : cancelled
        ? t('refreshCancelled')
        : '';
    // The tooltip and accessible name describe the action, never its last error.
    const label = base;
    const disabled =
      state.busy ||
      Boolean(activeRequest) ||
      clearingRoute ||
      Boolean(routeBridge()?.routing.locked);
    const signature = JSON.stringify([label, state.busy, disabled, problem]);
    if (state.signature === signature) return;
    state.signature = signature;
    const { React, Tooltip } = state.runtime;
    const button = React.createElement(
      Tooltip,
      { text: label, placement: 'left' },
      React.createElement(
        'button',
        {
          id: MAP_REFRESH_ID,
          type: 'button',
          className: 'wz-control-button',
          'aria-label': label,
          'aria-disabled': String(disabled),
          'aria-busy': String(state.busy),
          onClick: () => {
            if (!disabled) refreshMap(state);
          },
        },
        React.createElement(state.busy ? 'span' : 'i', {
          className: state.busy ? 'wz-spinner' : 'w-icon w-icon-refresh',
          'aria-hidden': 'true',
        })
      )
    );
    state.root.render(
      React.createElement(
        React.Fragment,
        null,
        button,
        React.createElement(
          'span',
          { id: `${MAP_REFRESH_ID}-status`, role: 'status' },
          state.busy ? '' : problem
        )
      )
    );
  }

  function mountMapControls() {
    // Waze replaces the recenter glyph with a spinner/off glyph while locating.
    // The geolocation action stays on the button in every state.
    const recenter = document.querySelector(
      '.wz-map-control-container button.wz-control-button[data-event-action="geolocation_request"]'
    );
    const zoomIn = document.querySelector('.wz-map-ol-zoom-in');
    const zoomOut = document.querySelector('.wz-map-ol-zoom-out');
    if (!recenter || !zoomIn || !zoomOut || zoomIn.parentElement !== zoomOut.parentElement) {
      unmountMapControls();
      return;
    }
    const map = mapBridge(recenter);
    const ol = map?.getOLMap();
    const layer = map?.getLayerByName('LIVEMAP_TILES');
    if (
      !map ||
      ol?.baseLayer !== layer ||
      !Array.isArray(layer?.resolutions) ||
      !layer.resolutions.length ||
      typeof layer.redraw !== 'function' ||
      !ol.events?.register ||
      !ol.events?.unregister ||
      !layer.events?.register ||
      !layer.events?.unregister
    ) {
      unmountMapControls();
      return;
    }
    if (
      mapControl &&
      (mapControl.map !== map ||
        mapControl.layer !== layer ||
        mapControl.zoomIn !== zoomIn ||
        mapControl.zoomOut !== zoomOut)
    )
      unmountMapControls();
    if (!mapControl) {
      const runtime = nativeTooltipRuntime();
      if (!runtime) return;
      const host = document.createElement('div');
      host.id = `${MAP_REFRESH_ID}-host`;
      host.className = 'wz-map-control-container';
      const value = document.createElement('output');
      value.id = ZOOM_VALUE_ID;
      // Let OpenLayers consume gestures here just like its native +/- controls.
      value.className = 'olButton';
      // Available on demand to assistive technology without announcing every gesture.
      value.setAttribute('aria-live', 'off');
      const state = {
        map,
        ol,
        layer,
        recenter,
        zoomIn,
        zoomOut,
        host,
        value,
        runtime,
        root: runtime.createRoot(host),
        valueRoot: runtime.createRoot(value),
        desktopControls: null,
        busy: false,
        timer: null,
        sequence: 0,
        run: null,
        parts: {},
        original: {
          maxZoomLevel: map.maxZoomLevel,
          layer: {
            resolutions: layer.resolutions,
            numZoomLevels: layer.numZoomLevels,
            minResolution: layer.minResolution,
          },
        },
      };
      mapControl = state;
      state.adjustPosition = () =>
        state.desktopControls?.style.setProperty(
          '--wlmrt-zoom-extra-height',
          `${Math.ceil(value.getBoundingClientRect().height) || 15}px`
        );
      if (typeof ResizeObserver === 'function') {
        state.resizeObserver = new ResizeObserver(state.adjustPosition);
        state.resizeObserver.observe(value);
      }
      // Preserve Waze's existing resolution progression and extend it to level 19.
      state.resolutions = layer.resolutions.slice();
      while (state.resolutions.length <= MAX_MAP_ZOOM) {
        state.resolutions.push(state.resolutions[state.resolutions.length - 1] / 2);
      }
      Object.assign(layer, {
        resolutions: state.resolutions,
        numZoomLevels: state.resolutions.length,
        minResolution: state.resolutions.at(-1),
      });
      map.maxZoomLevel = MAX_MAP_ZOOM;
      state.updateZoom = () => {
        const zoom = map.getZoom();
        if (!Number.isFinite(zoom)) return;
        const text = String(Math.round(zoom * 100) / 100);
        const label = `${t('zoomLevel')}: ${text}/${map.maxZoomLevel}`;
        if (state.zoomLabel !== label) {
          state.zoomLabel = label;
          value.setAttribute('aria-label', label);
          const { React, Tooltip } = runtime;
          state.valueRoot.render(
            React.createElement(
              Tooltip,
              { text: label, placement: 'left' },
              React.createElement('span', null, text)
            )
          );
        }
        // Waze refreshes these on zoomend; also sync after changing the ceiling.
        for (const [link, disabled] of [
          [zoomIn, zoom >= MAX_MAP_ZOOM || zoom >= layer.numZoomLevels - 1],
          [zoomOut, zoom <= map.minZoomLevel || zoom <= ol.getMinZoom()],
        ]) {
          link.setAttribute('aria-disabled', String(disabled));
          link.classList.toggle('wz-map-ol-zoom-link-disabled', disabled);
          if (disabled) link.setAttribute('tabindex', '-1');
          else link.removeAttribute('tabindex');
        }
      };
      state.onTilesLoaded = () =>
        queueMicrotask(() => {
          // redraw() can unload the old grid before starting the replacement grid.
          if (mapControl === state && !layer.loading && !(layer.numLoadingTiles > 0)) {
            state.finish?.(state.tileFailed === true);
          }
        });
      state.onTileError = () => {
        if (state.finish) state.tileFailed = true;
      };
      ol.events.register('zoomend', state, state.updateZoom);
      layer.events.register('loadend', state, state.onTilesLoaded);
      layer.events.register('tileerror', state, state.onTileError);
      const hover = (enter) =>
        host.firstElementChild?.dispatchEvent(
          new MouseEvent(enter ? 'mouseover' : 'mouseout', {
            bubbles: true,
            relatedTarget: enter ? null : document.body,
          })
        );
      host.addEventListener('focusin', () => hover(true));
      host.addEventListener('focusout', () => hover(false));
      host.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hover(false);
      });
    }
    const state = mapControl;
    // Reuse the roots/listeners when Waze replaces only its location control.
    state.recenter = recenter;
    const desktop = recenter.closest('.wz-desktop-controls');
    if (state.desktopControls !== desktop) {
      state.desktopControls?.removeAttribute('data-wlmrt-map-controls');
      state.desktopControls?.style.removeProperty('--wlmrt-controls-bottom');
      state.desktopControls?.style.removeProperty('--wlmrt-zoom-extra-height');
      state.desktopControls = desktop;
      if (desktop) {
        const bottom =
          desktop.style.getPropertyValue('--wlmrt-controls-bottom') ||
          getComputedStyle(desktop).bottom;
        desktop.style.setProperty(
          '--wlmrt-controls-bottom',
          bottom && bottom !== 'auto' ? bottom : '130px'
        );
        desktop.setAttribute('data-wlmrt-map-controls', '');
      }
    }
    // Waze nests the location button's container inside another control container.
    // Insert beside the outer control, directly under its native wrapper.
    let locationHost = recenter.closest('.wz-map-control-container');
    const wrapper = recenter.closest('.wz-custom-controls-wrapper');
    if (wrapper) {
      while (locationHost.parentElement !== wrapper) locationHost = locationHost.parentElement;
    }
    if (locationHost.previousElementSibling !== state.host) locationHost.before(state.host);
    if (zoomIn.nextElementSibling !== state.value) zoomIn.after(state.value);
    state.adjustPosition?.();
    state.updateZoom();
    renderMapRefresh(state);
  }

  function unmountVehicles() {
    if (!vehicleControl) return;
    vehicleControl.root?.unmount();
    vehicleControl.row.remove();
    vehicleControl = null;
  }

  function mountClear(title) {
    if (!title || !hasDirections()) {
      clearControl?.host.remove();
      clearControl = null;
      return;
    }
    if (!clearControl) {
      const host = document.createElement('div');
      host.id = `${CLEAR_ID}-host`;
      const button = document.createElement('button');
      button.id = CLEAR_ID;
      button.type = 'button';
      button.className = 'wz-sidebar-btn wz-icon w-icon-x w-icon';
      button.addEventListener('click', clearRoute);
      host.append(button);
      clearControl = { host, button };
    }
    const { host, button } = clearControl;
    if (host.parentElement !== title) title.append(host);
    button.setAttribute('aria-label', t('clearRoute'));
    button.setAttribute('aria-disabled', String(clearingRoute));
    button.setAttribute('aria-busy', String(clearingRoute));
  }

  function mountVehicles(title) {
    if (!vehicleControl) {
      const row = document.createElement('div');
      row.id = ID;
      row.setAttribute('role', 'group');
      row.addEventListener('mouseover', (event) => {
        const button = event.target.closest('wz-button[data-vehicle]');
        const shadow = button?.shadowRoot;
        if (!shadow || shadow.querySelector('[data-wlmrt-selected-hover]')) return;
        // Waze does not expose the hover layer as a CSS part or custom property.
        // Scope this override to our own buttons and retain keyboard/press feedback.
        const style = document.createElement('style');
        style.setAttribute('data-wlmrt-selected-hover', '');
        style.textContent = `
          :host([aria-pressed="true"]) .wz-button.primary:hover:not(:focus-visible):not(:active) .color-layer {
            background-color: transparent;
          }
        `;
        shadow.append(style);
      });
      const hover = (event, enter) => {
        const button = event.target.closest('wz-button');
        if (!vehicleControl?.root || !button || button.parentElement === row) return;
        button.parentElement.dispatchEvent(
          new MouseEvent(enter ? 'mouseover' : 'mouseout', {
            bubbles: true,
            relatedTarget: enter ? null : document.body,
          })
        );
      };
      row.addEventListener('focusin', (event) => hover(event, true));
      row.addEventListener('focusout', (event) => hover(event, false));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hover(event, false);
      });
      vehicleControl = { row, root: null, signature: null };
    }
    const { row } = vehicleControl;
    if (title.nextElementSibling !== row) title.after(row);
    row.setAttribute('aria-label', t('vehicleType'));
    const selected = selectedType();
    const runtime = nativeTooltipRuntime();
    const actions = vehicles.map((vehicle) => ({
      label: t(`vehicles.${vehicle.type}`),
      icon: vehicle.icon,
      props: {
        'data-vehicle': vehicle.type,
        'aria-pressed': String(vehicle.type === selected),
        disabled: vehicle.type === selected,
        color: vehicle.type === selected ? 'primary' : 'clear-icon',
      },
      onClick: () => {
        if (vehicle.type !== selectedType()) selectVehicle(vehicle.type);
      },
    }));
    const signature = JSON.stringify([
      selected,
      actions.map((action) => action.label),
      Boolean(runtime),
    ]);
    if (vehicleControl.signature === signature) return;
    vehicleControl.signature = signature;
    if (runtime) {
      if (!vehicleControl.root) {
        row.replaceChildren();
        vehicleControl.root = runtime.createRoot(row);
      }
      const { React, Tooltip } = runtime;
      vehicleControl.root.render(
        actions.map((action, index) =>
          React.createElement(
            Tooltip,
            { key: index, text: action.label, placement: 'top', delayMs: 400 },
            React.createElement(
              'wz-button',
              {
                type: 'button',
                size: 'sm',
                ...action.props,
                'aria-label': action.label,
                onClick: action.onClick,
              },
              React.createElement('i', {
                className: `w-icon w-icon-${action.icon}`,
                'aria-hidden': 'true',
              })
            )
          )
        )
      );
    } else {
      // Keep controls usable while Waze's tooltip runtime is still loading.
      row.replaceChildren(
        ...actions.map((action) => {
          const button = document.createElement('wz-button');
          for (const [name, value] of Object.entries({
            type: 'button',
            size: 'sm',
            ...action.props,
            'aria-label': action.label,
            title: action.label,
          })) {
            if (typeof value === 'boolean') button.toggleAttribute(name, value);
            else button.setAttribute(name, value);
          }
          const icon = document.createElement('i');
          icon.className = `w-icon w-icon-${action.icon}`;
          icon.setAttribute('aria-hidden', 'true');
          button.append(icon);
          button.addEventListener('click', action.onClick);
          return button;
        })
      );
    }
  }

  // Isolate script integration failures; Waze still owns requests and errors.
  const integrationWarnings = new Map();
  function runIntegration(name, action) {
    try {
      const result = action();
      integrationWarnings.delete(name);
      return result;
    } catch (error) {
      const signature = `${error?.name}: ${error?.message}`;
      if (integrationWarnings.get(name) !== signature) {
        integrationWarnings.set(name, signature);
        console.warn(`[Waze Live Map Route Toolkit] Cannot update ${name}`, error);
      }
    }
  }

  // Waze mounts and replaces its React panels after navigation and search.
  function mount(full = true) {
    runIntegration('translations', readTranslations);
    runIntegration('styles', addStyle);
    runIntegration('map controls', mountMapControls);
    const title = document.querySelector('.wm-routing__title');
    runIntegration('clear directions', () => mountClear(title));
    if (!title) {
      runIntegration('avoid options', unmountAvoids);
      runIntegration('route refresh', unmountRefresh);
      runIntegration('vehicles', unmountVehicles);
      return;
    }
    runIntegration('route refresh', mountRefresh);
    runIntegration('vehicles', () => mountVehicles(title));
    runIntegration('avoid options', mountAvoids);
    if (full) runIntegration('route details', mountRouteChips);
  }

  // State changes only need controls; DOM/navigation changes also refresh routes.
  // A full update always wins when several signals arrive before the next frame.
  let pending = false;
  let pendingFull = false;
  function scheduleMount(full = true) {
    pendingFull ||= full;
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const full = pendingFull;
      pendingFull = false;
      mount(full);
    });
  }

  const ownedUI = `#${ID}, #${AVOID_ID}, #${REFRESH_ID}-host, #${CLEAR_ID}-host, #${MAP_REFRESH_ID}-host, #${ZOOM_VALUE_ID}, #${STYLE_ID}, .wlmrt-avoid-menu, .wlmrt-route-badges, .wlmrt-average-speed`;
  const wazeUI =
    '.wm-cards, .wm-routing, .wm-routing__title, #search-suggestions, .wm-routes__header, .wm-routes-item-desktop, #i18n-strings, .wz-map-control-container, .wz-custom-controls-wrapper, .wz-map-ol-zoom-control';
  function affectsRouting(record) {
    const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
    if (record.type === 'attributes') return target?.matches('.wm-cards');
    // React roots, dropdown portals and badges manage their own contents.
    if (target?.closest(ownedUI)) return false;
    const added = [...record.addedNodes];
    const removed = [...record.removedNodes];
    if (
      !removed.length &&
      added.length &&
      added.every((node) => node.nodeType === 1 && node.matches(ownedUI))
    )
      return false;
    if (target?.closest(wazeUI)) return true;
    // Observe the document for replacement panels, without scanning route data
    // for unrelated map markers, tooltips or other page mutations.
    return [...added, ...removed].some(
      (node) => node.nodeType === 1 && (node.matches(wazeUI) || node.querySelector(wazeUI))
    );
  }
  const observer = new MutationObserver((records) => {
    if (records.some(affectsRouting)) scheduleMount();
  });
  observer.observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  });
  window.addEventListener('popstate', () => scheduleMount());
  window.addEventListener('pageshow', () => scheduleMount());
  customElements.whenDefined('wz-checkbox').then(() => scheduleMount());
  scheduleMount();
})();
