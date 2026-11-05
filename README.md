# Timecard Validator

**Retired for archival on November 5, 2026.** This repository preserves the app, its design, and its development history. Live hosting is no longer needed.

## What it was

A small browser app for reviewing Saturday–Friday workweeks before entering a timecard. It used a classic teal desktop-style interface with a green Home Screen icon.

- Up to four workweeks, including retained prior weeks.
- Up to three clock-in/out periods per day.
- Automatic sorting of periods by clock-in time.
- Daily and weekly paid-hour totals.
- Checks for weekly and daily hour limits, a day off, and gaps between periods.
- Compact daily text that could be copied into a timecard.
- Local browser storage and automatic owner-only synchronization on the ChatGPT Site.

## Preserved version

The existing GitHub source was compared with ChatGPT Sites version **12** on November 5, 2026. Both pointed to the same commit:

[`b0449b438fbe5da7a002cced7751329bf210d3a6`](https://github.com/SkinnyOracle31415926535/timecard-validator/commit/b0449b438fbe5da7a002cced7751329bf210d3a6) — Restore automatic owner sync without transfer UI.

The app source, icons, tests, database schema, and existing Git history are retained. This retirement update changes documentation only.

The former ChatGPT Site address was `https://ryan-timecard-validator.ryan-666-mp3.chatgpt.site`. GitHub Pages was already disabled when the archive was prepared. Archiving this repository does not itself delete the separate ChatGPT Site.

## Run it locally

No dependency installation is needed for the browser app. After cloning or downloading this repository, run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open [http://localhost:8000](http://localhost:8000).

Local validation and browser storage work independently of the hosted service. Cross-device synchronization requires the original server setup; it is not active on localhost.

## Validation rules in the archived app

- Up to 40 paid hours per week.
- Up to 8 paid hours per day.
- At least one day off in each Saturday–Friday workweek.
- A warning for days from 5½ through 6 worked hours without a 30-minute gap between periods.
- An error for days longer than 6 worked hours without a 30-minute gap between periods.

These are the app's implemented checks, preserved for reference.

## Saved data and restoration

Timecard entries are separate from this source repository. A complete export of the Site's server-stored workspace and view preference records was saved privately on November 5, 2026. That export is not committed here. Unsynced entries and recovery copies held only in a device's browser are not included in the server export.

The hosted implementation uses the `DB` binding and the schema in `drizzle/0000_temporary_app_sync.sql`. Recreating synchronization requires a suitable server, authenticated owner identity, and restored data. The preserved hosting manifest describes the original Site; it does not create a new one.

## Development reference

With Node.js and npm available:

```sh
npm test
npm run build
```

The repository's existing test command includes a build. The standalone build command creates the browser and worker output under `dist/`.
