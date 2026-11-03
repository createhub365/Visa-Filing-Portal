/* Visa Filing Portal - frontend (vanilla JS, hash routing) */
const $app = document.getElementById('app');
const state = { me: null, meta: {}, counts: { in_review: 0, removals: 0 } };

const STATUS_LABEL = { pending: 'Pending', in_review: 'In Review', accepted: 'Accepted', rejected: 'Rejected' };

const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia',
  'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin',
  'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi',
  'Cambodia', 'Cameroon', 'Canada', 'Cape Verde', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia',
  'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Democratic Republic of the Congo',
  'Denmark', 'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany',
  'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong',
  'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Ivory Coast', 'Jamaica',
  'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia',
  'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland',
  'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Schengen (Europe)',
  'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia',
  'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago',
  'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];

// ---------------------------------------------------------------- helpers --
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.textContent = msg;
  document.getElementById('toast').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') { state.me = null; renderLogin(); throw new Error(data.error || 'Please log in'); }
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { toast(e.message, true); throw e; }
}
function statusBadge(st) { return `<span class="badge b-${st}">${STATUS_LABEL[st]}</span>`; }
// <option>s with a placeholder; keeps a saved value that is not in the list
function optionList(list, sel, placeholder) {
  const all = sel && !list.includes(sel) ? [...list, sel] : list;
  return `<option value="">${esc(placeholder)}</option>` + all.map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
}
const countryOptions = sel => optionList(COUNTRIES, sel, 'Select country');
const visaOptions = sel => optionList(state.meta.visa_types, sel, 'Select visa type');
const applicantLabel = t => state.meta.applicant_types?.[t] || '';
function applicantRadios(sel) {
  return `<div class="seg">${Object.entries(state.meta.applicant_types).map(([k, l]) =>
    `<label><input type="radio" name="applicant_type" value="${k}" ${k === sel ? 'checked' : ''} required> ${esc(l)}</label>`).join('')}</div>`;
}
const checklistLabel = c => [c.country, c.visa_type, applicantLabel(c.applicant_type)].filter(Boolean).join(' · ');
async function loadDocTypes() {
  if (!state.docTypes) state.docTypes = (await api('GET', '/api/doc-types')).doc_types;
  return state.docTypes;
}
function progressBar(p) {
  if (!p || !p.total) return '<div class="progress"></div>';
  const w = n => (n / p.total * 100).toFixed(1) + '%';
  return `<div class="progress" title="${p.accepted} accepted, ${p.in_review} in review, ${p.rejected} rejected, ${p.pending} pending">
    <span class="p-acc" style="width:${w(p.accepted)}"></span><span class="p-rev" style="width:${w(p.in_review)}"></span><span class="p-rej" style="width:${w(p.rejected)}"></span></div>`;
}

// ------------------------------------------------------------------ modal --
function modal({ title, body, foot = '', wide = false, onMount }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-bg"><div class="modal ${wide ? 'wide' : ''}">
    <div class="modal-head"><h2>${esc(title)}</h2><button data-close aria-label="Close">×</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div></div>`;
  const bg = root.firstElementChild;
  const close = () => { root.innerHTML = ''; };
  bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) close(); });
  onMount && onMount(bg, close);
  return close;
}
function confirmBox(title, text, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    modal({
      title, body: `<p>${text}</p>`,
      foot: `<button data-close>Cancel</button><button class="${danger ? 'btn-solid-red' : 'btn-primary'}" id="ok">${esc(okLabel)}</button>`,
      onMount: (el, close) => {
        el.querySelector('#ok').onclick = () => { close(); resolve(true); };
        el.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => resolve(false)));
      },
    });
  });
}

// ------------------------------------------------------------------ login --
function renderLogin(error = '') {
  $app.innerHTML = `<div class="login-wrap"><form class="login" id="lf">
    <div class="brand"><span class="logo">✈</span>Visa Filing Portal</div>
    <p class="muted" style="margin:0 0 20px">Sign in with the ID and password given by our office.</p>
    ${canInstall() ? '<button type="button" class="install-inline" id="li">📲 Install as app on this phone</button>' : ''}
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn-primary">Sign in</button></form></div>`;
  document.getElementById('li')?.addEventListener('click', installApp);
  document.getElementById('lf').onsubmit = async e => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('POST', '/api/login', { username: f.get('username'), password: f.get('password') });
      await boot();
    } catch (err) { renderLogin(err.message); }
  };
}

// ------------------------------------------------------------------ shell --
const ICONS = {
  dashboard: '<path d="M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z"/>',
  customers: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .7 3.2 2.5 3.5 5.2"/>',
  staff: '<rect x="4" y="3" width="16" height="18" rx="2.5"/><circle cx="12" cy="10" r="3"/><path d="M7.5 17.5c.8-2 2.4-3 4.5-3s3.7 1 4.5 3"/>',
  checklists: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3.5h6v2.5H9zM8.5 11l1.5 1.5 3-3M8.5 16.5l1.5 1.5 3-3M15 11.5h1M15 17h1"/>',
  reviews: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  removals: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  my: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;

// [hash, label, short label for the phone tab bar, badge count]
function navFor(role) {
  if (role === 'admin') return [
    ['#/dashboard', 'Dashboard', 'Home'], ['#/customers', 'Customers', 'Customers'], ['#/staff', 'Staff', 'Staff'],
    ['#/checklists', 'Checklists', 'Checklists', state.counts.checklist_requests],
    ['#/reviews', 'Review Queue', 'Review', state.counts.in_review], ['#/removals', 'Removal Requests', 'Removals', state.counts.removals],
  ];
  if (role === 'staff') return [['#/dashboard', 'Dashboard', 'Home'], ['#/customers', 'Customers', 'Customers']];
  return [['#/my', 'My Application', 'My Application']];
}
function shell(content) {
  const me = state.me;
  const cur = location.hash.split('/').slice(0, 2).join('/');
  const items = navFor(me.role);
  const isOn = h => cur === h || (h === '#/customers' && cur === '#/customer');
  const title = (items.find(([h]) => isOn(h)) || items[0])[1];
  const badge = n => (n ? `<span class="count">${n}</span>` : '');
  const nav = items.map(([h, l, , n]) => `<a href="${h}" class="${isOn(h) ? 'active' : ''}">${icon(h.slice(2))}<span class="lbl">${l}</span>${badge(n)}</a>`).join('');
  const tabs = items.map(([h, , s, n]) => `<a href="${h}" class="${isOn(h) ? 'active' : ''}">${icon(h.slice(2))}<span>${s}</span>${badge(n)}</a>`).join('');
  $app.innerHTML = `<div class="shell">
    <header class="appbar"><span class="logo">✈</span><span class="appbar-title">${esc(title)}</span>
      <button class="avatar" id="acct" aria-label="Account">${esc(me.full_name.trim()[0] || '?').toUpperCase()}</button></header>
    <aside class="sidebar">
      <div class="brand"><span class="logo">✈</span>Visa Portal</div>
      <nav class="nav">${nav}</nav>
      <div class="who"><b>${esc(me.full_name)}</b><span class="badge b-role">${esc(me.role)}</span>
        <button id="pw">Change password</button><button id="logout">Log out</button></div>
    </aside>
    <main class="main" id="main">${content}</main>
    ${items.length > 1 ? `<nav class="tabbar">${tabs}</nav>` : ''}</div>`;
  document.getElementById('logout').onclick = logout;
  document.getElementById('pw').onclick = changePasswordModal;
  document.getElementById('acct').onclick = accountSheet;
  document.body.classList.toggle('has-tabbar', items.length > 1);
  return document.getElementById('main');
}
async function logout() {
  await api('POST', '/api/logout');
  state.me = null; location.hash = ''; renderLogin();
}
// phone: account menu as a bottom sheet
function accountSheet() {
  const me = state.me;
  modal({
    title: me.full_name,
    body: `<div class="muted" style="margin:-6px 0 14px">@${esc(me.username)} · <span class="badge b-role">${esc(me.role)}</span></div>
      <div class="sheet-list">
        ${canInstall() ? '<button id="s-inst">📲 Install app on this phone</button>' : ''}
        <button id="s-pw">🔑 Change password</button>
        <button id="s-out" class="btn-red">↩ Log out</button></div>`,
    onMount: (el, close) => {
      el.querySelector('#s-pw').onclick = () => { close(); changePasswordModal(); };
      el.querySelector('#s-out').onclick = () => { close(); logout(); };
      const inst = el.querySelector('#s-inst');
      if (inst) inst.onclick = () => { close(); installApp(); };
    },
  });
}

// ------------------------------------------------------- install as app --
let installEvent = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const UA = navigator.userAgent;
const isIOS = () => /iphone|ipad|ipod/i.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(UA);
// in-app browsers (WhatsApp, Instagram, Facebook...) cannot install apps
const isInAppBrowser = () => /FBAN|FBAV|Instagram|Line\/|WhatsApp|Snapchat|; wv\)/i.test(UA);
const isMobile = () => isIOS() || isAndroid();
// Phones always get the option: the browser's own prompt when it offers one, otherwise step-by-step help
const canInstall = () => !isStandalone() && (installEvent || isMobile());
function installSteps() {
  if (isInAppBrowser()) return { title: 'Open in your browser first', steps: [
    'This page is open inside another app (WhatsApp, Instagram…), which cannot install apps.',
    `Tap the menu <span class="kbd">⋮</span> or <span class="kbd">•••</span> and choose <b>Open in ${isIOS() ? 'Safari' : 'Chrome'}</b>.`,
    'Then tap <b>Install</b> on the banner at the bottom.'] };
  if (isIOS()) return { title: 'Install on iPhone / iPad', steps: [
    `Tap the <b>Share</b> button <span class="kbd">⬆︎</span> (bottom of Safari, or top-right in Chrome).`,
    'Scroll and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. The Visa Portal icon appears on your home screen.'] };
  if (/SamsungBrowser/i.test(UA)) return { title: 'Install on Samsung Internet', steps: [
    'Tap the menu <span class="kbd">≡</span> at the bottom right.', 'Tap <b>Add page to</b> → <b>Home screen</b>.',
    'Tap <b>Add</b>. Open Visa Portal from the new icon.'] };
  return { title: 'Install on Android', steps: [
    'Tap the Chrome menu <span class="kbd">⋮</span> at the top right.',
    'Tap <b>Install app</b> (or <b>Add to Home screen</b> → <b>Install</b>).',
    'Open Visa Portal from the new icon on your home screen.'] };
}
function installApp() {
  if (installEvent) {
    installEvent.prompt();
    installEvent.userChoice.finally(() => { installEvent = null; hideInstallBanner(); });
    return;
  }
  const { title, steps } = installSteps();
  modal({
    title,
    body: `<ol class="steps">${steps.map(s => `<li>${s}</li>`).join('')}</ol>`,
    foot: '<button class="btn-primary" data-close>Got it</button>',
  });
}
function showInstallBanner() {
  let dismissed = false;
  try { dismissed = sessionStorage.getItem('install-dismissed') === '1'; } catch { /* storage blocked */ }
  if (dismissed || !canInstall() || document.getElementById('install')) return;
  const el = document.createElement('div');
  el.id = 'install';
  el.innerHTML = `<span class="logo">✈</span><div style="flex:1"><b>Install Visa Portal</b><div class="small">Open it like an app from your home screen</div></div>
    <button class="btn-primary btn-sm" id="inst-go">Install</button><button class="x" id="inst-x" aria-label="Close">×</button>`;
  document.body.appendChild(el);
  el.querySelector('#inst-go').onclick = installApp;
  el.querySelector('#inst-x').onclick = () => {
    try { sessionStorage.setItem('install-dismissed', '1'); } catch { /* storage blocked */ }
    hideInstallBanner();
  };
}
function hideInstallBanner() { document.getElementById('install')?.remove(); }
// Not calling preventDefault() lets Chrome show its own install bar automatically;
// we also keep the event so our banner's Install button opens the same one-tap prompt.
window.addEventListener('beforeinstallprompt', e => { installEvent = e; showInstallBanner(); });
window.addEventListener('appinstalled', () => { installEvent = null; hideInstallBanner(); toast('App installed'); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));

