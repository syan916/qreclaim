# Template Base Resolution and UI Consistency Update

This document records the resolution of a `TemplateNotFound: base.html` error and the steps taken to ensure visual consistency across admin pages.

## Summary of Changes

1. Added `templates/base.html`:
   - Provides a common layout for admin pages with mobile-first viewport meta tags.
   - Includes global assets: Inter font, Font Awesome, `static/css/admin.css`, `static/css/theme.css`, and global JS (`admin.js`, `message-box.js`).
   - Wraps page content in `.main-content` and includes `partials/admin-header.html` for consistent structure. No admin footer is included to avoid dependency on a non-existent `partials/admin-footer.html`.

2. Updated admin pages to extend the new base:
   - `templates/admins/scan-qr-code.html`
   - `templates/admins/report-export.html`
   - Both pages now use the standardized `div.dashboard-container > div.dashboard-header > h1 + p` structure.

3. Ensured UI consistency with `static/css/admin.css`:
   - Standardized `.dashboard-header` styles (typography, spacing, color) used across pages.
   - Aligned markup with `admins/manage-locker.html` for consistent behavior across breakpoints.

4. Implemented automated tests:
   - Unit tests: `tests/unit/test_templates_exist.py` and `tests/unit/test_admin_pages_render.py` to prevent template regressions and verify rendering when authenticated.
   - Visual tests: `tests/visual/header_consistency.test.js` using Puppeteer to compare computed header styles across admin pages and viewports.

## Deployment & CI/CD Notes

1. Environment variables for visual tests:
   - `TEST_BASE_URL` (optional): defaults to `http://127.0.0.1:5000`.
   - `TEST_ADMIN_USER` and `TEST_ADMIN_PASS`: set to a valid admin credential for login. If not set, visual tests will be skipped.

2. Running tests:
   - Python unit tests: `pytest -q`
   - Visual tests (requires Node + Puppeteer): `npm run test:visual` or `node ./tests/visual/header_consistency.test.js` via Jest.

3. Runtime configuration: `app.py` now supports `HOST` and `PORT` environment variables to ease local previews and CI runs.

## Rollback Plan

If any issues arise, revert the changes to the two admin templates to their prior standalone structure and remove `base.html`. However, we recommend keeping `base.html` to maintain a consistent layout and simplify future updates.

## Notes

- All pages adhere to mobile-first PWA rules with the viewport meta tag present.
- Deep nesting was avoided where possible, with early returns in route handlers ensuring proper auth gating.
- Concurrency mechanisms are unchanged; this update affects templates, CSS, and tests only.