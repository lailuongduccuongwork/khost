<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Mr1FKNmwmssT3MCz4We7BOc445h8mGBd

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Create `.env.local` from `.env.example` and fill in your Firebase Web App config
   Keep `VITE_ENABLE_CLIENT_AUTOMATION=false` unless you intentionally want one dedicated client machine to run automation.
3. Run the app:
   `npm run dev`

## Room cleanliness

- A manual “Sạch” confirmation saves `rooms/{roomId}/lastCleanedAt` using Firebase server time, even when the stored status is already clean.
- After a valid stay ends, both Housekeeping and RoomMap show the room as dirty unless it was confirmed clean at or after checkout. Active stays still display as occupied; deleted bookings and holds do not require cleaning.
- Current room status reads stays since the earliest known cleaning confirmation in the selected rooms, independently of RoomMap's visible calendar range. If any room has no confirmation, it retains the property-scoped full history to avoid showing an old, uncleaned room as clean.
- Existing rooms without `lastCleanedAt` require a new cleaning confirmation if they have a completed stay. New rooms with no completed stays retain their initial status. No production backfill is performed by this change.
- Status recalculates when data arrives and on the existing minute timer; a client does not need to be open at checkout. This display rule does not depend on `VITE_ENABLE_CLIENT_AUTOMATION`. When enabled, the existing automation also persists derived status.
- Early/late departures must be reflected in the booking's checkout time.

Run `npm test` for the cleanliness regression tests. Firebase operations in these tests use an in-memory adapter; they do not connect to production.

## Automatic Firebase backups on macOS

- `npm run backup:install` installs a per-user LaunchAgent that runs at 22:00 daily and again when the user logs in. Google Drive is preferred automatically when Drive for desktop is available; iCloud Drive is the fallback.
- `npm run backup:now` creates a manual backup immediately.
- The installer also places `Sao lưu K-Host ngay.command` in the backup folder for a double-click manual backup.
- `npm run backup:status` shows the most recent successful backup.
- `npm run backup:uninstall` removes the schedule without deleting existing archives.
- To use Google Drive or an external disk, run `npm run backup:install -- --destination="/absolute/path/K-Host Backups"`.
- Daily archives retain 30 days; monthly archives retain 12 months. Manual and pre-update archives retain the latest 30 copies each.
- `npm run build` only compiles the app; it does not download the database. Use `npm run build:release` to create and verify a fresh pre-update backup before preparing a release. The release build stops if the backup fails. Daily scheduled and manual backups remain available.
- Backup files are raw Firebase JSON compressed with gzip, with a checksum and summary in the matching `.metadata.json` file.

## Firebase download reduction (September 2026)

- A failed login checks only `system/users`, `system/tenants`, and each listed `tenants/{id}/users` directory. It never downloads the `tenants` tree. Legacy accounts missing from the central directory can still sign in and repair that directory.
- Management no longer loads bookings. Non-operational views subscribe to the data they actually use instead of re-fetching all bookings on every global update.
- Identical realtime queries share a listener. A detached listener stays live for 15 seconds to bridge route changes, then closes. Logout or a tenant change clears it immediately. This is a live snapshot, not an offline persistent cache.
- Availability, the booking editor, and manual clean/dirty checks query canonical bookings by indexed `checkOutDate`. Long stays remain visible. A two-day query margin accommodates legacy local/offset timestamps; final filtering uses actual time values.
- RoomMap/Housekeeping can omit pre-cleaning history only when every room in scope has a cleaning timestamp. Legacy rooms still retain full history. The Bookings and Performance lists retain their full historical search/reporting scope.
- Calendar hydration waits for every requested day before publishing results, so partial data is not shown as an empty room.
- Debug `SNAPSHOT:*` byte counters describe reconstructed callback snapshots, **not billable wire bytes**. Use Firebase's Downloads chart for billed traffic and the profiler for query diagnosis.
- No authentication/rules migration or data deletion is included. Current rules still require a separate coordinated Firebase Auth migration; do not simply turn on `auth != null` with the existing custom login.

Validation: `npm test` (in-memory Firebase, no production writes), `npm run build`.
The pre-existing `tsc --noEmit` errors in `components/ErrorBoundary.tsx` and `types.ts` also occur on the baseline commit.