// phone: tables become cards; each cell gets its column name as a label
new MutationObserver(() => {
  document.querySelectorAll('table:not([data-labeled])').forEach(t => {
    t.dataset.labeled = '1';
    const heads = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    t.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => { if (heads[i]) td.dataset.label = heads[i]; }));
  });
}).observe(document.getElementById('app'), { childList: true, subtree: true });
function changePasswordModal() {
  modal({
    title: 'Change password',
    body: `<div class="field"><label>Current password</label><input type="password" id="cp1"></div>
           <div class="field"><label>New password (min 6 chars)</label><input type="password" id="cp2"></div>`,
    foot: `<button data-close>Cancel</button><button class="btn-primary" id="save">Update</button>`,
    onMount: (el, close) => el.querySelector('#save').onclick = () =>
      run(() => api('POST', '/api/me/password', { current: el.querySelector('#cp1').value, new: el.querySelector('#cp2').value }), 'Password updated').then(close),
  });
}
async function refreshCounts() {
  if (!['admin', 'staff'].includes(state.me?.role)) return;
  const s = await api('GET', '/api/stats');
  state.counts = s;
  return s;
}

// ----------------------------------------------------------------- router --
async function route() {
  if (!state.me) return renderLogin();
  const [, page, id] = location.hash.split('/');
  const role = state.me.role;
  const home = { admin: 'dashboard', staff: 'dashboard', customer: 'my' }[role];
  try {
    await refreshCounts();
    if (role === 'customer') return renderMy();
    switch (page) {
      case 'dashboard': return renderDashboard();
      case 'customers': return renderUserList('customer');
      case 'staff': if (role === 'admin') return renderUserList('staff'); break;
      case 'customer': if (id) return renderCustomer(+id); break;
      case 'checklists': if (role === 'admin') return renderChecklists(); break;
      case 'reviews': if (role === 'admin') return renderReviews(); break;
      case 'removals': if (role === 'admin') return renderRemovals(); break;
    }
    location.hash = '#/' + home;
  } catch (e) { if (state.me) shell(`<div class="card error">${esc(e.message)}</div>`); }
}
window.addEventListener('hashchange', route);

async function boot() {
  try {
    const data = await api('GET', '/api/me');
    state.me = data.user;
    state.meta = data;
    route();
  } catch { renderLogin(); }
}

// --------------------------------------------------------------- dashboard --
async function renderDashboard() {
  const s = state.counts, isAdmin = state.me.role === 'admin';
  const stat = (n, label, color, href) => {
    const inner = `<div class="n"${color ? ` style="color:${color}"` : ''}>${n}</div><div class="l">${label}</div>`;
    return href ? `<a class="stat" href="${href}">${inner}</a>` : `<div class="stat">${inner}</div>`;
  };
  const cards = isAdmin ? [
    stat(s.in_review, 'Documents to review', 'var(--amber)', '#/reviews'),
    stat(s.removals, 'Removal requests', 'var(--purple)', '#/removals'),
    stat(s.checklist_requests, 'Checklist requests', 'var(--amber)', '#/checklists'),
    stat(s.customers, 'Customers', '', '#/customers'),
    stat(s.staff, 'Staff', '', '#/staff'),
    stat(s.accepted, 'Docs accepted', 'var(--green)'),
    stat(s.rejected, 'Docs rejected', 'var(--red)'),
    stat(s.pending, 'Docs not uploaded', 'var(--muted)'),
  ] : [
    stat(s.customers, 'Customers', '', '#/customers'),
    stat(s.no_checklist, 'Waiting for checklist', 'var(--amber)'),
    stat(s.pending, 'Docs not uploaded', 'var(--muted)'),
    stat(s.rejected, 'Rejected – need re-upload', 'var(--red)'),
    stat(s.in_review, 'Waiting for admin review', 'var(--amber)'),
    stat(s.accepted, 'Docs accepted', 'var(--green)'),
  ];
  const main = shell(`<div class="page-head"><h1>${isAdmin ? 'Dashboard' : `Welcome, ${esc(state.me.full_name.split(' ')[0])}`}</h1>
      <button class="btn-primary" id="newc">+ New customer</button></div>
    <div class="stats">${cards.join('')}</div>
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Needs re-upload</h2><span class="small muted">Customers with rejected documents</span></div><div id="attn"><div class="empty">Loading…</div></div></div>
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>Recent customers</h2><a href="#/customers">View all →</a></div><div id="recent"></div></div>`);
  main.querySelector('#newc').onclick = newCustomer;
  const { users } = await api('GET', '/api/users?role=customer');
  const attn = users.filter(u => u.progress.rejected > 0);
  main.querySelector('#attn').innerHTML = attn.length ? customerTable(attn) : '<div class="empty">No rejected documents right now.</div>';
  main.querySelector('#recent').innerHTML = customerTable(users.slice(0, 8));
  bindRowClicks(main);
}

