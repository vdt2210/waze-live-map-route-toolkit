# Script tests

This folder currently contains the automated regression tests for [Waze Live Map Route Toolkit](../waze-live-map-route-toolkit.user.js). These files are for development and are not needed to install or use the userscript.

## Run the tests

Install Node.js, then run these commands from the **repository root**, not from this folder:

```sh
npm --prefix tests ci
npm --prefix tests test
```

The full suite checks script syntax and runs all three test files. The UI tests require `jsdom`, installed by `npm ci`. All tests locate the userscript relative to their own files.

A successful run prints a `PASS:` message for each test file and exits with code `0`. An assertion failure prints an error and exits with a nonzero code.

## Coverage

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
- The expected script version (`1.2.0`).

[`avoid-ui.test.cjs`](./avoid-ui.test.cjs) checks the Avoid panel, checkbox and dropdown interaction, keyboard navigation, translations, URL state, remounting, and missing route bridge behavior in `jsdom`.

## Limits and manual checks

`route-chips.test.cjs` verifies per-option toll prices and currency formatting, zero and missing prices, jam counts and severity, chip placement and wrapping, rerender cleanup, and committed React fiber selection with a simulated DOM. It does not verify live Waze compatibility.

The routing test mocks Waze's route bridge and disables UI mounting. The UI test uses a simulated DOM and checkbox test double. These tests do not verify the live React integration, network requests, visual rendering, or accessibility in a real browser.

After changing the userscript, also check directly on Waze Live Map that the selector appears, each vehicle type and avoid setting updates the route, rapid switching leaves the latest selection active, and the controls reappear after reopening the directions panel. Check English and Vietnamese labels and keyboard navigation as well.
