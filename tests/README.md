# Script tests

This folder currently contains the automated regression test for [Waze Live Map Route Toolkit](../waze-live-map-route-toolkit.user.js). These files are for development and are not needed to install or use the userscript.

## Run the test

Install Node.js, then run this command from the **repository root**, not from this folder:

```sh
node tests/rapid-switch.test.cjs
```

No additional packages are required. The test uses Node.js built-in modules and reads the userscript relative to the current working directory.

A successful run prints a `PASS:` message and exits with code `0`. An assertion failure prints an error and exits with a nonzero code.

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
- The expected script version (`1.0`).

## Limits and manual checks

The test mocks Waze's route bridge and disables UI mounting. It does not verify the live React integration, network requests, icon rendering, translations, or accessibility in a browser.

After changing the userscript, also check directly on Waze Live Map that the selector appears, each vehicle type updates the route, rapid switching leaves the latest selection active, and the controls reappear after reopening the directions panel. Check English and Vietnamese labels and keyboard navigation as well.