// --------------------------------------------------------------- user list --
function customerTable(users) {
  if (!users.length) return `<div class="empty">No customers yet.</div>`;
  return `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Passport</th><th>Visa / Country</th><th>Stage</th><th style="width:170px">Documents</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr class="click" data-href="#/customer/${u.id}">
      <td><b>${esc(u.full_name)}</b><div class="small muted">@${esc(u.username)}</div></td>
      <td>${esc(u.passport_no) || '<span class="muted">—</span>'}</td>
      <td>${esc(u.visa_type) || '—'}<div class="small muted">${esc(u.country)}${u.applicant_type ? ' · ' + esc(applicantLabel(u.applicant_type).split(' ')[0]) : ''}</div></td>
      <td><span class="small">${esc(u.stage)}</span></td>
      <td>${!u.progress.total ? '<span class="badge b-in_review">No checklist</span>' : `${progressBar(u.progress)}<div class="small muted" style="margin-top:3px">${u.progress.accepted}/${u.progress.total} accepted${u.progress.in_review ? ` · <span style="color:var(--amber)">${u.progress.in_review} to review</span>` : ''}${u.progress.rejected ? ` · <span style="color:var(--red)">${u.progress.rejected} rejected</span>` : ''}</div>`}</td>
      <td>${u.active ? '' : '<span class="badge b-off">Disabled</span>'}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function bindRowClicks(root) {
  root.querySelectorAll('tr[data-href]').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
}
async function renderUserList(role) {
  const canCreate = state.me.role === 'admin' || role === 'customer';
  const main = shell(`<div class="page-head"><h1>${role === 'customer' ? 'Customers' : 'Staff'}</h1>
      <div class="toolbar"><input id="q" placeholder="Search name, username, passport…">
      ${canCreate ? `<button class="btn-primary" id="new">+ New ${role}</button>` : ''}</div></div>
    <div class="card" id="list"><div class="empty">Loading…</div></div>`);
  if (canCreate) main.querySelector('#new').onclick = () => (role === 'customer' ? newCustomer() : userFormModal(role));
  const { users } = await api('GET', `/api/users?role=${role}`);
  const draw = () => {
    const q = main.querySelector('#q').value.toLowerCase();
    const list = users.filter(u => [u.full_name, u.username, u.passport_no, u.email, u.phone].join(' ').toLowerCase().includes(q));
    const box = main.querySelector('#list');
    if (role === 'customer') { box.innerHTML = customerTable(list); bindRowClicks(box); return; }
    box.innerHTML = !list.length ? `<div class="empty">No staff yet.</div>` :
      `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email / Phone</th><th>Status</th><th></th></tr></thead><tbody>
      ${list.map(u => `<tr><td><b>${esc(u.full_name)}</b></td><td>@${esc(u.username)}</td>
        <td>${esc(u.email)}<div class="small muted">${esc(u.phone)}</div></td>
        <td>${u.active ? '<span class="badge b-accepted">Active</span>' : '<span class="badge b-off">Disabled</span>'}</td>
        <td style="text-align:right"><button class="btn-sm" data-edit="${u.id}">Edit</button></td></tr>`).join('')}
      </tbody></table></div>`;
    box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => userFormModal('staff', users.find(u => u.id === +b.dataset.edit)));
  };
  main.querySelector('#q').oninput = draw;
  draw();
}

// ------------------------------------------------------- create/edit user --
// prefill: values for a new user (e.g. from "Auto-fetch from documents")
function userFormModal(role, user = null, prefill = {}) {
  const m = state.meta;
  const src = user || prefill;
  const v = k => esc(src[k] ?? '');
  const isCust = role === 'customer';
  const opts = (list, sel) => list.map(o => `<option ${o === sel ? 'selected' : ''}>${esc(o)}</option>`).join('');
  const body = `<form id="uf" class="grid2">
    <div class="section-label">Login</div>
    <div class="field"><label>Username *</label><input name="username" value="${v('username')}" ${user ? 'disabled' : 'required'}></div>
    <div class="field"><label>${user ? 'New password (leave blank to keep)' : 'Password *'}</label>
      <input name="password" ${user ? '' : 'required'} placeholder="min 6 characters" value="${user ? '' : genPassword()}"></div>
    <div class="section-label">Details</div>
    <div class="field span2"><label>Full name (as on passport) *</label><input name="full_name" value="${v('full_name')}" required></div>
    <div class="field"><label>Email</label><input name="email" type="email" value="${v('email')}"></div>
    <div class="field"><label>Phone</label><input name="phone" value="${v('phone')}"></div>
    ${isCust ? `
      <div class="field"><label>Passport number</label><input name="passport_no" value="${v('passport_no')}" style="text-transform:uppercase"></div>
      <div class="field"><label>Passport expiry</label><input name="passport_expiry" type="date" value="${v('passport_expiry')}"></div>
      <div class="field"><label>Date of birth</label><input name="dob" type="date" value="${v('dob')}"></div>
      <div class="field"><label>Nationality</label><input name="nationality" value="${v('nationality') || (user ? '' : 'Indian')}"></div>
      <div class="field span2"><label>Address</label><textarea name="address" rows="2" style="min-height:0">${v('address')}</textarea></div>
      <div class="field"><label>Application stage</label><select name="stage">${opts(m.stages, user?.stage || m.stages[0])}</select></div>
      <div class="section-label">Visa &amp; checklist</div>
      <div class="field"><label>Destination country *</label><select name="country" required>${countryOptions(src.country)}</select></div>
      <div class="field"><label>Visa type *</label><select name="visa_type" required>${visaOptions(src.visa_type)}</select></div>
      <div class="field span2"><label>Applicant *</label>${applicantRadios(src.applicant_type)}</div>
      <div class="field span2" id="clhint"></div>
      <div class="field span2"><label>Notes for customer</label><textarea name="notes" placeholder="Visible to the customer on their portal">${v('notes')}</textarea></div>
    ` : ''}
    ${user ? `<div class="field span2"><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="active" style="width:auto" ${user.active ? 'checked' : ''}> Account active (can log in)</label></div>` : ''}
  </form>`;
  modal({
    title: user ? `Edit ${role}` : `New ${role}`, body,
    foot: `<button data-close>Cancel</button><button class="btn-primary" id="save">${user ? 'Save changes' : 'Create ' + role}</button>`,
    onMount: (el, close) => {
      const form = el.querySelector('#uf');
      if (isCust) {
        // live hint: does a checklist exist for the chosen country + visa type + applicant?
        let lists = null;
        const hint = async () => {
          const f = Object.fromEntries(new FormData(form));
          const box = el.querySelector('#clhint');
          if (!f.country || !f.visa_type || !f.applicant_type) { box.innerHTML = ''; return; }
          lists = lists || (await api('GET', '/api/checklists')).checklists;
          const found = lists.find(c => c.country === f.country && c.visa_type === f.visa_type && c.applicant_type === f.applicant_type);
          box.innerHTML = user
            ? `<div class="hint">Changing these does not change existing documents. ${found ? 'Use <b>Apply checklist</b> on the customer page to add missing ones.' : ''}</div>`
            : found
              ? `<div class="hint ok">✓ Checklist found: ${found.items.length} documents will be added automatically.</div>`
              : `<div class="hint warn">⚠ No checklist yet for <b>${esc(checklistLabel(f))}</b>. The customer will still be created; you can then request the admin to create the checklist.</div>`;
        };
        form.addEventListener('change', e => { if (['country', 'visa_type', 'applicant_type'].includes(e.target.name)) hint(); });
        hint();
      }
      el.querySelector('#save').onclick = async () => {
        if (!form.reportValidity()) return;
        const f = Object.fromEntries(new FormData(form));
        if (f.passport_no) f.passport_no = f.passport_no.toUpperCase();
        if (user) {
          f.active = form.querySelector('[name=active]').checked;
          if (!f.password) delete f.password;
          delete f.username;
          await run(() => api('PUT', `/api/users/${user.id}`, f), 'Saved');
          close(); route();
        } else {
          f.role = role;
          const creds = { u: f.username, p: f.password };
          const r = await run(() => api('POST', '/api/users', f));
          close();
          credentialsModal(creds, f.full_name, role, r.id, r.checklist);
        }
      };
    },
  });
}
// ------------------------------------------- new customer: manual or auto
function newCustomer() {
  modal({
    title: 'New customer',
    body: `<p class="muted" style="margin-top:0">How do you want to add the customer?</p>
      <div class="mode-choice">
        <button data-mode="auto"><span class="ic">⚡</span><b>Auto-fetch from documents</b>
          <span>Upload or click a photo of the passport. AI reads name, passport no., DOB, address… and fills the form.</span></button>
        <button data-mode="manual"><span class="ic">✍️</span><b>Manual entry</b><span>Type all the details yourself.</span></button>
      </div>`,
    onMount: (el, close) => el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      close();
      if (b.dataset.mode === 'auto') autoFetchCustomer(); else userFormModal('customer');
    }),
  });
}

// Shrink photos before upload (faster, and well within the AI's limits)
async function imageToDataURL(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

// Full-screen camera; resolves with a JPEG blob, or null if cancelled
function openCamera() {
  return new Promise(async resolve => {
    if (!navigator.mediaDevices?.getUserMedia) { // older phones: the system camera through a file input
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
      inp.onchange = () => resolve(inp.files[0] || null);
      inp.click();
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (e) {
      toast(e.name === 'NotAllowedError' ? 'Camera permission denied. Allow camera access in the browser.' : 'Camera not available on this device', true);
      return resolve(null);
    }
    const ov = document.createElement('div');
    ov.className = 'cam';
    ov.innerHTML = `<video autoplay playsinline muted></video>
      <div class="cam-frame"><span>Fit the passport page inside the frame · good light, no glare</span></div>
      <div class="cam-bar"><button data-cam="x">Cancel</button><button class="cam-shot" data-cam="go" aria-label="Take photo"></button><span class="cam-gap"></span></div>`;
    document.body.appendChild(ov);
    const video = ov.querySelector('video');
    video.srcObject = stream;
    const done = blob => { stream.getTracks().forEach(t => t.stop()); ov.remove(); resolve(blob); };
    ov.querySelector('[data-cam=x]').onclick = () => done(null);
    ov.querySelector('[data-cam=go]').onclick = () => {
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      c.toBlob(b => done(b), 'image/jpeg', 0.92);
    };
  });
}

// Passport machine-readable zone (ICAO TD3). Fields are trusted only when their check digit is valid.
function parseMRZ(l1, l2) {
  const clean = s => (s || '').toUpperCase().replace(/\s+/g, '').replace(/[«‹]/g, '<');
  l1 = clean(l1); l2 = clean(l2);
  const m = l2.match(/^([A-Z0-9<]{9})(\d)([A-Z<]{3})(\d{6})(\d)([MFX<])(\d{6})(\d)/);
  if (!m) return null;
  const val = c => (c === '<' ? 0 : /\d/.test(c) ? +c : c.charCodeAt(0) - 55);
  const ok = (s, d) => [...s].reduce((t, c, i) => t + val(c) * [7, 3, 1][i % 3], 0) % 10 === +d;
  const yy = new Date().getFullYear() % 100;
  const date = (s, past) => { const y = +s.slice(0, 2); return `${(past ? (y > yy ? 1900 : 2000) : 2000) + y}-${s.slice(2, 4)}-${s.slice(4, 6)}`; };
  const names = l1.startsWith('P') ? l1.slice(5).split('<<') : [];
  return {
    surname: (names[0] || '').replace(/</g, ' ').trim(), given: (names[1] || '').replace(/</g, ' ').trim(),
    passport_no: ok(m[1], m[2]) ? m[1].replace(/</g, '') : null,
    nationality: m[3].replace(/</g, ''),
    dob: ok(m[4], m[5]) ? date(m[4], true) : null,
    expiry: ok(m[7], m[8]) ? date(m[7], false) : null,
  };
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, ch => ch.toUpperCase());
function isoDate(s) {
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // DD/MM/YYYY as printed on Indian documents
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}
const NATIONALITY = { IND: 'Indian', INDIAN: 'Indian', NPL: 'Nepalese', BGD: 'Bangladeshi', LKA: 'Sri Lankan', PAK: 'Pakistani' };

// Auto-fetch: country / visa / applicant → document photos → AI OCR → review → pre-filled customer form
function autoFetchCustomer() {
  const images = []; // { name, data, kb }
  modal({
    title: '⚡ Auto-fetch customer details', wide: true,
    body: `<div id="af-1">
        <div class="step-h"><span>1</span>Visa</div>
        <div class="grid3">
          <div class="field"><label>Destination country *</label><select id="af-c">${countryOptions('')}</select></div>
          <div class="field"><label>Visa type *</label><select id="af-v">${visaOptions('')}</select></div>
          <div class="field"><label>Applicant *</label><select id="af-a">${optionList([], '', 'Select applicant')}
            ${Object.entries(state.meta.applicant_types).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select></div>
        </div>
        <div class="step-h"><span>2</span>Documents</div>
        <div class="af-docs">
          <label class="drop"><input type="file" accept="image/*" multiple hidden id="af-file">
            <span class="ic">📄</span><b>Upload passport photo / scan</b><span class="small muted">Front page + address page · JPG, PNG</span></label>
          <button type="button" class="drop" id="af-cam"><span class="ic">📷</span><b>Open camera</b><span class="small muted">Click a photo of the passport page</span></button>
        </div>
        <div class="thumbs" id="af-thumbs"></div>
        <p class="small muted" style="margin:8px 0 0">Photos are sent to Cloudflare Workers AI only to read the text. They are not saved.</p>
        <div class="ai-console" id="af-con" hidden><div class="ai-head"><span class="dot"></span><b>Document reader</b><span class="small" id="af-model"></span></div>
          <div class="ai-log" id="af-log"></div></div>
      </div>
      <div id="af-2" hidden></div>`,
    foot: `<button data-close>Cancel</button><button class="btn-ai" id="af-go" disabled>🔍 Extract details</button>`,
    onMount: (el, close) => {
      const $ = s => el.querySelector(s);
      const sel = () => ({ country: $('#af-c').value, visa_type: $('#af-v').value, applicant_type: $('#af-a').value });
      const canGo = () => { const k = sel(); $('#af-go').disabled = !(k.country && k.visa_type && k.applicant_type && images.length); };
      ['#af-c', '#af-v', '#af-a'].forEach(s => $(s).addEventListener('change', canGo));
      const drawThumbs = () => {
        $('#af-thumbs').innerHTML = images.map((im, i) => `<div class="thumb"><img src="${im.data}" alt=""><span>${esc(im.name)}</span>
          <button data-rm="${i}" aria-label="Remove">×</button></div>`).join('');
        el.querySelectorAll('.thumb [data-rm]').forEach(b => b.onclick = () => { images.splice(+b.dataset.rm, 1); drawThumbs(); canGo(); });
        canGo();
      };
      const addFile = async (file, name) => {
        if (images.length >= 4) return toast('Up to 4 photos', true);
        try {
          const data = await imageToDataURL(file);
          images.push({ name: name || file.name || 'Photo', data, kb: Math.round(file.size / 1024), outKb: Math.round(data.length * 3 / 4 / 1024) });
          drawThumbs();
        } catch { toast('Could not open this image. Use JPG or PNG.', true); }
      };
      $('#af-file').onchange = async e => { for (const f of e.target.files) await addFile(f); e.target.value = ''; };
      $('#af-cam').onclick = async () => { const blob = await openCamera(); if (blob) addFile(blob, `Camera photo ${images.length + 1}`); };

      let t0 = 0;
      const log = (msg, cls = '') => {
        const line = document.createElement('div');
        line.className = 'l ' + cls;
        line.innerHTML = `<span class="t">${((performance.now() - t0) / 1000).toFixed(1).padStart(5)}s</span> ${msg}`;
        $('#af-log').appendChild(line);
        $('#af-log').scrollTop = $('#af-log').scrollHeight;
      };
      const LABELS = { full_name: 'Name', passport_no: 'Passport no.', dob: 'Date of birth', date_of_expiry: 'Expiry', nationality: 'Nationality', address: 'Address' };

      $('#af-go').onclick = async () => {
        const k = sel();
        $('#af-go').disabled = true;
        $('#af-con').hidden = false; $('#af-con').classList.add('busy'); $('#af-log').innerHTML = '';
        t0 = performance.now();
        const merged = {};
        let mrz = null;
        log('▶ Starting document reading');
        log(`• Visa: <b>${esc(checklistLabel(k))}</b> · ${images.length} photo(s)`);
        try {
          for (const [i, im] of images.entries()) {
            log(`• Photo ${i + 1}/${images.length} "${esc(im.name)}" · optimised ${im.kb} KB → ${im.outKb} KB`);
            log('• Sending to Cloudflare Workers AI vision model…');
            const t = performance.now();
            const r = await api('POST', '/api/ai/extract', { image: im.data });
            $('#af-model').textContent = r.model;
            const keys = Object.keys(r.fields);
            log(`✓ ${esc(r.model.split('/').pop())} read the photo in ${((performance.now() - t) / 1000).toFixed(1)}s · ${keys.length} fields found`, 'ok');
            for (const [f, label] of Object.entries(LABELS)) if (r.fields[f]) log(`&nbsp;&nbsp;${label}: <b>${esc(r.fields[f])}</b>`, 'dim');
            for (const f of keys) if (!merged[f]) merged[f] = r.fields[f];
            if (!mrz && r.fields.mrz_line2) mrz = parseMRZ(r.fields.mrz_line1, r.fields.mrz_line2);
          }
          if (mrz) {
            const okN = ['passport_no', 'dob', 'expiry'].filter(f => mrz[f]).length;
            log(okN ? `✓ Passport MRZ check digits verified for ${okN} of 3 fields` : '• MRZ found but check digits did not match; using printed details', okN ? 'ok' : 'warn');
          } else {
            log('• No readable MRZ (bottom lines of the passport); using printed details');
          }
          log('✓ Done. Review the details below.', 'ok');
        } catch (e) {
          log(`✕ ${esc(e.message)}`, 'err');
          $('#af-con').classList.remove('busy');
          $('#af-go').disabled = false;
          if (!Object.keys(merged).length) return;
        }
        $('#af-con').classList.remove('busy');
        showReview(k, merged, mrz);
      };

      // Step 3: review and correct what the AI read
      const showReview = (k, f, mrz) => {
        const name = f.full_name || [f.given_names, f.surname].filter(Boolean).join(' ') || (mrz ? `${mrz.given} ${mrz.surname}`.trim() : '');
        const nat = (f.nationality || mrz?.nationality || '').toUpperCase();
        const vals = {
          full_name: { v: name ? titleCase(name) : '' },
          passport_no: mrz?.passport_no ? { v: mrz.passport_no, ok: true } : { v: (f.passport_no || '').toUpperCase().replace(/\s/g, '') },
          dob: mrz?.dob ? { v: mrz.dob, ok: true } : { v: isoDate(f.dob) },
          passport_expiry: mrz?.expiry ? { v: mrz.expiry, ok: true } : { v: isoDate(f.date_of_expiry) },
          nationality: { v: NATIONALITY[nat] || (nat ? titleCase(nat) : '') },
          address: { v: f.address ? titleCase(f.address) : '' },
        };
        const badge = x => (x.ok ? '<span class="src ok">✓ MRZ verified</span>' : x.v ? '<span class="src ai">AI read</span>' : '<span class="src miss">not found</span>');
        const field = (key, label, type = 'text') => `<div class="field"><label>${label} ${badge(vals[key])}</label>
          ${type === 'area' ? `<textarea id="rv-${key}" rows="2" style="min-height:0">${esc(vals[key].v)}</textarea>`
            : `<input id="rv-${key}" type="${type}" value="${esc(vals[key].v)}">`}</div>`;
        const exp = vals.passport_expiry.v ? new Date(vals.passport_expiry.v) : null;
        const sixMonths = new Date(); sixMonths.setMonth(sixMonths.getMonth() + 6);
        $('#af-1').hidden = true;
        $('#af-2').hidden = false;
        $('#af-2').innerHTML = `<div class="step-h"><span>3</span>Review details</div>
          <p class="muted small" style="margin-top:0">Check every field against the passport and correct anything the AI misread.</p>
          ${exp && exp < sixMonths ? `<div class="hint warn" style="margin-bottom:12px">⚠ Passport expires on ${esc(vals.passport_expiry.v)}, less than 6 months from today. Most countries require 6 months validity.</div>` : ''}
          <div class="grid2">${field('full_name', 'Full name')}${field('passport_no', 'Passport number')}
            ${field('dob', 'Date of birth', 'date')}${field('passport_expiry', 'Passport expiry', 'date')}
            ${field('nationality', 'Nationality')}<div class="field"><label>Visa</label><div class="hint">${esc(checklistLabel(k))}</div></div>
            <div class="span2">${field('address', 'Address', 'area')}</div></div>`;
        $('#af-go').disabled = false;
        $('#af-go').className = 'btn-primary';
        $('#af-go').textContent = '✓ Done · fill the form';
        $('#af-go').onclick = () => {
          const g = id => $(`#rv-${id}`).value.trim();
          const first = (g('full_name').split(/\s+/)[0] || 'customer').toLowerCase().replace(/[^a-z0-9]/g, '');
          const last = (g('full_name').split(/\s+/).slice(-1)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          const prefill = {
            ...k, full_name: g('full_name'), passport_no: g('passport_no').toUpperCase(), dob: g('dob'),
            passport_expiry: g('passport_expiry'), nationality: g('nationality'), address: g('address'),
            username: `${first}${last && last !== first ? '.' + last : ''}${Math.floor(10 + Math.random() * 90)}`.slice(0, 40),
          };
          close();
          userFormModal('customer', null, prefill);
          toast('Details filled. Add phone / email and press Create customer.');
        };
      };
    },
  });
}

