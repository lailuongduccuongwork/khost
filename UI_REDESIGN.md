# K-Host interface redesign

The UI uses neutral opaque surfaces, system typography, a restrained blue action color, subtle borders and short transitions. The existing `katka-*` names remain as compatibility hooks across views; the old stacked glass overrides have been removed.

- Shared desktop/mobile navigation, property switcher, notifications and login.
- Dashboard hierarchy, real daily checkout-revenue chart, expandable daily table.
- Consistent tables, filters, status cards, room timeline, management views and reports.
- Mobile room actions and horizontally scrollable data tables; sticky booking columns only on wide screens.
- Shared `DialogFrame` for modal naming, Tab containment, Escape dismissal, body scroll lock and focus restoration. Nested dialogs retain their own focus.
- Light/dark themes, visible keyboard focus, reduced-motion support and browser zoom.

Data services, Firebase rules, storage schemas, pricing/status calculations, authorization and permission checks are unchanged. The existing uncommitted room-identity layout changes in `RoomMap.tsx` were preserved. The dashboard chart uses the already computed `dailySummaryRows`; it does not introduce another data query or calculation.

## Verification

- Production build: passed.
- Existing regression suite: all 14 tests passed.
- Browser rendering checked with isolated sample props and a mocked data service; external network requests were blocked. No production writes were made.
- Dashboard, bookings, room map, housekeeping, reports, performance, management, platform and history rendered without runtime errors. Staff management was checked through its management tab.
- Responsive checks at 320, 390, 768, 1024, 1280 and 1512 px; no page-level horizontal overflow after fixes. Wide tables retain internal horizontal scrolling.
- Exercised date presets, ranking mode, property selection, theme switch, notifications, mobile navigation, booking details, room finder, booking form and staff form; checked keyboard containment, Escape and focus restoration.
- TypeScript still reports the same four diagnostics as the clean HEAD baseline: `components/ErrorBoundary.tsx:26` and `types.ts:149,189`. No new diagnostics from this redesign. These existing non-UI issues were left unchanged.

The temporary browser fixture was removed from the application. This change has not been deployed.
