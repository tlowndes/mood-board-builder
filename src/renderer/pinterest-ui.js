/* Pinterest dialog: app setup, sign-in and board picker. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dlg = $('pinDialog');
  const panes = { setup: $('pinSetup'), signIn: $('pinSignIn'), boards: $('pinBoards') };
  let onPick = null;
  let boards = [];

  function show(name) {
    for (const [k, el] of Object.entries(panes)) el.hidden = k !== name;
  }

  function error(msg) {
    const el = $('pinError');
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  function renderBoards() {
    const q = $('pinFilter').value.trim().toLowerCase();
    const grid = $('boardGrid');
    grid.textContent = '';
    const list = boards.filter(b => !q || b.name.toLowerCase().includes(q));
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = boards.length ? 'No boards match that filter.' : 'No boards found on this account.';
      grid.append(p);
      return;
    }
    for (const b of list) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'board';
      const cover = document.createElement('div');
      cover.className = 'board-cover';
      if (b.cover) {
        const img = document.createElement('img');
        img.src = b.cover;
        img.alt = '';
        img.loading = 'lazy';
        cover.append(img);
      }
      const name = document.createElement('strong');
      name.textContent = b.name;
      const count = document.createElement('span');
      count.className = 'muted';
      count.textContent = `${b.pinCount ?? '?'} pins`;
      card.append(cover, name, count);
      card.addEventListener('click', () => { dlg.close(); onPick && onPick(b); });
      grid.append(card);
    }
  }

  async function refresh() {
    error('');
    const st = await mood.pinterest.status();
    $('redirectUri').textContent = st.redirectUri;
    $('pinAppId').value = st.appId || '';
    if (!st.appId || !st.hasSecret) return show('setup');
    if (!st.signedIn) { if (st.error) error(st.error); return show('signIn'); }
    $('pinUser').textContent = `Signed in as ${st.username}`;
    show('boards');
    $('boardGrid').innerHTML = '<p class="muted">Loading boards…</p>';
    try {
      boards = await mood.pinterest.boards();
      renderBoards();
    } catch (e) {
      $('boardGrid').textContent = '';
      error(e.message);
    }
  }

  async function signIn() {
    error('');
    const btn = $('pinConnect');
    btn.disabled = true;
    btn.textContent = 'Waiting for your browser…';
    try {
      await mood.pinterest.signIn();
      await refresh();
    } catch (e) {
      show('signIn');
      error(e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign in with Pinterest';
    }
  }

  $('pinSave').addEventListener('click', async () => {
    const appId = $('pinAppId').value.trim();
    const appSecret = $('pinSecret').value.trim();
    if (!appId) return error('Add your App ID.');
    const st = await mood.pinterest.status();
    if (!appSecret && !st.hasSecret) return error('Add your App secret.');
    await mood.pinterest.saveConfig({ appId, appSecret });
    $('pinSecret').value = '';
    show('signIn');
    signIn();
  });
  $('pinConnect').addEventListener('click', signIn);
  $('pinEditApp').addEventListener('click', () => { error(''); show('setup'); });
  $('pinSignOut').addEventListener('click', async () => { await mood.pinterest.signOut(); boards = []; refresh(); });
  $('pinFilter').addEventListener('input', renderBoards);
  $('copyRedirect').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('redirectUri').textContent);
    $('copyRedirect').textContent = 'Copied';
    setTimeout(() => ($('copyRedirect').textContent = 'Copy'), 1500);
  });
  dlg.addEventListener('click', e => {
    const a = e.target.closest('[data-link]');
    if (a) { e.preventDefault(); mood.openExternal(a.dataset.link); }
  });

  window.PinterestUI = {
    open(cb) {
      onPick = cb;
      dlg.showModal();
      refresh().catch(e => error(e.message));
    },
  };
})();
