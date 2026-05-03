// src/ui/progress.js
// Tiny wrapper around the #loading-progress element.

export function setProgress(loaded, total) {
  const el = document.querySelector('#loading-progress');
  if (!el) return;
  el.hidden = false;
  if (total > 0) {
    el.value = Math.round((loaded / total) * 100);
  } else {
    el.removeAttribute('value'); // indeterminate state
  }
}

export function hideProgress() {
  const el = document.querySelector('#loading-progress');
  if (el) {
    el.hidden = true;
    el.value = 0;
  }
}
