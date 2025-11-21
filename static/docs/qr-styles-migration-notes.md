QReclaim Admin – QR Register Requests Styling Migration

Summary
- Copied table-related styles, pagination, loading, and empty-state UI from manage-lost-item-report.css to qr-register-request.css to achieve visual parity.
- Added responsive breakpoints at 1200px, 768px, and 480px with identical values for widths, paddings, margins, and typography.
- Ensured sort icons, sticky headers, hover states, and focus outlines match Manage Lost Reports.

Files Updated
1) static/css/qr-register-request.css
   - Table section (.table-section, .table-header, .table-title, .items-count)
   - Container (.table-container)
   - Table (.lost-reports-table, th/td variants, hover effects)
   - Sorting icons (.sortable ::after, .sorted-asc/desc, hidden .sort-indicator span)
   - Pagination (.pagination-section, .pagination-info, .pagination-controls, .pagination-btn, .page-numbers)
   - Loading overlay (.loading-overlay, .loading-spinner)
   - Empty state (.empty-state and children)
   - Status badges, action buttons, batch-actions, selection column
   - Responsive breakpoints @media (max-width: 1200px, 768px, 480px)

2) templates/admins/qr-register-request.html
   - No structural changes required; verified class names align with copied CSS selectors.

Parity Verification (line-by-line checklist)
- Widths: Table width 100%; sticky header; column paddings 15px/12px default → 10px/8px at ≤768px → 8px/6px at ≤480px.
- Paddings/Margins: Pagination padding 20px → 15px at ≤768px; modal content widths and paddings matched; dashboard header paddings matched.
- Colors: Preserved CSS variables and hex codes used in manage-lost-item-report.css (e.g., #f8f9fa headers, #e1e8ed borders, primary #3498db).
- Breakpoints: Added 1200px, 768px, 480px blocks mirroring manage-lost. QR page uses .qr-requests container in place of .manage-lost-reports.

Testing Performed
- Verified visually via local dev server (http://localhost:5000/admin/qr-register-request):
  • Sticky header behavior on scroll
  • Row hover elevation and background
  • Sort indicator toggling via th.sorted-asc/desc classes (JS-driven)
  • Pagination hover/disabled states
  • Empty and loading states centered and readable
- Responsive checks at common widths: 1280px, 992px, 768px, 480px.

Known Notes
- QR table does not currently include image column; .item-image rules are retained for parity but do not render unless JS adds an image cell.
- Action button styles (.action-btn) retained to match manage-lost, but the QR page primarily uses .btn-approve/.btn-reject.

How to Revert
- Revert commit or remove the responsive sections appended in static/css/qr-register-request.css.

Follow-up Ideas
- Extract shared admin table styles to a dedicated static/css/admin-table.css and import in both pages for single-source maintenance.