function genPassword() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(10)), n => chars[n % chars.length]).join('');
}
function credentialsModal({ u, p }, name, role, id, checklist = 0) {
  const text = `Visa Portal login\nURL: ${location.origin}\nUsername: ${u}\nPassword: ${p}`;
  const cl = role !== 'customer' ? '' : checklist
    ? `<div class="hint ok">✓ Checklist applied: ${checklist} documents.</div>`
    : `<div class="hint warn">⚠ No checklist exists for this country / visa type / applicant yet. Open the customer and
        ${state.me.role === 'admin' ? 'create the checklist.' : 'press <b>Request admin to create checklist</b>.'}</div>`;
  modal({
    title: `${role === 'customer' ? 'Customer' : 'Staff'} created`,
    body: `<p><b>${esc(name)}</b> can now log in. Share these credentials with them — the password is not shown again.</p>
      <pre style="background:var(--gray-soft);padding:12px;border-radius:8px;white-space:pre-wrap">${esc(text)}</pre>${cl}`,
    foot: `<button id="copy">Copy</button><button class="btn-primary" id="go">${role === 'customer' ? 'Open customer' : 'Done'}</button>`,
    onMount: (el, close) => {
      el.querySelector('#copy').onclick = () => navigator.clipboard.writeText(text).then(() => toast('Copied'));
      el.querySelector('#go').onclick = () => { close(); if (role === 'customer') location.hash = `#/customer/${id}`; else route(); };
    },
  });
}

// --------------------------------------------------------- customer page --
function stageTracker(stage) {
  const stages = state.meta.stages.filter(s => s !== 'Visa Rejected');
  const finalRejected = stage === 'Visa Rejected';
  const idx = finalRejected ? stages.length - 1 : stages.indexOf(stage);
  return `<div class="stages">${stages.map((s, i) => {
    const label = finalRejected && i === stages.length - 1 ? 'Visa Rejected' : s;
    const cls = i < idx ? 'done' : i === idx ? 'current' : '';
    return `<div class="stage ${cls}"><div class="dot">${i < idx ? '✓' : ''}</div>${esc(label)}</div>`;
  }).join('')}</div>`;
}
function profileCard(c, editable) {
  const f = (k, l) => `<div><div class="k">${l}</div><div class="v">${esc(c[k]) || '<span class="muted">—</span>'}</div></div>`;
  return `<div class="card">
    <div class="page-head" style="margin-bottom:14px"><div><h2>${esc(c.full_name)}</h2><div class="muted small">@${esc(c.username)}${c.active ? '' : ' · <span class="badge b-off">Disabled</span>'}</div></div>
      ${editable ? `<button id="editc">Edit details</button>` : ''}</div>
    <div class="profile">${f('passport_no', 'Passport number')}${f('visa_type', 'Visa / Process')}${f('country', 'Destination')}
      <div><div class="k">Applicant</div><div class="v">${esc(applicantLabel(c.applicant_type)) || '<span class="muted">—</span>'}</div></div>
      ${f('passport_expiry', 'Passport expiry')}${f('nationality', 'Nationality')}${f('dob', 'Date of birth')}${f('phone', 'Phone')}${f('email', 'Email')}
      ${c.address ? `<div style="grid-column:1/-1"><div class="k">Address</div><div class="v">${esc(c.address)}</div></div>` : ''}</div>
    <div style="margin-top:20px">${stageTracker(c.stage)}</div>
    ${c.notes ? `<div style="margin-top:16px;background:var(--primary-soft);padding:10px 12px;border-radius:8px"><b>Note from office:</b> ${esc(c.notes)}</div>` : ''}
  </div>`;
}
function docCard(it, role) {
  const isAdmin = role === 'admin';
  const rr = it.removal_request;
  const canUpload = !rr && (it.status === 'pending' || it.status === 'rejected');
  const btn = [];
  if (it.has_file) btn.push(`<button class="btn-sm" data-act="view">View</button>`);
  if (canUpload) btn.push(`<button class="btn-sm btn-primary" data-act="upload">${it.status === 'rejected' ? '⟳ Re-upload' : '⬆ Upload'}</button>`);
  if (isAdmin && it.status === 'in_review') btn.push(`<button class="btn-sm btn-green" data-act="accept">✓ Accept</button><button class="btn-sm btn-red" data-act="reject">✕ Reject</button>`);
  if (it.has_file && !rr) btn.push(isAdmin ? `<button class="btn-sm btn-red" data-act="remove">Remove</button>`
    : `<button class="btn-sm btn-red" data-act="reqremove">Remove</button>`);
  if (isAdmin && rr) btn.push(`<button class="btn-sm btn-green" data-act="approve-rm">Approve removal</button><button class="btn-sm" data-act="deny-rm">Deny</button>`);
  if (isAdmin) btn.push(`<button class="btn-sm" data-act="delete" title="Delete checklist item">🗑</button>`);

  const reasons = [...it.reject_reasons, ...(it.reject_note ? [it.reject_note] : [])];
  const meta = it.has_file
    ? `📎 ${esc(it.original_name)} · uploaded ${fmtDate(it.uploaded_at)}${it.uploaded_by && it.uploaded_by.role !== 'customer' ? ` by ${esc(it.uploaded_by.full_name)} (${esc(it.uploaded_by.role)})` : ''}`
    : 'No document uploaded yet';
  return `<div class="doc st-${it.status}" data-id="${it.id}">
    <div class="doc-top"><div><div class="doc-title">${esc(it.name)} ${statusBadge(it.status)} ${rr ? '<span class="badge b-removal">Removal requested</span>' : ''}</div>
      ${it.description ? `<div class="small muted">${esc(it.description)}</div>` : ''}
      <div class="doc-meta">${meta}</div></div>
      <div class="doc-actions">${btn.join('')}</div></div>
    ${it.status === 'rejected' ? `<div class="reject-box"><b>Rejected</b>${it.reviewed_at ? ` <span class="small">(${fmtDate(it.reviewed_at)})</span>` : ''} — please re-upload a correct document.
      <ul>${reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>` : ''}
    ${rr ? `<div class="removal-box">Removal requested by <b>${esc(rr.by_name)}</b> (${esc(rr.by_role)}) on ${fmtDate(rr.created_at)}${rr.reason ? ` — “${esc(rr.reason)}”` : ''}.
      ${isAdmin ? '' : 'Waiting for admin approval; the document stays until approved.'}</div>` : ''}
  </div>`;
}
function checklistSummary(p) {
  return `<div class="toolbar small">
    <span class="badge b-accepted">${p.accepted} Accepted</span><span class="badge b-in_review">${p.in_review} In Review</span>
    <span class="badge b-rejected">${p.rejected} Rejected</span><span class="badge b-pending">${p.pending} Pending</span></div>`;
}
function bindDocActions(root, items, reload) {
  root.querySelectorAll('.doc').forEach(card => {
    const it = items.find(i => i.id === +card.dataset.id);
    card.querySelectorAll('[data-act]').forEach(b => b.onclick = () => docAction(b.dataset.act, it, reload));
  });
}
async function docAction(act, it, reload) {
  const id = it.id;
  switch (act) {
    case 'view': return viewModal(it, reload);
    case 'upload': return pickAndUpload(it, reload);
    case 'accept':
      await run(() => api('POST', `/api/items/${id}/accept`), 'Document accepted'); return reload();
    case 'reject': return rejectModal(it, reload);
    case 'reqremove': return removalRequestModal(it, reload);
    case 'remove':
      if (await confirmBox('Remove document', `Remove the uploaded file for <b>${esc(it.name)}</b>? The item goes back to Pending.`, 'Remove', true)) {
        await run(() => api('POST', `/api/items/${id}/remove`), 'Document removed'); reload();
      } return;
    case 'approve-rm':
      if (await confirmBox('Approve removal', `Delete the uploaded file for <b>${esc(it.name)}</b>? This cannot be undone.`, 'Approve & delete', true)) {
        await run(() => api('POST', `/api/removals/${it.removal_request.id}/approve`), 'Removal approved'); reload();
      } return;
    case 'deny-rm':
      await run(() => api('POST', `/api/removals/${it.removal_request.id}/deny`), 'Removal denied'); return reload();
    case 'delete':
      if (await confirmBox('Delete checklist item', `Delete <b>${esc(it.name)}</b> from this customer's checklist${it.has_file ? ' along with its uploaded file' : ''}?`, 'Delete', true)) {
        await run(() => api('DELETE', `/api/items/${id}`), 'Item deleted'); reload();
      } return;
  }
}
function pickAndUpload(it, reload) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,.webp';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return toast('File must be 10 MB or smaller', true);
    const fd = new FormData();
    fd.append('file', file);
    toast('Uploading…');
    await run(() => api('POST', `/api/items/${it.id}/upload`, fd), 'Uploaded — now in review');
    reload();
  };
  input.click();
}
function viewModal(it, reload) {
  const url = `/api/items/${it.id}/file`;
  const isImg = (it.mime || '').startsWith('image/');
  const isAdmin = state.me.role === 'admin';
  modal({
    title: it.name, wide: true,
    body: `<div class="small muted" style="margin-bottom:8px">${esc(it.original_name)} · ${statusBadge(it.status)}</div>
      <div class="preview">${isImg ? `<img src="${url}" alt="">` : `<iframe src="${url}"></iframe>`}</div>`,
    foot: `<a class="btn" href="${url}?download=1">Download</a><a class="btn" href="${url}" target="_blank" rel="noopener">Open in new tab</a>
      ${isAdmin && it.status === 'in_review' ? `<button class="btn-red" id="rj">✕ Reject</button><button class="btn-green" id="ac">✓ Accept</button>` : '<button data-close>Close</button>'}`,
    onMount: (el, close) => {
      el.querySelector('#ac') && (el.querySelector('#ac').onclick = async () => { await run(() => api('POST', `/api/items/${it.id}/accept`), 'Document accepted'); close(); reload(); });
      el.querySelector('#rj') && (el.querySelector('#rj').onclick = () => { close(); rejectModal(it, reload); });
    },
  });
}
function rejectModal(it, reload) {
  modal({
    title: `Reject: ${it.name}`,
    body: `<p class="muted" style="margin-top:0">Select one or more reasons. The customer sees them under the document with a re-upload button.</p>
      <div class="checks">${state.meta.reject_reasons.map(r => `<label><input type="checkbox" value="${esc(r)}"> ${esc(r)}</label>`).join('')}</div>
      <div class="field" style="margin-top:10px"><label>Custom reason (optional)</label><textarea id="note" placeholder="e.g. Please upload the colour scan of all pages"></textarea></div>`,
    foot: `<button data-close>Cancel</button><button class="btn-solid-red" id="go">Reject document</button>`,
    onMount: (el, close) => el.querySelector('#go').onclick = async () => {
      const reasons = [...el.querySelectorAll('.checks input:checked')].map(i => i.value);
      const note = el.querySelector('#note').value.trim();
      if (!reasons.length && !note) return toast('Select a reason or write a custom one', true);
      await run(() => api('POST', `/api/items/${it.id}/reject`, { reasons, note }), 'Document rejected');
      close(); reload();
    },
  });
}
function removalRequestModal(it, reload) {
  modal({
    title: 'Request document removal',
    body: `<p style="margin-top:0">Removal of <b>${esc(it.name)}</b> is not instant. Your request goes to the admin, and the document is removed only after approval.</p>
      <div class="field"><label>Reason (optional)</label><textarea id="why" placeholder="e.g. Uploaded the wrong file"></textarea></div>`,
    foot: `<button data-close>Cancel</button><button class="btn-solid-red" id="go">Send request</button>`,
    onMount: (el, close) => el.querySelector('#go').onclick = async () => {
      await run(() => api('POST', `/api/items/${it.id}/remove-request`, { reason: el.querySelector('#why').value }), 'Removal request sent to admin');
      close(); reload();
    },
  });
}

