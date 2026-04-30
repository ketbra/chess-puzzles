export function setStatus(text) {
  const el = document.querySelector('#status');
  if (el) el.textContent = text;
}

export function flashCorrect(squareEl) {
  if (!squareEl) return Promise.resolve();
  return runAnimation(squareEl, 'flash-correct');
}

export function shakeIncorrect(rootEl) {
  if (!rootEl) return Promise.resolve();
  return runAnimation(rootEl, 'shake-incorrect');
}

function runAnimation(el, className) {
  return new Promise((resolve) => {
    el.classList.remove(className);
    // Force reflow so re-adding the class restarts the animation.
    void el.offsetWidth;
    el.classList.add(className);
    const onEnd = () => {
      el.classList.remove(className);
      el.removeEventListener('animationend', onEnd);
      resolve();
    };
    el.addEventListener('animationend', onEnd);
    // Safety timeout in case animationend doesn't fire (e.g., on a
    // hidden element).
    setTimeout(onEnd, 600);
  });
}
