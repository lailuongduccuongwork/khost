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
- Current room status uses the full booking history for the selected properties, independently of RoomMap's visible calendar range. This adds a property-scoped booking subscription on RoomMap and replaces Housekeeping's limited date window, so opening a large property's operational views can read more data.
- Existing rooms without `lastCleanedAt` require a new cleaning confirmation if they have a completed stay. New rooms with no completed stays retain their initial status. No production backfill is performed by this change.
- Status recalculates when data arrives and on the existing minute timer; a client does not need to be open at checkout. This display rule does not depend on `VITE_ENABLE_CLIENT_AUTOMATION`. When enabled, the existing automation also persists derived status.
- Early/late departures must be reflected in the booking's checkout time.

Run `npm test` for the cleanliness regression tests. Firebase operations in these tests use an in-memory adapter; they do not connect to production.
