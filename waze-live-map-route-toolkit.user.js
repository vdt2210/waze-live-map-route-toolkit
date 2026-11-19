// ==UserScript==
// @name           Waze Live Map Route Toolkit
// @namespace      https://greasyfork.org/en/users/1603731-vdt2210
// @version        1.1.0
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
      avoid: 'Avoid',
      tolls: 'Tolls',
      ferries: 'Ferries',
      freeways: 'Freeways',
      difficult: 'Difficult turns',
      unpaved: 'Unpaved roads',
      allow: 'Allow',
      avoid_long: 'Avoid long ones',
      avoid_all: "Don't allow",
    },
    vi: {
      vehicles: { PRIVATE: 'Ô tô', MOTORCYCLE: 'Xe máy', TAXI: 'Taxi' },
      vehicleType: 'Chọn phương tiện',
      avoid: 'Tránh',
      tolls: 'Thu phí',
      ferries: 'Phà',
      freeways: 'Cao tốc',
      difficult: 'Rẽ khó',
      unpaved: 'Đường chưa trải nhựa',
      allow: 'Cho phép',
      avoid_long: 'Tránh đoạn dài',
      avoid_all: 'Không cho phép',
    },
  };
  const ID = 'waze-vehicle-icons';
  const AVOID_ID = 'waze-route-avoids';
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

  async function updateRoute(change) {
    const url = new URL(location.href);
    const oldURL = url.href;
    change(url);
    if (url.href === oldURL && !failed) return;
    const requestId = ++requestSequence;
    // Keep our own reference: React may replace the effect between rapid clicks.
    const previousCancel = activeRequest?.cancel;
    activeRequest = null;
    if (typeof previousCancel === 'function') previousCancel();
    const bridge = routeBridge();
    const hasRoute = url.searchParams.has('from') && url.searchParams.has('to');
    if (hasRoute && !bridge) {
      failed = true;
      mount();
      return;
    }
    failed = false;
    let started = false;
    try {
      history.replaceState(history.state, '', url.href);
      if (!bridge) {
        mount();
        return;
      }
      mount();
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
      // Let Waze own the network timeout. A slow request is not a script error.
      while (requestId === requestSequence) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        // Superseded requests must not mark a newer request failed.
        if (requestId !== requestSequence) return;
        const current = routeBridge()?.routing;
        // Waze cleans up its request when the panel unmounts or endpoints change.
        if (
          !current ||
          !samePoint(current.from?.latLng, bridge.routing.from?.latLng) ||
          !samePoint(current.to?.latLng, bridge.routing.to?.latLng)
        )
          return;
        if (current.error) throw new Error('Waze could not calculate this route');
        if (!current.locked && Array.isArray(current.routes) && current.routes !== before) {
          return;
        }
      }
    } catch (error) {
      if (requestId !== requestSequence) return;
      failed = true;
      // Keep the chosen URL on request errors so clicking the same icon retries.
      if (!started) history.replaceState(history.state, '', oldURL);
      console.warn('[Waze Live Map Route Toolkit]', error);
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
        gap: 12px; padding: 0 20px 16px; flex: 0 0 auto;
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
      #${AVOID_ID} {
        box-sizing: border-box; width: 100%; padding: 0 20px 16px;
        color: var(--content_default, #202124); background: #fff;
        font-family: inherit; font-size: 14px; line-height: 24px;
      }
      #${AVOID_ID} fieldset { border: 0; padding: 0; margin: 0; min-width: 0; }
      #${AVOID_ID} summary { cursor: pointer; }
      #${AVOID_ID}[open] summary { margin-bottom: 8px; }
      #${AVOID_ID} .wvi-avoid-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; margin-bottom: 8px; }
      #${AVOID_ID} label { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
      #${AVOID_ID} wz-checkbox { --wz-checkbox-margin: 8px; min-width: 0; }
      #${AVOID_ID} .wvi-unpaved { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      #${AVOID_ID} button { font: inherit; color: var(--primary, #0099ff); background: transparent; border: 0; padding: 8px 0 0; cursor: pointer; }
      #${AVOID_ID} .wvi-unpaved .wz-react-dropdown__head { padding: 0; color: var(--content_default, #202124); font: inherit; text-align: start; }
      #${AVOID_ID} .wz-react-dropdown__head:focus-visible { outline: 2px solid var(--primary, #0099ff); outline-offset: 3px; border-radius: 3px; }
      .wvi-avoid-menu { box-sizing: border-box; max-width: calc(100vw - 16px); color: var(--content_default, #202124); }
      .wvi-avoid-menu .wz-react-dropdown__list { min-width: min(240px, calc(100vw - 16px)); font-size: inherit; }
      .wvi-avoid-menu .wz-react-dropdown__option { font-size: inherit; outline: none; }
      .wvi-avoid-menu .wz-react-dropdown__option:focus { background-color: rgba(0, 0, 0, .04); }
      #${AVOID_ID} [hidden] { display: none; }
      .wz-search-suggestions:not(:empty) ~ .wm-routing__scrollable #${AVOID_ID} { display: none; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function createUnpavedDropdown(labelId) {
    unpavedControl?.destroy();
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
    menu.className = 'wz-react-dropdown__list-container wvi-avoid-menu';
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
        : options.find((option) => option.dataset.value === head.dataset.value) || options[0]
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
      if (!menu.contains(event.target)) close();
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

  function mountAvoids() {
    const schedule = document.querySelector('.wm-routing-schedule.wm-routing__reducer');
    if (!schedule) return;
    if (!customElements.get('wz-checkbox')) return;
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
      grid.className = 'wvi-avoid-grid';
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
      label.className = 'wvi-unpaved';
      const text = document.createElement('span');
      text.dataset.i18n = 'unpaved';
      text.id = `${AVOID_ID}-unpaved-label`;
      unpavedControl = createUnpavedDropdown(text.id);
      label.append(text, unpavedControl.element);
      panel.append(label);
    }
    if (schedule.previousElementSibling !== panel) schedule.before(panel);
    if (
      panel
        .closest('.wm-routing__scrollable')
        ?.matches('.wz-search-suggestions:not(:empty) ~ .wm-routing__scrollable')
    ) {
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

  function mount() {
    // Wait for Waze to render its routing panel before attaching the controls.
    const title = document.querySelector('.wm-routing__title');
    if (!title) {
      unpavedControl?.close();
      return;
    }
    readTranslations();
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
    }
    if (title.nextElementSibling !== row) title.after(row);
    const selected = selectedType();
    for (const button of row.querySelectorAll('button')) {
      const pressed = String(button.dataset.vehicle === selected);
      if (button.getAttribute('aria-pressed') !== pressed)
        button.setAttribute('aria-pressed', pressed);
    }
    mountAvoids();
  }

  // Waze mounts and replaces its React panels after navigation and search.
  let pending = false;
  const observer = new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      mount();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('popstate', mount);
  window.addEventListener('pageshow', mount);
  customElements.whenDefined('wz-checkbox').then(mount);
  mount();
})();
