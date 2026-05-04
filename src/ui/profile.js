// src/ui/profile.js
// Renders the profile section of the settings sheet:
//   - active row: avatar (color circle with initial) + name + chevron + ✏
//   - expandable switcher panel: profile list with Switch/Delete + Add button
//
// Switching or adding a profile triggers a full page reload so Stats/
// Filters/Settings are re-instantiated cleanly under the new active id.

export function bindProfileSection({ profiles }) {
  const activeRow    = document.querySelector('#profile-active');
  const activeAvatar = document.querySelector('#profile-active-avatar');
  const activeName   = document.querySelector('#profile-active-name');
  const renameBtn    = document.querySelector('#profile-rename');
  const switcher     = document.querySelector('#profile-switcher');
  const listEl       = document.querySelector('#profile-list');
  const addBtn       = document.querySelector('#profile-add');

  renderActive();
  renderList();

  activeRow.addEventListener('click', () => {
    switcher.hidden = !switcher.hidden;
  });

  renameBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const cur = profiles.active();
    if (!cur) return;
    const next = prompt('Rename profile:', cur.name);
    if (next == null) return;
    await profiles.rename(cur.id, next);
    renderActive();
    renderList();
  });

  addBtn.addEventListener('click', async () => {
    const name = prompt('What\'s your name?');
    if (name == null) return;
    const profile = await profiles.create(name);
    await profiles.setActive(profile.id);
    window.location.reload();
  });

  function renderActive() {
    const cur = profiles.active();
    if (!cur) return;
    activeName.textContent = cur.name;
    paintAvatar(activeAvatar, cur);
  }

  function renderList() {
    listEl.replaceChildren(...profiles.list().map((p) => makeRow(p)));
  }

  function makeRow(p) {
    const row = document.createElement('div');
    row.className = 'profile-row-item' + (p.id === profiles.active()?.id ? ' is-active' : '');
    const avatar = document.createElement('span');
    avatar.className = 'profile-avatar';
    paintAvatar(avatar, p);
    const name = document.createElement('span');
    name.className = 'profile-row-name';
    name.textContent = p.name;
    row.append(avatar, name);

    if (p.id !== profiles.active()?.id) {
      const switchBtn = document.createElement('button');
      switchBtn.type = 'button';
      switchBtn.className = 'profile-switch';
      switchBtn.textContent = 'Switch';
      switchBtn.addEventListener('click', async () => {
        await profiles.setActive(p.id);
        window.location.reload();
      });
      row.appendChild(switchBtn);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'profile-delete';
      delBtn.setAttribute('aria-label', `Delete ${p.name}`);
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', async () => {
        if (!confirm(`Delete ${p.name}? Their stats will be lost.`)) return;
        try {
          await profiles.remove(p.id);
          renderList();
        } catch (err) {
          alert(err.message);
        }
      });
      row.appendChild(delBtn);
    }

    return row;
  }

  function paintAvatar(el, p) {
    el.textContent = (p.name || '?').charAt(0).toUpperCase();
    el.style.background = p.color;
  }
}
