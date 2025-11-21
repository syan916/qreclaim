// Global Back-to-Top functionality
// Ensures the back-to-top button works across all pages and adapts to footer height
// Key points:
// - Smooth scroll to top (respects prefers-reduced-motion)
// - Visibility toggles after a threshold
// - Dynamic bottom offset to avoid overlapping the footer

(function initGlobalBackToTop() {
  // Prevent multiple initializations across navigations
  if (window.__BackToTopInitialized) return;
  window.__BackToTopInitialized = true;

  const btn = document.getElementById('backToTop') || document.querySelector('.back-to-top');
  if (!btn) return; // No button found, safely exit

  const footer = document.getElementById('siteFooter') || document.querySelector('footer.user-footer');
  const showThreshold = 300; // px
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Update visibility and footer overlap offset
  const updateUI = () => {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    if (scrollTop > showThreshold) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }

    // Adjust bottom spacing when footer is in view to avoid overlap
    if (footer) {
      const rect = footer.getBoundingClientRect();
      const overlap = Math.max(0, window.innerHeight - rect.top); // >0 means footer is entering viewport
      const safeOffset = overlap > 0 ? overlap + 16 : 16; // 16px default gap
      btn.style.setProperty('--back-to-top-bottom', safeOffset + 'px');
    }
  };

  // Smooth scroll to top
  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: prefersReducedMotion ? 'auto' : 'smooth'
    });
  };

  // Event bindings
  window.addEventListener('scroll', updateUI, { passive: true });
  window.addEventListener('resize', updateUI);
  btn.addEventListener('click', scrollToTop);
  document.addEventListener('DOMContentLoaded', updateUI);

  // Initial run
  updateUI();
})();