# Script tests

This folder currently contains the automated regression tests for [Waze Live Map Route Toolkit](../waze-live-map-route-toolkit.user.js). These files are for development and are not needed to install or use the userscript.

## Run the tests

Install Node.js, then run these commands from the **repository root**, not from this folder:

```sh
npm --prefix tests ci
npm --prefix tests test
```

The full suite checks script syntax and runs all seven test files. The UI tests require `jsdom`, installed by `npm ci`. All tests locate the userscript relative to their own files.

A successful run prints a `PASS:` message for each test file and exits with code `0`. An assertion failure prints an error and exits with a nonzero code.

## Coverage

[`clear-route.test.cjs`](./clear-route.test.cjs) checks clearing through Waze's native edit/clear controls with delayed DOM updates, preserved preferences, in-flight request cancellation and cleanup failures, repeated clicks, visibility based on `.wm-cards.is-destination.with-routing` including class-only updates, placement in the directions title, tooltip cleanup, and reentering directions. Native search handlers are test doubles; the search panel is never hidden and the page is never reloaded.

[`rapid-switch.test.cjs`](./rapid-switch.test.cjs) runs the script's vehicle-switching logic in a simulated environment and checks:

- Rapid switches between vehicle types and cancellation of previous requests.
- Protection against stale results, errors, and polling callbacks.
- No duplicate request when clicking an already selected vehicle, unless retrying a failed request.
- Retrying after a routing error.
- Preservation of origin, destination, time, and URL fragment.
- Buttons remaining available while a request is pending.
- Slow successful requests and genuine routing failures.
- Closing the directions panel or changing the destination during a request.
- Avoid settings, unpaved-road defaults and overrides, preservation of unknown route options, and translation fallback.
- The expected script version (`1.2.2`).

[`avoid-ui.test.cjs`](./avoid-ui.test.cjs) checks the Avoid panel, checkbox and dropdown interaction, keyboard navigation, translations, URL state, remounting, and missing route bridge behavior in `jsdom`. It also checks that window resize/scroll and document scroll close the dropdown without errors, including when it is already closed, while scrolling inside the menu keeps it open.

It also checks the refresh button's native tooltip adapter using real React/ReactDOM and a contract double for Waze's tooltip/runtime in [`native-tooltip-runtime.cjs`](./native-tooltip-runtime.cjs). This covers delayed runtime availability, discovery without fixed module IDs, native component props, portal cleanup on loading and unmount, header replacement, and hiding the results container while Waze shows loading. These dependencies are only used by tests; the userscript uses Waze's own React runtime.

[`mount-lifecycle.test.cjs`](./mount-lifecycle.test.cjs) uses a deterministic animation-frame queue and the real `jsdom` MutationObserver to check signal coalescing, full-update priority, skipping route traversal for control-only updates, route refresh on request completion, ignoring unrelated and owned DOM changes, translation text-node updates, listener reuse and cleanup, and reopening or replacing the routing panel. UI changes are scheduled for the next animation frame.

## Limits and manual checks

[`map-refresh.test.cjs`](./map-refresh.test.cjs) checks concurrent tile, native GeoRSS and route refresh; waiting for all jobs; separate error results with action-only tooltips; the scoped manual cache key; popup snapshot cleanup; preserving the selected route and suppressing only native route fitting; native loading guards; destination/viewport changes; request deadlines; and interceptor/abort cleanup. [`native-map-data-runtime.cjs`](./native-map-data-runtime.cjs) models deferred Underscore debounce invocation with `cancel()` and no `flush()`, swallowed errors, request sequencing and Axios interceptor snapshots. These are contract tests, not live Waze integration tests.

[`map-controls.test.cjs`](./map-controls.test.cjs) checks map controls without a routing panel, zoom level 19 and zoom-event updates, the current/maximum zoom tooltip, Waze's default tooltip delay, measured desktop-control offsets and resize cleanup, forced tile redraw, busy/retry behavior, localization, committed map context and listener cleanup. It also checks that geolocation pending/error/success glyph changes and replacement of the location button preserve the existing zoom DOM, refresh button, resolutions and listeners. Layout measurements and map methods are test doubles; browser layout and actual tile requests need separate verification.

`route-chips.test.cjs` verifies per-option toll prices and currency formatting, zero and missing prices, jam counts and severity, chip placement and wrapping, rerender cleanup, and committed React fiber selection with a simulated DOM. It does not verify live Waze compatibility.

The routing test mocks Waze's route bridge and disables UI mounting. The UI test uses a simulated DOM and checkbox test double. These tests do not verify the live React integration, network requests, visual rendering, or accessibility in a real browser.

After changing the userscript, also check directly on Waze Live Map that the selector appears, each vehicle type and avoid setting updates the route, rapid switching leaves the latest selection active, and the controls reappear after reopening the directions panel. Check English and Vietnamese labels and keyboard navigation as well.
