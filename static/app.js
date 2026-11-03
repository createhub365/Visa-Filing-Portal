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
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn-primary">Sign in</button></form></div>`;
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
function navFor(role) {
  if (role === 'admin') return [
    ['#/dashboard', 'Dashboard'], ['#/customers', 'Customers'], ['#/staff', 'Staff'],
    ['#/checklists', 'Checklists', state.counts.checklist_requests],
    ['#/reviews', 'Review Queue', state.counts.in_review], ['#/removals', 'Removal Requests', state.counts.removals],
  ];
  if (role === 'staff') return [['#/dashboard', 'Dashboard'], ['#/customers', 'Customers']];
  return [['#/my', 'My Application']];
}
function shell(content) {
  const me = state.me;
  const cur = location.hash.split('/').slice(0, 2).join('/');
  const nav = navFor(me.role).map(([h, l, n]) =>
    `<a href="${h}" class="${cur === h || (h === '#/customers' && cur === '#/customer') ? 'active' : ''}">${l}${n ? `<span class="count">${n}</span>` : ''}</a>`).join('');
  $app.innerHTML = `<div class="shell">
    <aside class="sidebar" id="sb">
      <div class="brand"><span style="display:flex;gap:8px;align-items:center"><span class="logo">✈</span>Visa Portal</span>
        <button class="menu-btn btn-sm" id="menu">☰</button></div>
      <nav class="nav">${nav}</nav>
      <div class="who"><b>${esc(me.full_name)}</b><span class="badge b-role">${esc(me.role)}</span>
        <button id="pw">Change password</button><button id="logout">Log out</button></div>
    </aside>
    <main class="main" id="main">${content}</main></div>`;
  document.getElementById('menu').onclick = () => document.getElementById('sb').classList.toggle('open');
  document.getElementById('logout').onclick = async () => { await api('POST', '/api/logout'); state.me = null; location.hash = ''; renderLogin(); };
  document.getElementById('pw').onclick = changePasswordModal;
  return document.getElementById('main');
}
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
  main.querySelector('#newc').onclick = () => userFormModal('customer');
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
  if (canCreate) main.querySelector('#new').onclick = () => userFormModal(role);
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
function userFormModal(role, user = null) {
  const m = state.meta;
  const v = k => esc(user?.[k] ?? '');
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
      <div class="field"><label>Date of birth</label><input name="dob" type="date" value="${v('dob')}"></div>
      <div class="field"><label>Nationality</label><input name="nationality" value="${v('nationality') || (user ? '' : 'Indian')}"></div>
      <div class="field"><label>Application stage</label><select name="stage">${opts(m.stages, user?.stage || m.stages[0])}</select></div>
      <div class="section-label">Visa &amp; checklist</div>
      <div class="field"><label>Destination country *</label><select name="country" required>${countryOptions(user?.country)}</select></div>
      <div class="field"><label>Visa type *</label><select name="visa_type" required>${visaOptions(user?.visa_type)}</select></div>
      <div class="field span2"><label>Applicant *</label>${applicantRadios(user?.applicant_type)}</div>
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
      ${f('nationality', 'Nationality')}${f('dob', 'Date of birth')}${f('phone', 'Phone')}${f('email', 'Email')}</div>
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
      <div class="checklist">${data.items.length ? data.items.map(it => docCard(it, role)).join('') : noChecklistBox(c, data, role)}</div></div>
    <div class="card"><h2 style="margin-bottom:8px">Activity</h2><ul class="activity">
      ${data.activity.map(a => `<li><b>${esc(a.action)}</b>${a.detail ? ` — ${esc(a.detail)}` : ''}<div class="small muted">${fmtDate(a.at)}${a.by_name ? ` · ${esc(a.by_name)} (${esc(a.by_role)})` : ''}</div></li>`).join('') || '<li class="muted">No activity yet.</li>'}
    </ul></div>`);
  const reload = () => { refreshCounts(); renderCustomer(id); };
  bindDocActions(main, data.items, reload);
  bindNoChecklist(main, c, reload);
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
      <div class="checklist">${data.items.length ? data.items.map(it => docCard(it, 'customer')).join('') : noChecklistBox(c, data, 'customer')}</div>
      <p class="small muted" style="margin-bottom:0">Accepted formats: PDF, JPG, PNG, WEBP · max 10 MB. To remove an uploaded document, press Remove — the request goes to our admin for approval.</p></div>`);
  bindDocActions(main, data.items, renderMy);
  bindNoChecklist(main, c, renderMy);
}

