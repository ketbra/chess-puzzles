// src/ui/install.js
// Captures the beforeinstallprompt event and manages a small install button.
// The button is hidden by default; appears when the browser fires the event;
// disappears after the user's choice or once the app is installed.

let deferredPrompt = null;

export function bindInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    showButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideButton();
  });

  const btn = document.querySelector('#install-btn');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      hideButton();
      console.log('[install]', outcome);
    });
  }
}

function showButton() {
  const el = document.querySelector('#install-btn');
  if (el) el.hidden = false;
}

function hideButton() {
  const el = document.querySelector('#install-btn');
  if (el) el.hidden = true;
}