// Shown when a customer has no documents yet: request (staff/customer) or create/apply (admin)
function noChecklistBox(c, data, role) {
  const rq = data.checklist_request;
  const label = checklistLabel(c) || 'country / visa type not set';
  let action = '';
  if (role === 'admin') {
    action = data.checklist_available
      ? `<button class="btn-primary" data-cl="apply">Apply checklist</button>`
      : `<button class="btn-primary" data-cl="make">Create checklist for ${esc(c.country || 'this customer')}</button>`;
  } else if (!rq) {
    action = `<button class="btn-primary" data-cl="request">${role === 'customer' ? 'Request checklist' : 'Request admin to create checklist'}</button>`;
  }
  return `<div class="empty-cl"><div class="big">📋</div><h3>No checklist created</h3>
    <div class="muted">${role === 'customer' ? 'Our team is preparing your document checklist.' : `No checklist exists yet for <b>${esc(label)}</b>.`}</div>
    ${rq ? `<div class="hint warn" style="display:inline-block;margin-top:12px">Requested from admin by ${esc(rq.by_name || '—')} on ${fmtDate(rq.created_at)}. It appears here automatically once created.</div>` : ''}
    ${action ? `<div style="margin-top:14px">${action}</div>` : ''}</div>`;
}
function bindNoChecklist(root, c, reload) {
  const b = root.querySelector('[data-cl]');
  if (!b) return;
  b.onclick = async () => {
    if (b.dataset.cl === 'request') {
      await run(() => api('POST', `/api/customers/${c.id}/checklist-request`), 'Request sent to admin'); reload();
    } else if (b.dataset.cl === 'apply') {
      const r = await run(() => api('POST', `/api/customers/${c.id}/apply-checklist`)); toast(`${r.added} documents added`); reload();
    } else {
      checklistBuilder(null, { country: c.country, visa_type: c.visa_type, applicant_type: c.applicant_type }, reload);
    }
  };
}

async function renderCustomer(id) {
  const role = state.me.role, isAdmin = role === 'admin';
  const data = await api('GET', `/api/customers/${id}`);
  const c = data.customer;
  const main = shell(`<div class="page-head"><div><a href="#/customers" class="small">← Customers</a><h1>${esc(c.full_name)}</h1></div>
      ${isAdmin ? `<div class="toolbar"><select id="stage" style="width:auto">${state.meta.stages.map(s => `<option ${s === c.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}</div>
    ${profileCard(c, isAdmin)}
    <div class="card"><div class="page-head" style="margin-bottom:12px"><div><h2>Document checklist</h2><div style="margin-top:6px">${checklistSummary(data.progress)}</div></div>
      ${isAdmin ? `<div class="toolbar">${data.checklist_available && data.items.length ? '<button id="applycl">Apply checklist</button>' : ''}<button class="btn-primary" id="additem">+ Add document</button></div>` : ''}</div>
      ${smartBar(false)}
      <div class="checklist">${data.items.length ? data.items.map(it => docCard(it, role)).join('') : noChecklistBox(c, data, role)}</div></div>
    <div class="card"><h2 style="margin-bottom:8px">Activity</h2><ul class="activity">
      ${data.activity.map(a => `<li><b>${esc(a.action)}</b>${a.detail ? ` — ${esc(a.detail)}` : ''}<div class="small muted">${fmtDate(a.at)}${a.by_name ? ` · ${esc(a.by_name)} (${esc(a.by_role)})` : ''}</div></li>`).join('') || '<li class="muted">No activity yet.</li>'}
    </ul></div>`);
  const reload = () => { refreshCounts(); renderCustomer(id); };
  bindDocActions(main, data.items, reload);
  bindNoChecklist(main, c, reload);
  bindSmartUpload(main, c, data.items, reload);
  if (!isAdmin) return;
  main.querySelector('#editc').onclick = () => userFormModal('customer', c);
  main.querySelector('#stage').onchange = async e => { await run(() => api('PUT', `/api/users/${id}`, { stage: e.target.value }), 'Stage updated'); reload(); };
  const applyBtn = main.querySelector('#applycl');
  if (applyBtn) applyBtn.onclick = async () => {
    const r = await run(() => api('POST', `/api/customers/${id}/apply-checklist`));
    toast(r.added ? `${r.added} missing documents added` : 'Checklist already complete'); reload();
  };
  main.querySelector('#additem').onclick = async () => {
    const types = await loadDocTypes();
    modal({
      title: 'Add document to checklist',
      body: `<div class="field"><label>Document name *</label><input id="nm" list="dtl" placeholder="Pick from the list or type a custom name">
          <datalist id="dtl">${types.map(d => `<option value="${esc(d.name)}">`).join('')}</datalist></div>
        <div class="field"><label>Instructions (optional)</label><textarea id="ds" placeholder="e.g. Self-attested copy, all pages"></textarea></div>`,
      foot: `<button data-close>Cancel</button><button class="btn-primary" id="go">Add</button>`,
      onMount: (el, close) => el.querySelector('#go').onclick = async () => {
        await run(() => api('POST', `/api/customers/${id}/items`, { name: el.querySelector('#nm').value, description: el.querySelector('#ds').value }), 'Added');
        close(); reload();
      },
    });
  };
}

// ----------------------------------------------------- customer (self) --
async function renderMy() {
  const data = await api('GET', `/api/customers/${state.me.id}`);
  const c = data.customer, p = data.progress;
  const main = shell(`<div class="page-head"><div><h1>Welcome, ${esc(c.full_name.split(' ')[0])}</h1>
      <div class="muted">Upload the documents below. Each one is reviewed by our team.</div></div></div>
    ${profileCard(c, false)}
    <div class="card"><div class="page-head" style="margin-bottom:12px"><div><h2>Your document checklist</h2>
      <div class="small muted" style="margin-top:2px">${p.accepted} of ${p.total} documents accepted</div></div>${checklistSummary(p)}</div>
      <div style="margin-bottom:14px">${progressBar(p)}</div>
      ${smartBar(true)}
      <div class="checklist">${data.items.length ? data.items.map(it => docCard(it, 'customer')).join('') : noChecklistBox(c, data, 'customer')}</div>
      <p class="small muted" style="margin-bottom:0">Accepted formats: PDF, JPG, PNG, WEBP · max 10 MB. To remove an uploaded document, press Remove — the request goes to our admin for approval.</p></div>`);
  bindDocActions(main, data.items, renderMy);
  bindNoChecklist(main, c, renderMy);
  bindSmartUpload(main, c, data.items, renderMy);
}

// ------------------------------------------------------------- checklists --
async function renderChecklists() {
  const [{ checklists }, { requests }, { doc_types: docTypes }, { visa_types: visaTypes }] = await Promise.all([
    api('GET', '/api/checklists'), api('GET', '/api/checklist-requests'), api('GET', '/api/doc-types'), api('GET', '/api/visa-types')]);
  state.docTypes = docTypes;
  state.meta.visa_types = visaTypes.map(v => v.name);
  const tabs = [
    ['checklists', 'Checklists', checklists.length, requests.length],
    ['doctypes', 'Document types', docTypes.length],
    ['visatypes', 'Visa types', visaTypes.length],
  ];
  const main = shell(`<div class="page-head"><div><h1>Checklists</h1>
      <div class="muted">One checklist per country + visa type + applicant (salaried / business). New customers get it automatically.</div></div>
      <button class="btn-primary" id="make">+ Make checklist</button></div>
    <div class="tabs seg-tabs">${tabs.map(([k, l, n, alert]) =>
      `<button data-tab="${k}">${l} <span class="muted">${n}</span>${alert ? ` <span class="count">${alert}</span>` : ''}</button>`).join('')}</div>
    <div id="tabbody"></div>`);
  const reload = () => { refreshCounts(); renderChecklists(); };
  main.querySelector('#make').onclick = () => checklistBuilder(null, {}, reload);
  const body = main.querySelector('#tabbody');
  const usedIn = pred => checklists.filter(pred).length;
  const show = tab => {
    state.clTab = tab;
    main.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'doctypes') {
      namesTab(body, {
        rows: docTypes, noun: 'document type', url: '/api/doc-types', reload,
        intro: 'The documents you pick from when making a checklist. Renaming one also renames it inside every checklist that uses it.',
        placeholder: 'New document type, e.g. Driving licence',
        usage: name => usedIn(c => c.items.some(i => i.name === name)),
        renamed: r => `Renamed${r.checklists ? ` · updated in ${r.checklists} checklist(s)` : ''}`,
      });
    } else if (tab === 'visatypes') {
      namesTab(body, {
        rows: visaTypes, noun: 'visa type', url: '/api/visa-types', reload,
        intro: 'Visa types offered when making a checklist and creating a customer. Renaming one also updates its checklists and customers.',
        placeholder: 'New visa type, e.g. Medical Visa',
        usage: name => usedIn(c => c.visa_type === name),
        renamed: r => `Renamed${r.checklists || r.customers ? ` · ${r.checklists} checklist(s), ${r.customers} customer(s) updated` : ''}`,
      });
    } else {
      checklistsTab(body, checklists, requests, reload);
    }
  };
  main.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => show(b.dataset.tab));
  show(state.clTab || 'checklists');
}

