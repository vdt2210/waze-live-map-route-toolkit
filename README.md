# Waze Live Map Route Toolkit

Choose **Car**, **Motorcycle**, or **Taxi** routes and adjust route preferences directly on Waze Live Map.

> An unofficial community project, not affiliated with or endorsed by Google or Waze.

## Features

- Easily switch between Car, Motorcycle, and Taxi routes.
- Avoid tolls, unpaved roads, ferries, freeways, and difficult turns.
- Supported languages: **VN | EN**.

## Installation

1. Install a userscript manager, such as Tampermonkey.
2. Open [the script on Greasy Fork](https://greasyfork.org/en/scripts/606237-waze-live-map-route-toolkit), click **Install this script**, and confirm installation in your userscript manager.
3. Open or reload [Waze Live Map](https://www.waze.com/live-map).

Alternatively, create a new script in your userscript manager, paste the contents of [this file](./waze-live-map-route-toolkit.user.js), and save.

Works on Waze Live Map, including the beta website.

## Usage

1. Enter your starting point and destination.
2. Click the Car, Motorcycle, or Taxi icon to view routes for that vehicle.
3. Expand **Avoid** to adjust tolls, ferries, freeways, difficult turns, and unpaved roads.

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
- **Route update failed?** Click the vehicle icon again to retry.
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