// ------------------------------------------------------------- checklists --
async function renderChecklists() {
  const [{ checklists }, { requests }, docTypes] = await Promise.all([
    api('GET', '/api/checklists'), api('GET', '/api/checklist-requests'), loadDocTypes()]);
  const findList = r => checklists.find(c => c.country === r.country && c.visa_type === r.visa_type && c.applicant_type === r.applicant_type);
  const main = shell(`<div class="page-head"><div><h1>Checklists</h1>
      <div class="muted">One checklist per country + visa type + applicant (salaried / business). New customers get it automatically.</div></div>
      <button class="btn-primary" id="make">+ Make checklist</button></div>
    ${requests.length ? `<div class="card" style="border-color:#f0c78a"><div class="page-head" style="margin-bottom:8px"><h2>Checklist requests <span class="badge b-in_review">${requests.length}</span></h2>
        <span class="small muted">Creating a checklist applies it to every waiting customer with the same country, visa and applicant type.</span></div>
      <div class="table-wrap"><table><thead><tr><th>Customer</th><th>Needs checklist for</th><th>Requested by</th><th></th></tr></thead><tbody>
      ${requests.map((r, i) => `<tr><td><a href="#/customer/${r.customer_id}"><b>${esc(r.customer_name)}</b></a></td>
        <td>${esc(checklistLabel(r))}</td><td>${esc(r.by_name || '—')}<div class="small muted">${esc(r.by_role || '')} · ${fmtDate(r.created_at)}</div></td>
        <td style="text-align:right">${findList(r) ? `<button class="btn-sm" data-apply="${r.customer_id}">Apply existing checklist</button>`
          : `<button class="btn-sm btn-primary" data-req="${i}">Create checklist</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="card"><div class="page-head" style="margin-bottom:8px"><h2>All checklists (${checklists.length})</h2>
      <input id="q" placeholder="Search country or visa type…" style="width:260px"></div><div id="list"></div></div>
    <div class="card"><h2>Document types</h2><p class="small muted" style="margin:4px 0 12px">The list you pick from when making a checklist. Custom documents you add there appear here too.</p>
      <div class="chips" id="dts"></div>
      <div class="toolbar" style="margin-top:12px"><input id="newdt" placeholder="New document type, e.g. Driving licence" style="width:320px"><button id="adddt">+ Add</button></div></div>`);
  const reload = () => { refreshCounts(); renderChecklists(); };
  main.querySelector('#make').onclick = () => checklistBuilder(null, {}, reload);
  main.querySelectorAll('[data-req]').forEach(b => b.onclick = () => checklistBuilder(null, requests[+b.dataset.req], reload));
  main.querySelectorAll('[data-apply]').forEach(b => b.onclick = async () => {
    const r = await run(() => api('POST', `/api/customers/${b.dataset.apply}/apply-checklist`)); toast(`${r.added} documents added`); reload();
  });
  const drawList = () => {
    const q = main.querySelector('#q').value.toLowerCase();
    const rows = checklists.filter(c => `${c.country} ${c.visa_type}`.toLowerCase().includes(q));
    main.querySelector('#list').innerHTML = !rows.length ? `<div class="empty">${checklists.length ? 'No match.' : 'No checklists yet. Press <b>+ Make checklist</b> to create the first one.'}</div>` :
      `<div class="table-wrap"><table><thead><tr><th>Country</th><th>Visa type</th><th>Applicant</th><th>Documents</th><th>Updated</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr><td><b>${esc(c.country)}</b></td><td>${esc(c.visa_type)}</td>
        <td><span class="badge ${c.applicant_type === 'business' ? 'b-removal' : 'b-role'}">${esc(applicantLabel(c.applicant_type))}</span></td>
        <td>${c.items.length}</td><td class="small muted">${fmtDate(c.updated_at)}</td>
        <td style="text-align:right;white-space:nowrap"><button class="btn-sm" data-edit="${c.id}">Edit</button>
          <button class="btn-sm btn-red" data-del="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    main.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => checklistBuilder(checklists.find(c => c.id === +b.dataset.edit), {}, reload));
    main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      const c = checklists.find(x => x.id === +b.dataset.del);
      if (!await confirmBox('Delete checklist', `Delete the checklist for <b>${esc(checklistLabel(c))}</b>? Customers who already have its documents keep them.`, 'Delete', true)) return;
      await run(() => api('DELETE', `/api/checklists/${c.id}`), 'Checklist deleted'); reload();
    });
  };
  main.querySelector('#q').oninput = drawList;
  drawList();
  const drawTypes = () => {
    main.querySelector('#dts').innerHTML = docTypes.map(d => `<span class="chip">${esc(d.name)}<button title="Remove from list" data-dt="${d.id}">×</button></span>`).join('');
    main.querySelectorAll('[data-dt]').forEach(b => b.onclick = async () => {
      await run(() => api('DELETE', `/api/doc-types/${b.dataset.dt}`));
      docTypes.splice(docTypes.findIndex(d => d.id === +b.dataset.dt), 1); drawTypes();
    });
  };
  drawTypes();
  const addType = async () => {
    const inp = main.querySelector('#newdt');
    if (!inp.value.trim()) return;
    const d = await run(() => api('POST', '/api/doc-types', { name: inp.value }), 'Document type added');
    if (!docTypes.some(x => x.id === d.id)) { docTypes.push(d); docTypes.sort((a, b) => a.name.localeCompare(b.name)); }
    inp.value = ''; drawTypes();
  };
  main.querySelector('#adddt').onclick = addType;
  main.querySelector('#newdt').onkeydown = e => { if (e.key === 'Enter') addType(); };
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
        $('#bchosen').innerHTML = items.map((it, i) => `<div class="chosen-row"><span class="num">${i + 1}</span>
            <div style="flex:1;min-width:0"><div class="nm">${esc(it.name)}</div><input data-desc="${i}" value="${esc(it.description || '')}" placeholder="Instructions (optional)"></div>
            <button class="btn-sm" data-up="${i}" ${i ? '' : 'disabled'} title="Move up">↑</button><button class="btn-sm btn-red" data-rm="${i}" title="Remove">✕</button></div>`).join('')
          || '<div class="empty small">Tick documents on the left to add them here.</div>';
        $('#bn').textContent = items.length;
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
      $('#bsave').onclick = async () => {
        const body = { country: $('#bc').value, visa_type: $('#bv').value, applicant_type: $('#ba').value, items };
        const r = await run(() => existing ? api('PUT', `/api/checklists/${existing.id}`, body) : api('POST', '/api/checklists', body));
        toast(`Checklist saved${r.applied_to ? ` · applied to ${r.applied_to} waiting customer(s)` : ''}`);
        close(); onSaved && onSaved();
      };
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
