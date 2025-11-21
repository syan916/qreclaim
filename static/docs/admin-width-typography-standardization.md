QReclaim Admin – Width Parity and Header Typography Standardization

Overview
- All core admin pages now share a unified dashboard header structure and consistent content widths.
- Target max content width: 1400px (configurable via CSS variable `--content-max-width`).
- Mobile-first, responsive paddings with 20px horizontal padding at desktop; collapses appropriately on smaller screens.

Unified Header Markup
- In all templates, the header resides inside `.dashboard-container` and uses `.dashboard-header`:

  <div class="dashboard-container">
    <div class="dashboard-header">
      <h1>Page Title</h1>
      <p>Page subtitle or description</p>
    </div>
    <!-- page content -->
  </div>

Shared Header Styles
- Defined in `static/css/admin.css`:
  • Typography, spacing, and max-width alignment
  • Centering via `margin: 0 auto;`
  • Consistent hierarchy: h1 and p sizes and weights

Page Containers and Width Rules (current state)
- Manage Lost Item Reports: `.manage-lost-reports { max-width: 1400px; margin: 0 auto; padding: 0 20px 20px; }`
- Manage Found Items: `.manage-found-items { max-width: 1400px; margin: 0 auto; padding: 0 20px 20px; }`
- QR Register Requests: `.qr-requests { max-width: var(--content-max-width, 1400px); margin: 0 auto; padding: 0 20px 20px; }`
- Post Found Item: `.content-container` within `.dashboard-container` wraps the form; width aligns visually with 1400px target
- Admin Review History: `.review-container { max-width: 1400px; margin: 0 auto; }` with header using `.dashboard-header`

Recommended Extraction (next step)
- Introduce a shared content wrapper class in `admin.css` (e.g., `.dashboard-content`) with:
  `.dashboard-content { max-width: var(--content-max-width, 1400px); margin: 0 auto; padding: 0 20px 20px; }`
- Attach `.dashboard-content` to each page’s content wrapper alongside existing page-specific classes to avoid breaking selectors.

Responsive Behavior
- Ensure the following breakpoints are respected where applicable: 1200px, 768px, 480px.
- At 768px and 480px, column padding in tables reduces appropriately; header typography remains readable and consistent.

Verification Checklist
- Header uses `.dashboard-header` with h1 and p present.
- Header and content wrappers are centered with max-width 1400px.
- Horizontal padding is 20px on desktop; reduced at smaller breakpoints if page-specific CSS defines it.
- Table header, pagination, and empty/loading states match visual parity across pages.

Visual Tests
- Puppeteer + pixelmatch tests added under `tests/visual/`:
  • `header-container-widths.test.js` – Numeric width parity for header/content across pages and viewports.
  • `header-parity-screenshots.test.js` – Screenshot comparison to baselines for header visuals.
- Usage:
  1) Start Flask dev server: `python app.py`
  2) Set admin credentials for tests: `set TEST_ADMIN_USER=<id>` and `set TEST_ADMIN_PASS=<password>`
  3) Generate baselines: `npm run test:vr:update`
  4) Run comparisons: `npm run test:vr`

Notes
- QR Register Requests table styles were copied from `manage-lost-item-report.css` for exact parity; see `qr-styles-migration-notes.md`.
- The shared header typography lives in `admin.css`; avoid duplicating header styles in page-specific CSS.