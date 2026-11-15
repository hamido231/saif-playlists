// Saif Playlist Portal web UI (no framework, no build step).
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  // full API address in the provider example (the page may be hosted apart from the API)
  var apiBase = $('#api-base');
  if (apiBase) apiBase.textContent = (window.SAIF_API || location.origin).replace(/\/+$/, '');
  var token = sessionStorage.getItem('lumora.portal.token') || '';
  var deviceId = sessionStorage.getItem('lumora.portal.device') || '';
  var playlists = [];
  var editing = null; // { playlist, pin }

  function show(id) {
    ['#login-view', '#dash-view', '#form-view'].forEach(function (v) { $(v).classList.toggle('hidden', v !== id); });
    $('#session').classList.toggle('hidden', !token);
    $('#session-device').textContent = deviceId;
    window.scrollTo(0, 0);
  }

  var bannerTimer = null;
  function banner(msg, ok) {
    var b = $('#banner');
    b.textContent = msg;
    b.className = 'banner ' + (ok ? 'ok' : 'err');
    clearTimeout(bannerTimer);
    if (ok) bannerTimer = setTimeout(function () { b.classList.add('hidden'); }, 6000);
  }
  function clearBanner() { $('#banner').className = 'banner hidden'; }

  async function api(method, path, body) {
    // API_BASE: '' when the page is served by the portal itself, or the
    // Cloudflare Worker address when the page is hosted on GitHub Pages (config.js).
    var res = await fetch((window.SAIF_API || '') + path, {
      method: method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = {};
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && token) {
      logout();
      throw new Error(data.error || 'Session expired.');
    }
    if (!res.ok) {
      var err = new Error(data.error || 'Request failed (' + res.status + ')');
      err.needPin = !!data.needPin;
      throw err;
    }
    return data;
  }

  function logout() {
    token = '';
    deviceId = '';
    sessionStorage.removeItem('lumora.portal.token');
    sessionStorage.removeItem('lumora.portal.device');
    show('#login-view');
  }

  // ---------- device id input helper: insert colons as the user types
  $('#device-id').addEventListener('input', function (e) {
    var raw = e.target.value.toUpperCase().replace(/[^0-9A-F]/g, '').slice(0, 12);
    e.target.value = raw.match(/.{1,2}/g) ? raw.match(/.{1,2}/g).join(':') : '';
  });
  $('#device-key').addEventListener('input', function (e) { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6); });

  $('#login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearBanner();
    var btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
      var r = await api('POST', '/api/session', { deviceId: $('#device-id').value, deviceKey: $('#device-key').value });
      token = r.token;
      deviceId = r.deviceId;
      sessionStorage.setItem('lumora.portal.token', token);
      sessionStorage.setItem('lumora.portal.device', deviceId);
      $('#device-key').value = '';
      await loadList();
    } catch (err) {
      banner(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });
  $('#logout').addEventListener('click', logout);

  // ---------- list
  async function loadList() {
    var r = await api('GET', '/api/playlists');
    playlists = r.playlists;
    var ul = $('#list');
    ul.innerHTML = '';
    $('#empty').classList.toggle('hidden', playlists.length > 0);
    playlists.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'item';
      li.innerHTML =
        '<div class="meta"><div class="name"></div><div class="host"></div></div>' +
        '<div class="btns"><button class="btn ghost small" data-act="edit">Edit</button><button class="btn danger small" data-act="del">Delete</button></div>';
      var name = li.querySelector('.name');
      name.textContent = p.name + ' ';
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = p.type === 'xtream' ? 'Xtream Codes' : 'M3U';
      name.appendChild(badge);
      if (p.protected) {
        var lock = document.createElement('span');
        lock.className = 'badge lock';
        lock.textContent = 'PIN protected';
        name.appendChild(lock);
      }
      li.querySelector('.host').textContent = p.host + ' · updated ' + new Date(p.updatedAt).toLocaleString();
      li.querySelector('[data-act=edit]').addEventListener('click', function () { startEdit(p); });
      li.querySelector('[data-act=del]').addEventListener('click', function () { remove(p); });
      ul.appendChild(li);
    });
    show('#dash-view');
  }

  function askPin(reason) {
    return new Promise(function (resolve) {
      var d = $('#pin-dialog');
      $('#pin-reason').textContent = reason;
      var input = d.querySelector('input');
      input.value = '';
      d.returnValue = '';
      d.showModal();
      d.addEventListener('close', function onClose() {
        d.removeEventListener('close', onClose);
        resolve(d.returnValue === 'ok' ? input.value : null);
      });
    });
  }

  async function remove(p) {
    var pin;
    if (p.protected) {
      pin = await askPin('Enter the PIN of "' + p.name + '" to delete it.');
      if (pin === null) return;
    } else if (!confirm('Delete "' + p.name + '" from the TV?')) return;
    try {
      await api('DELETE', '/api/playlists/' + p.id, { currentPin: pin });
      banner('"' + p.name + '" deleted. It will disappear from the TV at the next sync.', true);
      await loadList();
    } catch (err) {
      banner(err.message, false);
    }
  }

  // ---------- form
  var form = $('#pl-form');
  function setType(t) {
    form.querySelectorAll('[data-type]').forEach(function (el) { el.classList.toggle('hidden', el.getAttribute('data-type') !== t); });
  }
  form.querySelectorAll('input[name=type]').forEach(function (r) { r.addEventListener('change', function () { setType(r.value); }); });
  form.protect.addEventListener('change', function () { $('#pin-wrap').classList.toggle('hidden', !form.protect.checked); });

  function openForm(p) {
    form.reset();
    $('#pin-wrap').classList.add('hidden');
    $('#form-title').textContent = p ? 'Edit "' + p.name + '"' : 'Add playlist';
    form.password.placeholder = p && p.hasPassword ? 'Leave empty to keep the saved password' : '';
    if (p) {
      form.name.value = p.name;
      form.querySelector('input[value=' + p.type + ']').checked = true;
      form.url.value = p.url || '';
      form.server.value = p.server || '';
      form.username.value = p.username || '';
      form.epgUrl.value = p.epgUrl || '';
      form.protect.checked = !!p.protected;
      $('#pin-wrap').classList.toggle('hidden', !p.protected);
      form.pin.placeholder = p.protected ? 'Leave empty to keep the current PIN' : '';
    }
    setType(p ? p.type : 'm3u');
    show('#form-view');
    form.name.focus();
  }

  $('#add-btn').addEventListener('click', function () { editing = null; clearBanner(); openForm(null); });
  $('#cancel').addEventListener('click', function () { editing = null; loadList().catch(function (e) { banner(e.message, false); }); });

  async function startEdit(p) {
    clearBanner();
    var full = p;
    var pin;
    if (p.protected) {
      pin = await askPin('Enter the PIN of "' + p.name + '" to view or change it.');
      if (pin === null) return;
      try {
        full = (await api('POST', '/api/playlists/' + p.id + '/unlock', { pin: pin })).playlist;
      } catch (err) {
        return banner(err.message, false);
      }
    }
    editing = { playlist: full, pin: pin };
    openForm(full);
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    clearBanner();
    var type = form.querySelector('input[name=type]:checked').value;
    var body = { name: form.name.value, type: type, epgUrl: form.epgUrl.value };
    if (type === 'm3u') body.url = form.url.value;
    else { body.server = form.server.value; body.username = form.username.value; body.password = form.password.value; }
    if (form.protect.checked && form.pin.value) body.pin = form.pin.value;
    if (form.protect.checked && !form.pin.value && !(editing && editing.playlist.protected)) {
      return banner('Enter a PIN (4–8 digits) or untick "Protect this playlist".', false);
    }
    if (editing && editing.playlist.protected && !form.protect.checked) body.removePin = true;
    var btn = $('#save');
    btn.disabled = true;
    try {
      if (editing) {
        body.currentPin = editing.pin;
        await api('PUT', '/api/playlists/' + editing.playlist.id, body);
        banner('Playlist updated. The TV will reload it at the next sync.', true);
      } else {
        await api('POST', '/api/playlists', body);
        banner('Playlist added. It will appear on the TV within a minute (or press "Sync now" on the TV).', true);
      }
      editing = null;
      await loadList();
    } catch (err) {
      banner(err.message, false);
    } finally {
      btn.disabled = false;
    }
  });

  // ---------- start
  if (token) loadList().catch(function () { logout(); });
  else show('#login-view');
  var q = new URLSearchParams(location.search);
  if (q.get('device')) {
    $('#device-id').value = q.get('device').toUpperCase();
    $('#device-key').focus();
  }
})();