function checklistsTab(body, checklists, requests, reload) {
  const findList = r => checklists.find(c => c.country === r.country && c.visa_type === r.visa_type && c.applicant_type === r.applicant_type);
  body.innerHTML = `${requests.length ? `<div class="card" style="border-color:#f0c78a"><div class="page-head" style="margin-bottom:8px"><h2>Checklist requests <span class="badge b-in_review">${requests.length}</span></h2>
        <span class="small muted">Creating a checklist applies it to every waiting customer with the same country, visa and applicant type.</span></div>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Needs checklist for</th><th>Requested by</th><th></th></tr></thead><tbody>
      ${requests.map((r, i) => `<tr><td><a href="#/customer/${r.customer_id}"><b>${esc(r.customer_name)}</b></a></td>
        <td>${esc(checklistLabel(r))}</td><td>${esc(r.by_name || '—')}<div class="small muted">${esc(r.by_role || '')} · ${fmtDate(r.created_at)}</div></td>
        <td class="actions">${findList(r) ? `<button class="btn-sm" data-apply="${r.customer_id}">Apply existing checklist</button>`
          : `<button class="btn-sm btn-primary" data-req="${i}">Create checklist</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>All checklists</h2>
      <input id="q" class="search" placeholder="Search country or visa type…"></div><div id="list"></div></div>`;
  body.querySelectorAll('[data-req]').forEach(b => b.onclick = () => checklistBuilder(null, requests[+b.dataset.req], reload));
  body.querySelectorAll('[data-apply]').forEach(b => b.onclick = async () => {
    const r = await run(() => api('POST', `/api/customers/${b.dataset.apply}/apply-checklist`)); toast(`${r.added} documents added`); reload();
  });
  const drawList = () => {
    const q = body.querySelector('#q').value.toLowerCase();
    const rows = checklists.filter(c => `${c.country} ${c.visa_type}`.toLowerCase().includes(q));
    body.querySelector('#list').innerHTML = !rows.length ? `<div class="empty">${checklists.length ? 'No match.' : 'No checklists yet. Press <b>+ Make checklist</b> to create the first one.'}</div>` :
      `<div class="table-wrap"><table><thead><tr><th>Country</th><th>Visa type</th><th>Applicant</th><th>Documents</th><th>Updated</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr><td><b>${esc(c.country)}</b></td><td>${esc(c.visa_type)}</td>
        <td><span class="badge ${c.applicant_type === 'business' ? 'b-removal' : 'b-role'}">${esc(applicantLabel(c.applicant_type))}</span></td>
        <td>${c.items.length}</td><td class="small muted">${fmtDate(c.updated_at)}</td>
        <td class="actions"><button class="btn-sm" data-edit="${c.id}">Edit</button>
          <button class="btn-sm btn-red" data-del="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => checklistBuilder(checklists.find(c => c.id === +b.dataset.edit), {}, reload));
    body.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const c = checklists.find(x => x.id === +b.dataset.del);
      if (!await confirmBox('Delete checklist', `Delete the checklist for <b>${esc(checklistLabel(c))}</b>? Customers who already have its documents keep them.`, 'Delete', true)) return;
      await run(() => api('DELETE', `/api/checklists/${c.id}`), 'Checklist deleted'); reload();
    });
  };
  body.querySelector('#q').oninput = drawList;
  drawList();
}

// Add / rename / remove for a simple list of names (document types, visa types)
function namesTab(body, cfg) {
  const { rows, noun, url, reload, usage } = cfg;
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  body.innerHTML = `<div class="card"><p class="muted" style="margin-top:0">${esc(cfg.intro)}</p>
      <div class="toolbar"><input id="newname" placeholder="${esc(cfg.placeholder)}" style="flex:1;min-width:200px"><button class="btn-primary" id="addname">+ Add ${noun}</button></div></div>
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>${Noun}s</h2><input id="q" class="search" placeholder="Search…"></div><div id="list"></div></div>`;
  const draw = () => {
    const q = body.querySelector('#q').value.toLowerCase();
    const list = rows.filter(r => r.name.toLowerCase().includes(q));
    body.querySelector('#list').innerHTML = !list.length ? '<div class="empty">Nothing found.</div>' :
      `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Used in</th><th></th></tr></thead><tbody>
      ${list.map(r => { const n = usage(r.name); return `<tr><td><b>${esc(r.name)}</b></td>
        <td>${n ? `${n} checklist${n > 1 ? 's' : ''}` : '<span class="muted">Not used</span>'}</td>
        <td class="actions"><button class="btn-sm" data-ren="${r.id}">Edit</button>
          <button class="btn-sm btn-red" data-rm="${r.id}">Remove</button></td></tr>`; }).join('')}</tbody></table></div>`;
    body.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => {
      const r = rows.find(x => x.id === +b.dataset.ren);
      modal({
        title: `Edit ${noun}`,
        body: `<div class="field"><label>Name</label><input id="nm" value="${esc(r.name)}"></div>
          ${usage(r.name) ? `<div class="hint">Used in ${usage(r.name)} checklist(s). They will be updated to the new name.</div>` : ''}`,
        foot: `<button data-close>Cancel</button><button class="btn-primary" id="go">Save</button>`,
        onMount: (el, close) => {
          const inp = el.querySelector('#nm'); inp.focus(); inp.select();
          el.querySelector('#go').onclick = async () => {
            const res = await run(() => api('PUT', `${url}/${r.id}`, { name: inp.value }));
            toast(cfg.renamed(res)); close(); reload();
          };
        },
      });
    });
    body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
      const r = rows.find(x => x.id === +b.dataset.rm);
      const n = usage(r.name);
      const msg = `Remove <b>${esc(r.name)}</b> from the ${noun} list?` +
        (n ? `<br><br>It is used in <b>${n} checklist(s)</b>. Those checklists and customers keep it; it just won't be offered for new ones.` : '');
      if (!await confirmBox(`Remove ${noun}`, msg, 'Remove', true)) return;
      await run(() => api('DELETE', `${url}/${r.id}`), `${Noun} removed`); reload();
    });
  };
  body.querySelector('#q').oninput = draw;
  draw();
  const add = async () => {
    const inp = body.querySelector('#newname');
    if (!inp.value.trim()) return inp.focus();
    await run(() => api('POST', url, { name: inp.value }), `${Noun} added`);
    reload();
  };
  body.querySelector('#addname').onclick = add;
  body.querySelector('#newname').onkeydown = e => { if (e.key === 'Enter') add(); };
}

