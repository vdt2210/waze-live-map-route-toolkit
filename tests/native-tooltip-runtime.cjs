// Runtime contract double; React rendering and portal cleanup use real React.
const React = require('react');
const { createRoot, hydrateRoot } = require('react-dom/client');
const { createPortal } = require('react-dom');

module.exports = function installNativeTooltip(window) {
  global.window = window;
  global.document = window.document;
  const renders = [];
  let unmounts = 0;
  function NativeTooltip({ text, placement, delayMs, children }) {
    const [open, setOpen] = React.useState(false);
    renders.push({ text, placement, delayMs });
    React.useEffect(() => () => { unmounts++; }, []);
    return React.createElement('div', {
      onMouseEnter: () => setOpen(true),
      onMouseLeave: () => setOpen(false),
    }, children, open && createPortal(
      React.createElement('div', { className: 'waze-tooltip' }, text),
      window.document.body
    ));
  }
  const save = window.document.querySelector('[data-hook="SAVE_TO_APP_BUTTON"]');
  save.__reactFiber$test = { return: {
    type: NativeTooltip,
    memoizedProps: { text: 'Save', placement: 'top', children: { props: { 'data-hook': 'SAVE_TO_APP_BUTTON' } } },
  } };
  const factories = {
    // Arbitrary IDs ensure discovery does not depend on production module IDs.
    react_test(module) {
      module.exports.createElement = React.createElement;
      module.exports.useState = React.useState;
    },
    renderer_test(module) {
      module.exports.createRoot = createRoot;
      module.exports.hydrateRoot = hydrateRoot;
    },
    unrelated() { throw new Error('unrelated factories must not execute'); },
  };
  const cache = {};
  const requireModule = (id) => {
    if (!cache[id]) {
      cache[id] = { exports: {} };
      factories[id](cache[id]);
    }
    return cache[id].exports;
  };
  requireModule.m = factories;
  window.webpackChunklivemap = [];
  window.webpackChunklivemap.push = function (chunk) {
    chunk[2](requireModule);
    return Array.prototype.push.call(this, chunk);
  };
  return { renders, unmounts: () => unmounts };
};
