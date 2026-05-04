// src/ui/settings.js
// Binds the gear icon, settings sheet, scrim, and the four controls
// (sound toggle, theme segmented, coords toggle, reset stats button).

import { bindProfileSection } from './profile.js';

export function bindSettings({ settings, profiles, onResetStats }) {
  bindProfileSection({ profiles });
  const gear = document.querySelector('#gear-btn');
  const sheet = document.querySelector('#settings-sheet');
  const scrim = document.querySelector('#settings-scrim');
  const closeBtn = document.querySelector('#settings-close');
  const soundToggle = document.querySelector('#setting-sound');
  const themeWarm = document.querySelector('#setting-theme-warm');
  const themeCool = document.querySelector('#setting-theme-cool');
  const coordsToggle = document.querySelector('#setting-coords');
  const resetBtn = document.querySelector('#setting-reset-stats');

  syncControls(settings);

  gear.addEventListener('click', open);
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);

  soundToggle.addEventListener('change', async () => {
    await settings.setSound(soundToggle.checked);
  });
  themeWarm.addEventListener('click', async () => {
    await settings.setTheme('warm');
    settings.apply();
    syncControls(settings);
  });
  themeCool.addEventListener('click', async () => {
    await settings.setTheme('cool');
    settings.apply();
    syncControls(settings);
  });
  coordsToggle.addEventListener('change', async () => {
    await settings.setShowCoords(coordsToggle.checked);
    settings.apply();
  });

  // Reset stats: in-place two-stage confirm with 3s disarm timeout.
  let resetArmed = false;
  let disarmTimer = null;
  resetBtn.addEventListener('click', async () => {
    if (!resetArmed) {
      resetBtn.textContent = 'Confirm reset';
      resetBtn.classList.add('confirming');
      resetArmed = true;
      clearTimeout(disarmTimer);
      disarmTimer = setTimeout(() => {
        resetArmed = false;
        resetBtn.textContent = 'Reset stats';
        resetBtn.classList.remove('confirming');
      }, 3000);
      return;
    }
    clearTimeout(disarmTimer);
    await onResetStats();
    resetArmed = false;
    resetBtn.textContent = 'Reset stats';
    resetBtn.classList.remove('confirming');
  });

  function syncControls(s) {
    soundToggle.checked = s.soundOn;
    coordsToggle.checked = s.showCoords;
    themeWarm.classList.toggle('active', s.theme === 'warm');
    themeCool.classList.toggle('active', s.theme === 'cool');
  }

  function open() { sheet.classList.add('open'); scrim.classList.add('visible'); }
  function close() { sheet.classList.remove('open'); scrim.classList.remove('visible'); }
}