// Make / edit a checklist: country → visa type → applicant → documents
async function checklistBuilder(existing, prefill = {}, onSaved) {
  const docTypes = await loadDocTypes();
  const cur = existing || prefill;
  const items = existing ? existing.items.map(i => ({ ...i })) : [];
  modal({
    title: existing ? 'Edit checklist' : 'Make checklist', wide: true,
    body: `<div class="grid3">
        <div class="field"><label>1. Country *</label><select id="bc">${countryOptions(cur.country)}</select></div>
        <div class="field"><label>2. Visa type *</label><select id="bv">${visaOptions(cur.visa_type)}</select></div>
        <div class="field"><label>3. Applicant *</label><select id="ba">${optionList([], '', 'Select applicant')}
          ${Object.entries(state.meta.applicant_types).map(([k, l]) => `<option value="${k}" ${k === cur.applicant_type ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="ai-bar"><button class="btn-ai" id="bai" disabled>✨ Generate checklist with AI</button>
        <span class="small" id="bai-hint"></span></div>
      <div class="ai-console" id="bcon" hidden>
        <div class="ai-head"><span class="dot"></span><b>AI checklist generator</b><span class="small" id="bcon-model"></span>
          <button class="btn-sm" id="bstop">Stop</button></div>
        <div class="ai-log" id="blog"></div><div class="ai-raw" id="braw"></div></div>
      <div class="builder">
        <div><label>4. Pick documents</label><input id="bs" placeholder="Search document types…">
          <div class="pick" id="bpick"></div>
          <div class="toolbar" style="margin-top:8px"><input id="bcustom" placeholder="Custom document name" style="flex:1"><button id="baddc">+ Add custom</button></div></div>
        <div><label>Documents in this checklist (<span id="bn">0</span>)</label><div class="chosen" id="bchosen"></div></div>
      </div>`,
    foot: `<button data-close>Cancel</button><button class="btn-primary" id="bsave">Save checklist</button>`,
    onMount: (el, close) => {
      const $ = s => el.querySelector(s);
      const draw = () => {
        const q = $('#bs').value.toLowerCase();
        const chosen = new Set(items.map(i => i.name));
        const list = docTypes.filter(d => d.name.toLowerCase().includes(q));
        $('#bpick').innerHTML = list.map(d => `<label><input type="checkbox" data-name="${esc(d.name)}" ${chosen.has(d.name) ? 'checked' : ''}> ${esc(d.name)}</label>`).join('')
          || '<div class="small muted" style="padding:8px">No match. Add it as a custom document below.</div>';
        $('#bchosen').innerHTML = items.map((it, i) => `<div class="chosen-row${it.fresh ? ' fresh' : ''}"><span class="num">${i + 1}</span>
            <div style="flex:1;min-width:0"><div class="nm">${esc(it.name)}</div><input data-desc="${i}" value="${esc(it.description || '')}" placeholder="Instructions (optional)"></div>
            <button class="btn-sm" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">↑</button><button class="btn-sm btn-red" data-rm="${i}" title="Remove">✕</button></div>`).join('')
          || '<div class="empty small">Tick documents on the left to add them here.</div>';
        $('#bn').textContent = items.length;
        const fresh = el.querySelector('.chosen-row.fresh:last-child');
        if (fresh) fresh.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        items.forEach(it => delete it.fresh);
        el.querySelectorAll('#bpick input').forEach(cb => cb.onchange = () => {
          if (cb.checked) items.push({ name: cb.dataset.name, description: '' });
          else items.splice(items.findIndex(i => i.name === cb.dataset.name), 1);
          draw();
        });
        el.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { items.splice(+b.dataset.rm, 1); draw(); });
        el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); });
        el.querySelectorAll('[data-desc]').forEach(inp => inp.oninput = () => { items[+inp.dataset.desc].description = inp.value; });
      };
      $('#bs').oninput = draw;
      const addCustom = async () => {
        const name = $('#bcustom').value.trim();
        if (!name) return;
        const d = await run(() => api('POST', '/api/doc-types', { name }));
        if (!docTypes.some(x => x.id === d.id)) { docTypes.push(d); docTypes.sort((a, b) => a.name.localeCompare(b.name)); }
        if (!items.some(i => i.name === d.name)) items.push({ name: d.name, description: '' });
        $('#bcustom').value = ''; draw();
      };
      $('#baddc').onclick = addCustom;
      $('#bcustom').onkeydown = e => { if (e.key === 'Enter') addCustom(); };
      draw();

      // ---- AI generation: streams suggestions and adds them to the checklist one by one
      let busy = false, ctrl = null, t0 = 0, stats;
      const sel = () => ({ country: $('#bc').value, visa_type: $('#bv').value, applicant_type: $('#ba').value });
      const ready = () => { const k = sel(); return k.country && k.visa_type && k.applicant_type; };
      const updAi = () => {
        $('#bai').disabled = busy || !ready();
        $('#bsave').disabled = busy;
        $('#bai-hint').innerHTML = busy ? 'Generating… documents appear on the right as the AI writes them'
          : ready() ? `Suggests documents for <b>${esc(checklistLabel(sel()))}</b>. Free · runs on Cloudflare Workers AI`
            : 'Select country, visa type and applicant first';
      };
      ['#bc', '#bv', '#ba'].forEach(s => $(s).addEventListener('change', updAi));
      updAi();
      const secs = () => ((performance.now() - t0) / 1000).toFixed(1);
      const log = (msg, cls = '') => {
        const line = document.createElement('div');
        line.className = 'l ' + cls;
        line.innerHTML = `<span class="t">${secs().padStart(5)}s</span> ${msg}`;
        $('#blog').appendChild(line);
        $('#blog').scrollTop = $('#blog').scrollHeight;
      };
      const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const addSuggested = async (name, description) => {
        const lib = docTypes.find(d => norm(d.name) === norm(name));
        let finalName = lib ? lib.name : name;
        if (items.some(i => norm(i.name) === norm(finalName))) {
          stats.present++; log(`= Already in checklist: <b>${esc(finalName)}</b>`, 'dim'); return;
        }
        if (lib) {
          log(`✓ Matched document library: <b>${esc(finalName)}</b>`, 'ok');
        } else {
          const d = await api('POST', '/api/doc-types', { name });
          if (!docTypes.some(x => x.id === d.id)) { docTypes.push(d); docTypes.sort((a, b) => a.name.localeCompare(b.name)); }
          finalName = d.name; stats.newTypes++;
          log(`＋ New document type created: <b>${esc(d.name)}</b>`, 'new');
        }
        items.push({ name: finalName, description, fresh: true });
        stats.added++;
        draw();
      };
      // "- Name | instruction" (tolerates numbering, bullets and **bold**)
      const parseLine = line => {
        const m = line.replace(/\*\*/g, '').match(/^\s*(?:[-*•]|\d+[.)])\s*(.+)$/);
        if (!m) return null;
        const [rawName, ...rest] = m[1].split('|');
        const name = rawName.replace(/^["'`\s]+|["'`.:\s]+$/g, '').trim();
        return name && name.length <= 120 ? { name, description: rest.join('|').trim().slice(0, 300) } : null;
      };
      $('#bstop').onclick = () => ctrl && ctrl.abort();
      $('#bai').onclick = async () => {
        const k = sel();
        busy = true; updAi(); ctrl = new AbortController(); t0 = performance.now();
        stats = { suggested: 0, added: 0, present: 0, newTypes: 0 };
        $('#bcon').hidden = false; $('#bcon').classList.add('busy'); $('#bstop').hidden = false;
        $('#blog').innerHTML = ''; $('#braw').textContent = ''; $('#braw').classList.add('live');
        log('▶ Starting AI checklist generation');
        log(`• Target: <b>${esc(checklistLabel(k))}</b> · applicant from India`);
        log(`• Document library: ${docTypes.length} types · already in this checklist: ${items.length}`);
        log('• Sending request to Cloudflare Workers AI…');
        let chain = Promise.resolve();
        try {
          const res = await fetch('/api/ai/checklist', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
            body: JSON.stringify({ ...k, existing: items.map(i => i.name) }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `AI request failed (${res.status})`);
          const model = res.headers.get('X-AI-Model') || '';
          $('#bcon-model').textContent = model;
          log(`• Connected · model <b>${esc(model)}</b> · streaming response`);
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let sse = '', lineBuf = '', first = true;
          const take = line => {
            const s = parseLine(line);
            if (!s) return;
            stats.suggested++;
            chain = chain.then(() => addSuggested(s.name, s.description)).catch(e => log(`✕ ${esc(e.message)}`, 'err'));
          };
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            sse += dec.decode(value, { stream: true });
            let nl;
            while ((nl = sse.indexOf('\n')) >= 0) {
              const ev = sse.slice(0, nl).trim(); sse = sse.slice(nl + 1);
              if (!ev.startsWith('data:')) continue;
              const data = ev.slice(5).trim();
              if (data === '[DONE]') continue;
              let tok = '';
              try { const j = JSON.parse(data); tok = j.response ?? j.choices?.[0]?.delta?.content ?? ''; } catch { continue; }
              if (!tok) continue;
              if (first) { log(`• First words from the AI after ${secs()}s`); first = false; }
              $('#braw').textContent += tok;
              $('#braw').scrollTop = $('#braw').scrollHeight;
              lineBuf += tok;
              let ln;
              while ((ln = lineBuf.indexOf('\n')) >= 0) { take(lineBuf.slice(0, ln)); lineBuf = lineBuf.slice(ln + 1); }
            }
          }
          take(lineBuf);
          await chain;
          if (stats.suggested) {
            log(`✓ Done in ${secs()}s · ${stats.suggested} suggested · ${stats.added} added · ${stats.present} already present · ${stats.newTypes} new document types`, 'ok');
          } else {
            log('✕ The AI reply had no usable documents. Please try again.', 'err');
          }
          log('⚠ AI can be wrong or out of date. Review the list (and confirm with the embassy / VFS) before saving.', 'warn');
        } catch (e) {
          await chain;
          log(e.name === 'AbortError' ? `■ Stopped · ${stats.added} documents were added before stopping` : `✕ ${esc(e.message)}`, e.name === 'AbortError' ? 'warn' : 'err');
        } finally {
          busy = false; ctrl = null; updAi();
          $('#bcon').classList.remove('busy'); $('#braw').classList.remove('live'); $('#bstop').hidden = true;
        }
      };

      $('#bsave').onclick = async () => {
        const body = { country: $('#bc').value, visa_type: $('#bv').value, applicant_type: $('#ba').value, items };
        const r = await run(() => existing ? api('PUT', `/api/checklists/${existing.id}`, body) : api('POST', '/api/checklists', body));
        toast(`Checklist saved${r.applied_to ? ` · applied to ${r.applied_to} waiting customer(s)` : ''}`);
        close(); onSaved && onSaved();
      };
    },
  });
}

