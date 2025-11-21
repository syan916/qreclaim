class NotificationsManager {
  constructor() {
    this.panel = document.getElementById('notificationPanel');
    this.listEl = document.getElementById('notificationList');
    this.loadingEl = document.getElementById('notificationLoading');
    this.emptyEl = document.getElementById('notificationEmpty');
    this.badge = document.getElementById('notificationBadge');
    this.btn = document.getElementById('notificationBtn');
    this.markAllBtn = document.getElementById('markAllNotifications');
    this.unsubscribe = null;
    this.items = [];
    this.init();
  }

  init() {
    if (this.btn) {
      this.btn.addEventListener('click', (e) => {
        e.preventDefault();
        this.togglePanel();
      });
    }
    if (this.markAllBtn) {
      this.markAllBtn.addEventListener('click', () => this.markAllRead());
    }
    this.setupRealtime();
    document.addEventListener('click', (e) => {
      if (!this.panel) return;
      const withinBtn = this.btn && this.btn.contains(e.target);
      const withinPanel = this.panel.contains(e.target);
      if (!withinBtn && !withinPanel) this.closePanel();
    });
  }

  togglePanel() {
    if (!this.panel) return;
    const hidden = this.panel.getAttribute('aria-hidden') !== 'false';
    this.panel.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    if (!hidden) return;
    this.render();
  }

  closePanel() {
    if (!this.panel) return;
    this.panel.setAttribute('aria-hidden', 'true');
  }

  setupRealtime() {
    const hasFirebase = typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && firebase.firestore;
    if (hasFirebase && window.currentUserId) {
      try {
        const db = firebase.firestore();
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const q = db.collection('notifications')
          .where('user_id', '==', window.currentUserId)
          .where('timestamp', '>=', since)
          .orderBy('timestamp', 'desc');
        this.unsubscribe = q.onSnapshot((snap) => {
          const arr = [];
          snap.forEach((doc) => {
            const d = doc.data() || {};
            arr.push({
              notificationId: d.notification_id || doc.id,
              userId: d.user_id,
              title: d.title,
              message: d.message,
              link: d.link,
              isRead: !!d.is_read,
              timestamp: d.timestamp,
              type: d.type
            });
          });
          this.items = arr;
          this.updateBadge();
          this.render();
        }, () => {
          this.fetchFallback();
        });
      } catch (_) {
        this.fetchFallback();
      }
    } else {
      this.fetchFallback();
    }
  }

  async fetchFallback() {
    if (this.loadingEl) this.loadingEl.style.display = 'block';
    try {
      const res = await fetch('/user/api/notifications/list?limit=50&days=30', { credentials: 'same-origin' });
      if (!res.ok) throw new Error('list failed');
      const data = await res.json();
      this.items = (data && data.notifications) || [];
      this.updateBadge();
      this.render();
    } catch (_) {
      this.items = [];
      this.updateBadge();
      this.render();
    }
  }

  updateBadge() {
    const unread = this.items.filter(i => !i.isRead).length;
    if (!this.badge) return;
    if (unread > 0) {
      const text = unread > 99 ? '99+' : String(unread);
      this.badge.textContent = text;
      this.badge.style.display = 'inline-block';
    } else {
      this.badge.style.display = 'none';
    }
    if (window.notificationBadge && typeof window.notificationBadge.refresh === 'function') {
      window.notificationBadge.displayBadge(unread);
    }
  }

  render() {
    if (!this.listEl || !this.loadingEl || !this.emptyEl) return;
    this.loadingEl.style.display = 'none';
    this.listEl.innerHTML = '';
    if (!this.items.length) {
      this.emptyEl.style.display = 'block';
      return;
    }
    this.emptyEl.style.display = 'none';
    const fmt = (ts) => {
      try { return new Date(ts.seconds ? ts.seconds * 1000 : ts).toLocaleString(); } catch (_) { return ''; }
    };
    this.items.slice(0, 15).forEach(n => {
      const li = document.createElement('li');
      li.className = 'notification-item' + (n.isRead ? '' : ' unread');
      li.innerHTML = `<div class="item-main"><div class="item-title">${this.escape(n.title || '')}</div><div class="item-message">${this.escape(n.message || '')}</div></div><div class="item-meta"><span class="item-time">${fmt(n.timestamp)}</span></div>`;
      li.addEventListener('click', () => this.openNotification(n));
      this.listEl.appendChild(li);
    });
  }

  async openNotification(n) {
    try {
      const hasFirebase = typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && firebase.firestore;
      if (hasFirebase && n.notificationId) {
        const db = firebase.firestore();
        await db.collection('notifications').doc(n.notificationId).update({ is_read: true });
      } else if (n.notificationId) {
        await fetch('/user/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ notificationId: n.notificationId })
        });
      }
    } catch (_) {}
    this.closePanel();
    if (n.link) window.location.href = n.link;
  }

  async markAllRead() {
    try {
      const hasFirebase = typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && firebase.firestore;
      if (hasFirebase) {
        const db = firebase.firestore();
        const batch = db.batch();
        this.items.filter(i => !i.isRead && i.notificationId).forEach(i => {
          batch.update(db.collection('notifications').doc(i.notificationId), { is_read: true });
        });
        await batch.commit();
      } else {
        await fetch('/user/api/notifications/mark-all-read', { method: 'POST', credentials: 'same-origin' });
      }
      this.items = this.items.map(i => ({ ...i, isRead: true }));
      this.updateBadge();
      this.render();
    } catch (_) {}
  }

  escape(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('notificationPanel')) {
    window.notificationsManager = new NotificationsManager();
  }
});