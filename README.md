# Waze Live Map Route Toolkit

Choose **Car**, **Motorcycle**, or **Taxi** routes and adjust route preferences directly on Waze Live Map.

> An unofficial community project, not affiliated with or endorsed by Google or Waze.

## Features

- Easily switch between Car, Motorcycle, and Taxi routes.
- Avoid tolls, unpaved roads, ferries, freeways, and difficult turns.
- Show average route speed.
- Route option alert badges.
- Waze-styled vehicle buttons with native tooltips, plus Clear all / exit directions.
- Zoom up to level 19, with the current level between the zoom buttons and current/maximum levels in its tooltip.
- Refresh map tiles and live traffic data, plus the active route, using the button above Show my location.
- Supported languages: **VN | EN**.

## Installation

1. Install a userscript manager, such as Tampermonkey.
2. Open [the script on Greasy Fork](https://greasyfork.org/en/scripts/606237-waze-live-map-route-toolkit), click **Install this script**, and confirm installation in your userscript manager.
3. Open or reload [Waze Live Map](https://www.waze.com/live-map).

Alternatively, create a new script in your userscript manager, paste the contents of [this file](./waze-live-map-route-toolkit.user.js), and save.

Supports the desktop layout of Waze Live Map, including the beta website. The mobile layout is not supported.

## Usage

1. Enter your starting point and destination.
2. Click the Car, Motorcycle, or Taxi icon to view routes for that vehicle.
3. Expand **Avoid** to adjust tolls, ferries, freeways, difficult turns, and unpaved roads.
4. While Waze's destination card is in routing mode (`.wm-cards.is-destination.with-routing`), click **×** at the right of the directions title to clear both endpoints using Waze's own search controls. Waze clears the route without reloading the page; the search panel stays available as usual.
5. Use **Refresh map** above **Show my location** to reload tiles and Waze's live traffic layers (jams, alerts, closures and enabled user markers). While directions are active, the same button also recalculates the route. These jobs run in parallel; the button shows Waze's spinner and ignores further clicks until all finish. Your viewport, routing preferences and departure/arrival time are preserved; the selected alternative is retained when its geometry still appears in the new results. Old traffic popups close after a successful data refresh so stale details are not left open.
6. The separate **Refresh route** button in the route header only recalculates directions. Refresh tooltips always show the action name. Map refresh failures are logged in the Console and announced through a status region; route-only failures are handled by Waze and logged by the script. Tile requests appear under **Img** in DevTools with `_olSalt`; GeoRSS and route requests appear under **Fetch/XHR**. A fresh query key is added only to the manually triggered GeoRSS request after Waze's native debounce runs. Available traffic layers depend on Waze's zoom/filter rules; Waze controls server-side data freshness.

## Defaults

| Setting               | Default value                                                            |
| --------------------- | ------------------------------------------------------------------------ |
| Vehicle               | Car                                                                      |
| Avoid tolls           | Off                                                                      |
| Avoid ferries         | Off                                                                      |
| Avoid freeways        | Off                                                                      |
| Avoid difficult turns | On                                                                       |
| Unpaved roads         | Don't allow                                                              |
| Avoid panel           | Collapsed                                                                |
| Language              | Vietnamese or English based on the Waze page language; otherwise English |

## Troubleshooting

- **Vehicle & avoid options missing?** Make sure the script is enabled and the directions panel is open, then reload the page.
- **Route update failed?** Use **Refresh route** in the route header to retry once Waze finishes loading.
- **Controls no longer update routes?** Check for a newer script version. Changes to Waze's website can break compatibility.
- **Still not working?** Report a bug on [GitHub Issues](https://github.com/vdt2210/waze-live-map-route-toolkit/issues).

Available routes depend on Waze and your region. Different vehicle types may show the same route.

## Privacy

This script adds no analytics or separate data collection service. Route requests are handled by Waze.

## Disclaimer and third-party rights

This is an independent, unofficial project. It is not affiliated with, endorsed by, sponsored by, or supported by Google or Waze.

Google, Waze, and their related names, logos, and trademarks belong to their respective owners. They are referenced only to identify the service this script works with. Maps, routing data, and other third-party content remain the property of their respective owners.

The [MIT license](./LICENSE) covers only this project's original code and documentation. It grants no rights to Google or Waze trademarks, services, or content. Use of those services remains subject to their applicable terms.

Provided “as is,” without warranty. Compatibility and route accuracy are not guaranteed. This disclaimer does not grant permission to use protected material.

## Author and license

Created by **vdt2210**. Licensed under [MIT](./LICENSE).
