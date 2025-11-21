/*
 * Image Modal Shared (Option A)
 * Baseline click-to-open and close behaviors for image containers across pages.
 * Uses page-specific openImageModal/closeImageModal if available; otherwise falls back to a minimal viewer.
 */
(function(){
  let isSetupDone = false;

  function getTitleFromContainer(container){
    if (!container) return 'Image';
    const explicit = container.getAttribute('data-image-title');
    if (explicit) return explicit.trim();
    const card = container.closest('.item-card');
    const titleEl = card && (card.querySelector('.item-title') || card.querySelector('.item-name') || card.querySelector('h3, h2, h5'));
    const title = titleEl ? (titleEl.textContent || '').trim() : '';
    return title || 'Image';
  }

  function getImageFromContainer(container){
    if (!container) return null;
    // If the clickable element itself is an IMG, use it directly
    if (container.tagName && container.tagName.toLowerCase() === 'img') return container;
    // Otherwise, find the image inside the container
    return container.querySelector('.item-image') || container.querySelector('img');
  }

  function ensureBasicModal(){
    let modal = document.getElementById('imageModal');
    if (!modal){
      modal = document.createElement('div');
      modal.id = 'imageModal';
      modal.className = 'image-modal';
      modal.innerHTML = `
        <div class="modal-content" role="dialog" aria-modal="true">
          <button class="modal-close" aria-label="Close">&times;</button>
          <img id="modalImage" class="modal-image" src="" alt="Enlarged view">
        </div>
      `;
      document.body.appendChild(modal);
    }
    // Backdrop click closes when not using page-specific close
    if (typeof window.closeImageModal !== 'function'){
      modal.addEventListener('click', function(e){
        if (e.target === modal){
          closeBasic();
        }
      });
    }
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn && typeof window.closeImageModal !== 'function'){
      closeBtn.addEventListener('click', function(e){
        e.preventDefault();
        closeBasic();
      });
    }
    return modal;
  }

  function openBasic(src, title){
    const modal = ensureBasicModal();
    const img = modal.querySelector('#modalImage');
    if (img){
      img.src = src || '';
      img.alt = title || 'Enlarged view';
      img.style.display = 'block';
    }
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn){
      closeBtn.focus({ preventScroll: true });
    }
  }

  function closeBasic(){
    const modal = document.getElementById('imageModal');
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    const img = modal.querySelector('#modalImage');
    if (img){
      img.src = '';
      img.style.display = 'none';
    }
  }

  function openFromContainer(container){
    const imgEl = getImageFromContainer(container);
    if (!imgEl) return;
    const src = imgEl.dataset.fullsize || imgEl.getAttribute('src') || '';
    const title = getTitleFromContainer(container);
    if (typeof window.openImageModal === 'function'){
      window.openImageModal(src, title);
    } else {
      openBasic(src, title);
    }
  }

  function closeShared(){
    if (typeof window.closeImageModal === 'function'){
      window.closeImageModal();
    } else {
      closeBasic();
    }
  }

  function onClickDelegated(e){
    // Only respond to clicks on elements marked as clickable image containers
    const container = e.target.closest('.item-image-container.clickable-image, .clickable-image');
    if (!container) return;
    // Ignore clicks originating from modal controls
    if (document.getElementById('imageModal')?.contains(e.target) && !container.closest('.item-card')){
      return;
    }
    e.preventDefault();
    openFromContainer(container);
  }

  function onKeydownDelegated(e){
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.item-image-container.clickable-image, .clickable-image')){
      e.preventDefault();
      const container = e.target.closest('.item-image-container.clickable-image, .clickable-image');
      openFromContainer(container);
    } else if (e.key === 'Escape'){
      // Allow Esc to close when using basic modal only; page-specific handlers may already manage this
      if (typeof window.closeImageModal !== 'function'){
        closeBasic();
      }
    }
  }

  function setup(){
    if (isSetupDone) return;
    isSetupDone = true;
    document.addEventListener('click', onClickDelegated, { passive: false });
    document.addEventListener('keydown', onKeydownDelegated);
  }

  // Expose API
  window.ImageModalShared = {
    setup: setup,
    openFromContainer: openFromContainer,
    openBasic: openBasic,
    close: closeShared
  };

  // Auto-setup on DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();