// ------------------------------------------------------------ smart upload --
// Select many documents at once; AI says what each is and whose it is, then it is filed into the checklist.
const SMART_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
function smartBar(forCustomer) {
  return `<div class="smart-bar"><div class="sb-ic">⚡</div><div style="flex:1;min-width:200px"><b>Smart upload</b><div class="small">${forCustomer
    ? 'Select all your documents at once. The system reads each one and puts it in the right place.'
    : "Select all of the customer's documents at once. AI reads each one, checks the name and files it into the checklist."}</div></div>
    <button class="btn-ai" data-smart>Select documents</button></div>`;
}
function bindSmartUpload(root, customer, items, reload) {
  const b = root.querySelector('[data-smart]');
  if (!b) return;
  b.onclick = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true; inp.accept = SMART_ACCEPT;
    inp.onchange = () => { if (inp.files.length) smartUpload(customer, items, [...inp.files], reload); };
    inp.click();
  };
}

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
let pdfjsPromise = null;
function loadPdfJs() {
  pdfjsPromise = pdfjsPromise || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `${PDFJS}/pdf.min.js`;
    s.onload = () => {
      // a cross-origin worker URL cannot be started directly; a same-origin blob that imports it can
      const boot = new Blob([`importScripts('${PDFJS}/pdf.worker.min.js');`], { type: 'application/javascript' });
      window.pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(boot));
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { pdfjsPromise = null; reject(new Error('Could not load the PDF reader')); };
    document.head.appendChild(s);
  });
  return pdfjsPromise;
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} took too long`)), ms))]);
// First page of a PDF as a JPEG, so the vision model can read it
async function pdfFirstPage(file, max = 1600) {
  const pdfjs = await withTimeout(loadPdfJs(), 20000, 'Loading the PDF reader');
  const pdf = await withTimeout(pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: `${PDFJS}/standard_fonts/` }).promise, 30000, 'Opening the PDF');
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(2.5, max / Math.max(base.width, base.height)) });
  const c = document.createElement('canvas');
  c.width = vp.width; c.height = vp.height;
  // 'print' renders without requestAnimationFrame, so it also finishes in a background tab
  await withTimeout(page.render({ canvasContext: c.getContext('2d'), viewport: vp, intent: 'print' }).promise, 30000, 'Reading the PDF page');
  return { data: c.toDataURL('image/jpeg', 0.85), pages: pdf.numPages };
}

const normText = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const NAME_TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'sri', 'smt', 'kumari', 'dr', 'master']);
const nameTokens = s => normText(s).split(' ').filter(t => t.length > 1 && !NAME_TITLES.has(t));
// true = same person, false = different name, null = no name to compare
function nameMatches(docName, customerName) {
  const a = nameTokens(docName), b = new Set(nameTokens(customerName));
  if (!a.length || !b.size) return null;
  const hits = a.filter(t => b.has(t)).length;
  return hits >= Math.min(2, a.length, b.size);
}
// AI's pick first, then a plain text match ("Passport" ↔ "Passport (first & last page)")
function findChecklistItem(items, docType, aiPick) {
  if (aiPick) { const hit = items.find(i => i.name === aiPick); if (hit) return hit; }
  const d = normText(docType);
  if (!d) return null;
  return items.find(i => normText(i.name) === d)
    || items.find(i => normText(i.name).startsWith(d + ' ') || d.startsWith(normText(i.name) + ' '))
    || items.find(i => normText(i.name).includes(d))
    || null;
}

// an item can take a file when it is empty or its document was rejected (and no removal is pending)
const fillable = it => (!it.has_file || it.status === 'rejected') && !it.removal_request;

function smartUpload(customer, startItems, files, reload) {
  const items = startItems.map(i => ({ ...i }));
  const usedNow = new Set(); // item ids filled during this run
  const rows = files.map(f => ({ file: f, state: 'wait', text: 'Waiting', type: '', person: '' }));
  const stats = { uploaded: 0, created: 0, skipped: 0, hold: 0, failed: 0 };
  let t0 = performance.now(), running = true;
  modal({
    title: `⚡ Smart upload · ${customer.full_name}`, wide: true,
    body: `<div class="ai-console busy" id="su-con"><div class="ai-head"><span class="dot"></span><b>Smart document sorter</b><span class="small" id="su-model"></span></div>
        <div class="ai-log" id="su-log"></div></div>
      <div class="su-list" id="su-list"></div>
      <p class="small muted" style="margin-bottom:0">AI can make mistakes. Uploaded documents still go to <b>In Review</b> for the admin to check.</p>`,
    foot: `<button class="btn-primary" id="su-done" disabled>Processing…</button>`,
    onMount: (el, close) => {
      const $ = s => el.querySelector(s);
      const log = (msg, cls = '') => {
        const line = document.createElement('div');
        line.className = 'l ' + cls;
        line.innerHTML = `<span class="t">${((performance.now() - t0) / 1000).toFixed(1).padStart(5)}s</span> ${msg}`;
        $('#su-log').appendChild(line);
        $('#su-log').scrollTop = $('#su-log').scrollHeight;
      };
      const ICON = { wait: '⏳', work: '🔄', ok: '✅', hold: '⚠️', err: '❌', skip: '⏭️' };
      const itemOptions = () => items.map(i => `<option value="${i.id}" ${fillable(i) ? '' : 'disabled'}>${esc(i.name)}${fillable(i) ? '' : ' (has a file)'}</option>`).join('');
      const drawRow = i => {
        const r = rows[i];
        let node = el.querySelector(`.su-row[data-i="${i}"]`);
        if (!node) { node = document.createElement('div'); node.className = 'su-row'; node.dataset.i = i; $('#su-list').appendChild(node); }
        node.className = `su-row ${r.state}`;
        node.innerHTML = `<span class="su-ic">${ICON[r.state]}</span>
          <div class="su-main"><div class="su-name">${esc(r.file.name)}</div>
            <div class="small">${r.type ? `<b>${esc(r.type)}</b>` : ''}${r.person ? ` · ${esc(r.person)}` : ''}${r.type || r.person ? ' · ' : ''}${r.text}</div>
            ${r.state === 'hold' ? `<div class="su-act">
              <select data-pick>${r.target ? '' : '<option value="">Choose checklist item…</option>'}${itemOptions()}<option value="new">+ New item "${esc(r.type || r.file.name.replace(/\.[^.]+$/, ''))}"</option></select>
              <button class="btn-sm btn-primary" data-go>Upload anyway</button><button class="btn-sm" data-skip>Skip</button></div>` : ''}</div>`;
        if (r.state === 'hold') {
          const pick = node.querySelector('[data-pick]');
          if (r.target) pick.value = String(r.target.id);
          node.querySelector('[data-skip]').onclick = () => { r.state = 'skip'; r.text = 'Skipped by you'; stats.hold--; stats.skipped++; drawRow(i); finish(); };
          node.querySelector('[data-go]').onclick = async () => {
            const v = pick.value;
            if (!v) return toast('Choose a checklist item first', true);
            stats.hold--;
            await place(i, v === 'new' ? null : items.find(x => x.id === +v), true);
            finish();
          };
        }
      };
      rows.forEach((_, i) => drawRow(i));

      const upload = async (i, item) => {
        const r = rows[i];
        const fd = new FormData();
        fd.append('file', r.file);
        await api('POST', `/api/items/${item.id}/upload`, fd);
        item.has_file = true; item.status = 'in_review';
        usedNow.add(item.id);
        stats.uploaded++;
        r.state = 'ok'; r.text = `Uploaded to <b>${esc(item.name)}</b> · In review`;
        log(`✓ Uploaded "${esc(r.file.name)}" → <b>${esc(item.name)}</b>`, 'ok');
        drawRow(i);
      };
      // put file i into item (or a new extra item when item is null / already filled this run)
      const place = async (i, item, confirmed = false) => {
        const r = rows[i];
        r.state = 'work'; r.text = 'Uploading…'; drawRow(i);
        try {
          if (item && !fillable(item) && !usedNow.has(item.id) && !confirmed) {
            r.state = 'skip'; r.text = `<b>${esc(item.name)}</b> already has a document · skipped`;
            stats.skipped++; log(`= "${esc(r.file.name)}": ${esc(item.name)} already uploaded earlier · skipped`, 'dim');
            return drawRow(i);
          }
          if (!item || !fillable(item)) {
            // not asked for in the checklist (or a second page of the same document): add it as an extra item
            const base = item ? `${item.name} – additional` : (r.type || titleCase(r.file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')));
            const made = await api('POST', `/api/customers/${customer.id}/smart-item`, { name: base });
            let target = items.find(x => x.id === made.id);
            if (!target) { target = { id: made.id, name: made.name, status: 'pending', has_file: false }; items.push(target); }
            if (made.created) { stats.created++; log(`＋ ${item ? 'Another page / copy' : 'Not in checklist'} → added custom item <b>${esc(made.name)}</b>`, 'new'); }
            if (!fillable(target)) {
              r.state = 'skip'; r.text = `<b>${esc(target.name)}</b> already has a document · skipped`; stats.skipped++;
              return drawRow(i);
            }
            item = target;
          }
          await upload(i, item);
        } catch (e) {
          r.state = 'err'; r.text = esc(e.message); stats.failed++;
          log(`✕ "${esc(r.file.name)}": ${esc(e.message)}`, 'err');
          drawRow(i);
        }
      };
      const hold = (i, why) => {
        const r = rows[i];
        r.state = 'hold'; r.text = why; stats.hold++;
        drawRow(i);
      };
      const finish = () => {
        if (running || stats.hold > 0) {
          $('#su-done').disabled = running;
          $('#su-done').textContent = running ? 'Processing…' : `Done (${stats.hold} waiting for you)`;
          if (running) return;
        }
        $('#su-done').disabled = false;
        if (!stats.hold) $('#su-done').textContent = 'Done';
      };

      (async () => {
        log(`▶ Smart upload started · ${files.length} file(s) for <b>${esc(customer.full_name)}</b>`);
        log(`• Checklist has ${items.length} item(s) · ${items.filter(fillable).length} still need a document`);
        for (const [i, r] of rows.entries()) {
          const f = r.file;
          const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
          log(`• File ${i + 1}/${rows.length}: "${esc(f.name)}" (${Math.max(1, Math.round(f.size / 1024))} KB)`);
          if (!SMART_ACCEPT.split(',').includes(ext)) { r.state = 'err'; r.text = 'Only PDF, JPG, PNG or WEBP'; stats.failed++; drawRow(i); log('✕ File type not allowed', 'err'); continue; }
          if (f.size > 10 * 1024 * 1024) { r.state = 'err'; r.text = 'Larger than 10 MB'; stats.failed++; drawRow(i); log('✕ File is larger than 10 MB', 'err'); continue; }
          r.state = 'work'; r.text = 'Reading…'; drawRow(i);
          let image;
          try {
            if (ext === '.pdf') {
              log('&nbsp;&nbsp;Rendering PDF page 1 for the AI…', 'dim');
              const p = await pdfFirstPage(f);
              image = p.data;
              log(`&nbsp;&nbsp;PDF has ${p.pages} page(s); reading page 1`, 'dim');
            } else {
              image = await imageToDataURL(f);
            }
          } catch (e) {
            log(`⚠ Could not open "${esc(f.name)}"${/password/i.test(e.name + e.message) ? ' (password-protected PDF)' : ''}. Choose where it goes.`, 'warn');
            hold(i, /password/i.test(e.name + e.message) ? 'Password-protected PDF, AI cannot read it. Choose the checklist item:' : 'Could not read this file. Choose the checklist item:');
            continue;
          }
          try {
            const t = performance.now();
            const ai = await api('POST', '/api/ai/classify', { image, checklist: items.map(x => x.name) });
            $('#su-model').textContent = ai.model;
            r.type = (ai.document_type || '').trim(); // keep acronyms like PAN, ITR as written
            r.person = ai.person_name ? titleCase(ai.person_name) : '';
            log(`&nbsp;&nbsp;AI (${((performance.now() - t) / 1000).toFixed(1)}s): <b>${esc(r.type || 'unknown document')}</b>${r.person ? ` · name <b>${esc(r.person)}</b>` : ''} · ${Math.round(ai.confidence * 100)}% sure`);
            if (!r.type) { hold(i, 'AI could not tell what this document is. Choose the checklist item:'); continue; }
            const match = nameMatches(ai.person_name, customer.full_name);
            const target = findChecklistItem(items, ai.document_type, ai.matched_item);
            r.target = target;
            if (match === false) {
              log(`⚠ Name on document "${esc(r.person)}" does not match customer "${esc(customer.full_name)}". Waiting for your decision.`, 'warn');
              hold(i, `Name does not match <b>${esc(customer.full_name)}</b>. Upload anyway?`);
              continue;
            }
            log(match ? `&nbsp;&nbsp;✓ Name matches the customer` : '&nbsp;&nbsp;• No name on this document to check', match ? 'ok' : 'dim');
            log(target ? `&nbsp;&nbsp;→ Checklist item: <b>${esc(target.name)}</b>` : '&nbsp;&nbsp;→ Not in the checklist', 'dim');
            await place(i, target);
          } catch (e) {
            log(`✕ "${esc(f.name)}": ${esc(e.message)}`, 'err');
            hold(i, `${esc(e.message)} Choose the checklist item:`);
          }
        }
        running = false;
        $('#su-con').classList.remove('busy');
        log(`✓ Finished in ${((performance.now() - t0) / 1000).toFixed(1)}s · ${stats.uploaded} uploaded · ${stats.created} new item(s) · ${stats.skipped} skipped · ${stats.failed} failed${stats.hold ? ` · <b>${stats.hold} waiting for you</b>` : ''}`, 'ok');
        finish();
      })();
      $('#su-done').onclick = () => { close(); reload(); };
    },
  });
}

// ---------------------------------------------------------- review queue --
async function renderReviews() {
  const { items } = await api('GET', '/api/reviews');
  const main = shell(`<div class="page-head"><h1>Review Queue</h1><span class="muted">${items.length} document(s) waiting</span></div>
    <div class="card">${!items.length ? '<div class="empty">🎉 Nothing to review right now.</div>' :
      `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Document</th><th>Uploaded</th><th></th></tr></thead><tbody>
      ${items.map(it => `<tr data-id="${it.id}"><td><a href="#/customer/${it.customer_id}"><b>${esc(it.customer_name)}</b></a>
          <div class="small muted">${esc(it.passport_no)} · ${esc(it.visa_type)} ${esc(it.country)}</div></td>
        <td>${esc(it.name)}<div class="small muted">📎 ${esc(it.original_name)}</div></td>
        <td class="small">${fmtDate(it.uploaded_at)}${it.uploaded_by ? `<div class="muted">by ${esc(it.uploaded_by.full_name)}</div>` : ''}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn-sm btn-primary" data-act="view">Review</button>
          <button class="btn-sm btn-green" data-act="accept">✓</button><button class="btn-sm btn-red" data-act="reject">✕</button></td></tr>`).join('')}
      </tbody></table></div>`}</div>`);
  main.querySelectorAll('tr[data-id]').forEach(tr => {
    const it = items.find(i => i.id === +tr.dataset.id);
    tr.querySelectorAll('[data-act]').forEach(b => b.onclick = () => docAction(b.dataset.act, it, route));
  });
}

// ------------------------------------------------------ removal requests --
async function renderRemovals() {
  const { requests } = await api('GET', '/api/removals');
  const main = shell(`<div class="page-head"><h1>Removal Requests</h1><span class="muted">${requests.length} pending</span></div>
    <div class="card">${!requests.length ? '<div class="empty">No pending removal requests.</div>' :
      `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Document</th><th>Requested by</th><th>Reason</th><th></th></tr></thead><tbody>
      ${requests.map(r => `<tr><td><a href="#/customer/${r.customer_id}"><b>${esc(r.customer_name)}</b></a><div class="small muted">${esc(r.passport_no)}</div></td>
        <td>${esc(r.item_name)} ${statusBadge(r.item_status)}<div class="small"><a href="/api/items/${r.item_id}/file" target="_blank" rel="noopener">📎 ${esc(r.original_name)}</a></div></td>
        <td>${esc(r.by_name)}<div class="small muted">${esc(r.by_role)} · ${fmtDate(r.created_at)}</div></td>
        <td>${esc(r.reason) || '<span class="muted">—</span>'}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn-sm btn-solid-red" data-ap="${r.id}">Approve & delete</button>
          <button class="btn-sm" data-dn="${r.id}">Deny</button></td></tr>`).join('')}
      </tbody></table></div>`}</div>`);
  main.querySelectorAll('[data-ap]').forEach(b => b.onclick = async () => {
    if (!await confirmBox('Approve removal', 'The uploaded file will be permanently deleted and the item goes back to Pending.', 'Approve & delete', true)) return;
    await run(() => api('POST', `/api/removals/${b.dataset.ap}/approve`), 'Removal approved'); route();
  });
  main.querySelectorAll('[data-dn]').forEach(b => b.onclick = async () => {
    await run(() => api('POST', `/api/removals/${b.dataset.dn}/deny`), 'Removal denied'); route();
  });
}

boot();
if (isMobile()) showInstallBanner();
