// Contract double for Waze's debounced GeoRSS layer and Axios interceptor lifecycle.
// Native rendering catches request errors; the userscript must observe the HTTP outcome.
module.exports = function installMapDataRuntime(window, { autoComplete = true } = {}) {
  function interceptors() {
    const handlers = new Map();
    let sequence = 0;
    return { handlers,
      use(fulfilled, rejected) { const id = ++sequence; handlers.set(id, { fulfilled, rejected }); return id; },
      eject(id) { handlers.delete(id); },
    };
  }
  const requests = [];
  const http = {
    interceptors: { request: interceptors(), response: interceptors() },
    get(url, options) {
      const requestHandlers = [...this.interceptors.request.handlers.values()].reverse();
      const responseHandlers = [...this.interceptors.response.handlers.values()];
      let pending = Promise.resolve({ ...options, url });
      for (const handler of requestHandlers) pending = pending.then(handler.fulfilled, handler.rejected);
      pending = pending.then((config) => new Promise((resolve, reject) => {
        const request = { config,
          complete(data = { alerts: [], jams: [], users: [] }) { resolve({ status: 200, data, config }); },
          fail() { const error = new Error('GeoRSS HTTP failure'); error.config = config; reject(error); },
        };
        if (config.signal?.aborted) {
          const error = new Error('GeoRSS aborted'); error.config = config; reject(error); return;
        }
        config.signal?.addEventListener('abort', () => {
          const error = new Error('GeoRSS aborted'); error.config = config; reject(error);
        }, { once: true });
        requests.push(request);
        if (autoComplete) request.complete();
      }));
      for (const handler of responseHandlers) pending = pending.then(handler.fulfilled, handler.rejected);
      return pending;
    },
  };
  const sequenceRef = { current: 0 };
  let queued = false, rendered = 0, closed = 0, pending = null, scheduleError = null;
  const refresh = () => {
    if (scheduleError) throw scheduleError;
    queued = true;
    // Like Underscore debounce, scheduling does not expose a flush() method or
    // return the new request promise. The request starts after this call returns.
    queueMicrotask(() => {
      if (!queued) return;
      queued = false;
      const sequence = ++sequenceRef.current;
      pending = http.get('/live-map/api/georss', { params: { top: 2, bottom: 1, left: 3, right: 4, types: 'alerts,traffic,users' } })
        .then(() => { if (sequence === sequenceRef.current) rendered++; })
        .catch(() => {});
    });
  };
  refresh.cancel = () => { queued = false; };
  function GeoRSSLayer() {
    // Public-bundle signatures used for locating this otherwise DOM-less component.
    return 'fetchGeoRssData; Error rendering closures';
  }
  const fiber = {
    type: GeoRSSLayer,
    memoizedState: { memoizedState: sequenceRef, next: { memoizedState: [refresh, []] } },
  };
  function attach(map, root) {
    map.mapEventHandlers = new Map([[refresh, () => refresh()]]);
    const effect = { deps: [map, refresh, () => { closed++; }, () => {}] };
    effect.next = effect;
    fiber.updateQueue = { lastEffect: effect };
    root.child = fiber;
    return fiber;
  }
  return { http, requests, attach, fiber, refresh, sequenceRef,
    rendered: () => rendered, closed: () => closed, pending: () => pending,
    setScheduleError: (error) => { scheduleError = error; } };
};
