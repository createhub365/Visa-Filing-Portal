/**
 * Visa Filing Portal - Cloudflare Worker backend (production).
 * Same API as app.py (the local Python server). Data in Supabase: Postgres via REST + private Storage bucket.
 *
 * Config (wrangler.jsonc vars): SUPABASE_URL, SUPABASE_BUCKET, COOKIE_SECURE
 * Secret (Cloudflare dashboard): SUPABASE_SECRET_KEY
 */

const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXT = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const ITERATIONS = 100000; // Workers' WebCrypto caps PBKDF2 at 100k iterations
const SESSION_DAYS = 7;

const REJECT_REASONS = [
  'Blurry / unreadable document',
  'Does not match profile',
  'Name mismatch',
  'Passport number mismatch',
  'Document expired',
  'Incomplete / pages missing',
  'Wrong document uploaded',
  'Not signed / not attested',
];

const STAGES = [
  'Documents Collection',
  'Documents Under Review',
  'Application Filed',
  'Biometrics / Interview',
  'Decision Awaited',
  'Visa Approved',
  'Visa Rejected',
];

const VISA_TYPES = [
  'Tourist Visa', 'Visitor / Family Visit Visa', 'Business Visa', 'Student Visa', 'Work Visa',
  'Dependent / Spouse Visa', 'Transit Visa', 'PR / Immigration',
];

const APPLICANT_TYPES = { salaried: 'Salaried person', business: 'Businessman / Self-employed' };

// ------------------------------------------------------------------ errors --

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

class SupabaseError extends Error {
  constructor(status, info) {
    super(`${status}: ${JSON.stringify(info)}`);
    this.status = status;
    this.code = info && info.code;
  }
}

function must(cond, status, message) {
  if (!cond) throw new ApiError(status, message);
}

// ----------------------------------------------------------------- supabase --

const encodePath = p => p.split('/').map(encodeURIComponent).join('/');

function supabase(env) {
  const base = (env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SECRET_KEY || '';
  const bucket = env.SUPABASE_BUCKET || 'documents';

  async function send(method, path, { body, headers = {}, query } = {}) {
    const h = { apikey: key, ...headers };
    if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`; // legacy service_role JWT
    let data;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) data = body;
    else if (body !== undefined) {
      data = JSON.stringify(body);
      if (!h['Content-Type']) h['Content-Type'] = 'application/json';
    }
    // %20 for spaces (not "+"), so filters like country=eq.United States match exactly
    const qs = query ? Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : '';
    const url = base + path + (qs ? '?' + qs : '');
    const res = await fetch(url, { method, headers: h, body: data });
    if (!res.ok) {
      const text = await res.text();
      let info;
      try { info = JSON.parse(text); } catch { info = { message: text }; }
      throw new SupabaseError(res.status, info);
    }
    return res;
  }
  const json = async res => { const t = await res.text(); return t ? JSON.parse(t) : null; };
  const rep = { Prefer: 'return=representation' };

  return {
    select: async (table, query) => json(await send('GET', `/rest/v1/${table}`, { query })),
    one: async (table, query) => (await json(await send('GET', `/rest/v1/${table}`, { query: { ...query, limit: 1 } })))[0] || null,
    insert: async (table, rows) => json(await send('POST', `/rest/v1/${table}`, { body: rows, headers: rep })),
    update: async (table, values, query) => json(await send('PATCH', `/rest/v1/${table}`, { body: values, headers: rep, query })),
    delete: async (table, query) => { await send('DELETE', `/rest/v1/${table}`, { query }); },
    rpc: async (fn, args = {}) => json(await send('POST', `/rest/v1/rpc/${fn}`, { body: args })),
    putFile: async (path, data, mime) => {
      await send('POST', `/storage/v1/object/${bucket}/${encodePath(path)}`, { body: data, headers: { 'Content-Type': mime, 'x-upsert': 'true' } });
    },
    getFile: path => send('GET', `/storage/v1/object/authenticated/${bucket}/${encodePath(path)}`),
    deleteFile: async path => { await send('DELETE', `/storage/v1/object/${bucket}`, { body: { prefixes: [path] } }); },
  };
}

const eq = v => `eq.${v}`;
const now = () => new Date().toISOString();
const str = v => (v == null ? '' : String(v)).trim();

// ----------------------------------------------------------------- passwords --

const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const fromHex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations }, key, 256));
}

async function hashPassword(password) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return `pbkdf2_sha256$${ITERATIONS}$${salt}$${await pbkdf2(password, salt, ITERATIONS)}`;
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// true / false, or null for an old-format hash (200k iterations) that Workers cannot compute
async function checkPassword(password, stored) {
  const parts = (stored || '').split('$');
  if (parts.length !== 4 || +parts[1] > ITERATIONS) return null;
  return safeEqual(await pbkdf2(password, parts[2], +parts[1]), parts[3]);
}

// --------------------------------------------------------------- serializers --

const USER_FIELDS = ['id', 'username', 'role', 'full_name', 'email', 'phone', 'passport_no', 'nationality',
  'dob', 'visa_type', 'country', 'applicant_type', 'stage', 'notes', 'active', 'created_at'];
const USER_SELECT = USER_FIELDS.join(',');
const PROFILE_FIELDS = ['full_name', 'email', 'phone', 'passport_no', 'nationality', 'dob',
  'visa_type', 'country', 'applicant_type', 'stage', 'notes'];

function profileValues(b) {
  const values = {};
  for (const k of PROFILE_FIELDS) if (k in b) values[k] = str(b[k]);
  must(!values.applicant_type || values.applicant_type in APPLICANT_TYPES, 400, 'Applicant type must be salaried or business');
  return values;
}
const ITEM_SELECT = '*,uploader:users!checklist_items_uploaded_by_fkey(full_name,role),' +
  'removal_requests(id,reason,created_at,status,requester:users!removal_requests_requested_by_fkey(full_name,role))';

const userJson = row => Object.fromEntries(USER_FIELDS.map(k => [k, row[k] ?? null]));

function itemJson(row) {
  const rr = (row.removal_requests || []).find(r => r.status === 'pending');
  return {
    id: row.id, customer_id: row.customer_id, name: row.name,
    description: row.description, status: row.status,
    has_file: !!row.file_path, original_name: row.original_name, mime: row.mime,
    uploaded_at: row.uploaded_at, uploaded_by: row.uploader || null,
    reject_reasons: row.reject_reasons || [], reject_note: row.reject_note,
    reviewed_at: row.reviewed_at,
    removal_request: rr ? {
      id: rr.id, reason: rr.reason, created_at: rr.created_at,
      by_name: rr.requester?.full_name ?? null, by_role: rr.requester?.role ?? null,
    } : null,
  };
}

function progressOf(items) {
  const p = { pending: 0, in_review: 0, accepted: 0, rejected: 0 };
  for (const it of items) p[it.status]++;
  p.total = items.length;
  return p;
}

const canAccessCustomer = (user, customerId) => user.role === 'admin' || user.role === 'staff' || user.id === customerId;

// ---------------------------------------------------------------- handlers --
// Each handler: (ctx, user, params) -> JSON-serializable object or a Response

async function getItem(sb, id) {
  const row = await sb.one('checklist_items', { id: eq(id) });
  must(row, 404, 'Checklist item not found');
  return row;
}

async function deleteFile(sb, path) {
  if (!path) return;
  try { await sb.deleteFile(path); } catch (e) { console.error(`could not delete stored file ${path}: ${e.message}`); }
}

async function log(sb, customerId, userId, action, detail = '') {
  await sb.insert('activity', { customer_id: customerId, user_id: userId, action, detail });
}

const checklistLabel = c => `${c.country} · ${c.visa_type} · ${APPLICANT_TYPES[c.applicant_type] || c.applicant_type}`;

async function findTemplate(sb, c) {
  if (!c.country || !c.visa_type || !c.applicant_type) return null;
  return sb.one('checklist_templates', { country: eq(c.country), visa_type: eq(c.visa_type), applicant_type: eq(c.applicant_type) });
}

// Add the template's documents the customer doesn't have yet; close their pending checklist request.
async function applyTemplate(sb, customerId, template, userId) {
  const have = new Set((await sb.select('checklist_items', { select: 'name', customer_id: eq(customerId) })).map(r => r.name));
  const add = template.items.filter(it => !have.has(it.name));
  if (add.length) {
    await sb.insert('checklist_items', add.map(it => ({ customer_id: customerId, name: it.name, description: it.description || '' })));
  }
  await sb.update('checklist_requests', { status: 'done', resolved_at: now() }, { customer_id: eq(customerId), status: eq('pending') });
  await log(sb, customerId, userId, 'Checklist applied', `${checklistLabel(template)} — ${add.length} documents added`);
  return add.length;
}

function cleanItems(items) {
  must(Array.isArray(items) && items.length, 400, 'Add at least one document to the checklist');
  must(items.length <= 100, 400, 'A checklist can have at most 100 documents');
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const name = str(it && it.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ name: name.slice(0, 200), description: str(it.description).slice(0, 500) });
  }
  must(out.length, 400, 'Add at least one document to the checklist');
  return out;
}

function checklistKey(b) {
  const key = { country: str(b.country), visa_type: str(b.visa_type), applicant_type: str(b.applicant_type) };
  must(key.country, 400, 'Select a country');
  must(key.visa_type, 400, 'Select a visa type');
  must(key.applicant_type in APPLICANT_TYPES, 400, 'Select salaried person or businessman');
  return key;
}

// After a checklist is saved: give it to matching customers who still have no documents.
async function applyToWaitingCustomers(sb, template, userId) {
  const customers = await sb.select('users', {
    select: 'id', role: eq('customer'), country: eq(template.country),
    visa_type: eq(template.visa_type), applicant_type: eq(template.applicant_type),
  });
  if (!customers.length) return 0;
  const ids = customers.map(c => c.id);
  const withItems = new Set((await sb.select('checklist_items', { select: 'customer_id', customer_id: `in.(${ids.join(',')})` })).map(r => r.customer_id));
  let applied = 0;
  for (const id of ids) {
    if (withItems.has(id)) continue;
    await applyTemplate(sb, id, template, userId);
    applied++;
  }
  return applied;
}

const handlers = {
  async login(ctx) {
    const { sb } = ctx;
    const body = await ctx.json();
    const username = str(body.username);
    let row = await sb.one('users', { username: eq(username) });
    if (!row && username === 'admin' && !(await sb.one('users', { select: 'id', role: eq('admin') }))) {
      // fresh database: create the default admin
      row = (await sb.insert('users', { username: 'admin', pw: await hashPassword('admin123'), role: 'admin', full_name: 'Administrator' }))[0];
    }
    must(row, 401, 'Invalid username or password');
    const ok = await checkPassword(body.password || '', row.pw);
    must(ok !== null, 401, 'Your password must be reset by the admin before you can log in here.');
    must(ok, 401, 'Invalid username or password');
    must(row.active, 403, 'This account is disabled. Contact the office.');
    const token = hex(crypto.getRandomValues(new Uint8Array(32)));
    await sb.insert('sessions', { token, user_id: row.id });
    ctx.setCookie(`sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${ctx.secure}`);
    return { user: userJson(row) };
  },

  async logout(ctx) {
    await ctx.sb.delete('sessions', { token: eq(ctx.cookie('sid') || '') });
    ctx.setCookie(`sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${ctx.secure}`);
    return { ok: true };
  },

  async me(ctx, user) {
    return { user: userJson(user), reject_reasons: REJECT_REASONS, stages: STAGES, visa_types: VISA_TYPES, applicant_types: APPLICANT_TYPES };
  },

  async changePassword(ctx, user) {
    const body = await ctx.json();
    must(await checkPassword(body.current || '', user.pw), 400, 'Current password is wrong');
    const pw = body.new || '';
    must(pw.length >= 6, 400, 'New password must be at least 6 characters');
    await ctx.sb.update('users', { pw: await hashPassword(pw) }, { id: eq(user.id) });
    return { ok: true };
  },

  async stats(ctx) {
    return ctx.sb.rpc('portal_stats');
  },

  async listUsers(ctx, user) {
    const { sb } = ctx;
    const q = { select: USER_SELECT, order: 'id.desc' };
    if (user.role === 'staff') q.role = eq('customer');
    else if (ctx.query.get('role')) q.role = eq(ctx.query.get('role'));
    const rows = await sb.select('users', q);
    const prog = {};
    if (rows.some(r => r.role === 'customer')) for (const p of await sb.rpc('customer_progress')) prog[p.customer_id] = p;
    return {
      users: rows.map(r => {
        const u = userJson(r);
        if (r.role === 'customer') {
          const p = prog[r.id] || {};
          u.progress = { pending: p.pending || 0, in_review: p.in_review || 0, accepted: p.accepted || 0, rejected: p.rejected || 0, total: p.total || 0 };
        }
        return u;
      }),
    };
  },

  async createUser(ctx, user) {
    const { sb } = ctx;
    const b = await ctx.json();
    const username = str(b.username);
    const role = b.role;
    must(role === 'staff' || role === 'customer', 400, 'Role must be staff or customer');
    must(user.role === 'admin' || role === 'customer', 403, 'Staff can only create customers');
    must(/^[A-Za-z0-9_.@-]{3,40}$/.test(username), 400, 'Username: 3-40 chars, letters/numbers/._@- only');
    must((b.password || '').length >= 6, 400, 'Password must be at least 6 characters');
    must(str(b.full_name), 400, 'Full name is required');
    must(!(await sb.one('users', { select: 'id', username: eq(username) })), 400, 'Username already exists');
    const row = profileValues(b);
    row.stage = row.stage || STAGES[0];
    if (role === 'customer') {
      must(row.country, 400, 'Select the destination country');
      must(row.visa_type, 400, 'Select the visa type');
      must(row.applicant_type, 400, 'Select salaried person or businessman');
    }
    Object.assign(row, { username, pw: await hashPassword(b.password), role });
    const uid = (await sb.insert('users', row))[0].id;
    let checklist = 0;
    if (role === 'customer') {
      await log(sb, uid, user.id, 'Customer created');
      const template = await findTemplate(sb, row);
      if (template) checklist = await applyTemplate(sb, uid, template, user.id);
    }
    return { id: uid, checklist };
  },

  async updateUser(ctx, user, { uid }) {
    const { sb } = ctx;
    const target = await sb.one('users', { id: eq(uid) });
    must(target, 404, 'User not found');
    const b = await ctx.json();
    const values = profileValues(b);
    if ('active' in b && target.role !== 'admin') {
      values.active = !!b.active;
      if (!b.active) await sb.delete('sessions', { user_id: eq(uid) });
    }
    if (b.password) {
      must(b.password.length >= 6, 400, 'Password must be at least 6 characters');
      values.pw = await hashPassword(b.password);
    }
    if (Object.keys(values).length) {
      await sb.update('users', values, { id: eq(uid) });
      if (target.role === 'customer') {
        if ('stage' in values && values.stage !== target.stage) await log(sb, uid, user.id, 'Stage changed', `${target.stage} → ${values.stage}`);
        if (b.password) await log(sb, uid, user.id, 'Password reset');
      }
    }
    return { ok: true };
  },

  async customer(ctx, user, { uid }) {
    const { sb } = ctx;
    must(canAccessCustomer(user, uid), 403, 'Not allowed');
    const row = await sb.one('users', { select: USER_SELECT, id: eq(uid), role: eq('customer') });
    must(row, 404, 'Customer not found');
    const items = (await sb.select('checklist_items', { select: ITEM_SELECT, customer_id: eq(uid), order: 'id' })).map(itemJson);
    const req = await sb.one('checklist_requests', {
      select: 'created_at,requester:users!checklist_requests_requested_by_fkey(full_name,role)',
      customer_id: eq(uid), status: eq('pending'),
    });
    const out = {
      customer: userJson(row), items, progress: progressOf(items),
      checklist_available: !!(await findTemplate(sb, row)),
      checklist_request: req ? { created_at: req.created_at, by_name: req.requester?.full_name ?? null, by_role: req.requester?.role ?? null } : null,
    };
    if (user.role === 'admin' || user.role === 'staff') {
      const rows = await sb.select('activity', {
        select: 'action,detail,at,actor:users!activity_user_id_fkey(full_name,role)',
        customer_id: eq(uid), order: 'id.desc', limit: 50,
      });
      out.activity = rows.map(a => ({ action: a.action, detail: a.detail, at: a.at, by_name: a.actor?.full_name ?? null, by_role: a.actor?.role ?? null }));
    }
    return out;
  },

  async addItem(ctx, user, { uid }) {
    const { sb } = ctx;
    must(await sb.one('users', { select: 'id', id: eq(uid), role: eq('customer') }), 404, 'Customer not found');
    const b = await ctx.json();
    const name = str(b.name);
    must(name, 400, 'Document name is required');
    await sb.insert('checklist_items', { customer_id: uid, name, description: str(b.description) });
    await log(sb, uid, user.id, 'Checklist updated', 'Added: ' + name);
    return { ok: true };
  },

  async applyChecklist(ctx, user, { uid }) {
    const { sb } = ctx;
    const row = await sb.one('users', { select: USER_SELECT, id: eq(uid), role: eq('customer') });
    must(row, 404, 'Customer not found');
    const template = await findTemplate(sb, row);
    must(template, 404, 'No checklist exists for this country, visa type and applicant type yet');
    return { added: await applyTemplate(sb, uid, template, user.id) };
  },

  async requestChecklist(ctx, user, { uid }) {
    const { sb } = ctx;
    must(canAccessCustomer(user, uid), 403, 'Not allowed');
    const row = await sb.one('users', { select: USER_SELECT, id: eq(uid), role: eq('customer') });
    must(row, 404, 'Customer not found');
    must(row.country && row.visa_type && row.applicant_type, 400,
      'Country, visa type and salaried/business must be set on the profile first');
    must(!(await sb.one('checklist_items', { select: 'id', customer_id: eq(uid) })), 400, 'This customer already has a checklist');
    try {
      await sb.insert('checklist_requests', { customer_id: uid, requested_by: user.id });
    } catch (e) {
      if (e instanceof SupabaseError && e.code === '23505') throw new ApiError(400, 'Checklist already requested from admin');
      throw e;
    }
    await log(sb, uid, user.id, 'Checklist requested from admin', checklistLabel(row));
    return { ok: true };
  },

  async listChecklistRequests(ctx) {
    const rows = await ctx.sb.select('checklist_requests', {
      select: 'id,created_at,customer:users!checklist_requests_customer_id_fkey(id,full_name,country,visa_type,applicant_type),' +
        'requester:users!checklist_requests_requested_by_fkey(full_name,role)',
      status: eq('pending'), order: 'id',
    });
    return {
      requests: rows.map(r => ({
        id: r.id, created_at: r.created_at, customer_id: r.customer.id, customer_name: r.customer.full_name,
        country: r.customer.country, visa_type: r.customer.visa_type, applicant_type: r.customer.applicant_type,
        by_name: r.requester?.full_name ?? null, by_role: r.requester?.role ?? null,
      })),
    };
  },

  async listChecklists(ctx) {
    return { checklists: await ctx.sb.select('checklist_templates', { select: 'id,country,visa_type,applicant_type,items,updated_at', order: 'country,visa_type,applicant_type' }) };
  },

  async createChecklist(ctx, user) {
    const { sb } = ctx;
    const b = await ctx.json();
    const key = checklistKey(b);
    const items = cleanItems(b.items);
    let template;
    try {
      template = (await sb.insert('checklist_templates', { ...key, items, created_by: user.id }))[0];
    } catch (e) {
      if (e instanceof SupabaseError && e.code === '23505') throw new ApiError(400, `A checklist for ${checklistLabel(key)} already exists. Edit it instead.`);
      throw e;
    }
    return { id: template.id, applied_to: await applyToWaitingCustomers(sb, template, user.id) };
  },

  async updateChecklist(ctx, user, { cid }) {
    const { sb } = ctx;
    const b = await ctx.json();
    const key = checklistKey(b);
    const items = cleanItems(b.items);
    let rows;
    try {
      rows = await sb.update('checklist_templates', { ...key, items, updated_at: now() }, { id: eq(cid) });
    } catch (e) {
      if (e instanceof SupabaseError && e.code === '23505') throw new ApiError(400, `A checklist for ${checklistLabel(key)} already exists.`);
      throw e;
    }
    must(rows.length, 404, 'Checklist not found');
    return { id: cid, applied_to: await applyToWaitingCustomers(sb, rows[0], user.id) };
  },

  async deleteChecklist(ctx, user, { cid }) {
    await ctx.sb.delete('checklist_templates', { id: eq(cid) });
    return { ok: true };
  },

  async listDocTypes(ctx) {
    return { doc_types: await ctx.sb.select('doc_types', { select: 'id,name', order: 'name' }) };
  },

  async addDocType(ctx) {
    const name = str((await ctx.json()).name).slice(0, 200);
    must(name, 400, 'Document name is required');
    const existing = await ctx.sb.one('doc_types', { select: 'id,name', name: eq(name) });
    if (existing) return existing;
    return (await ctx.sb.insert('doc_types', { name }))[0];
  },

  async deleteDocType(ctx, user, { did }) {
    await ctx.sb.delete('doc_types', { id: eq(did) });
    return { ok: true };
  },

  async deleteItem(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    await sb.delete('checklist_items', { id: eq(iid) });
    await deleteFile(sb, item.file_path);
    await log(sb, item.customer_id, user.id, 'Checklist item deleted', item.name);
    return { ok: true };
  },

  async upload(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(canAccessCustomer(user, item.customer_id), 403, 'Not allowed');
    must(item.status === 'pending' || item.status === 'rejected', 400, 'A document is already uploaded. Request removal first.');
    must(!(await sb.one('removal_requests', { select: 'id', item_id: eq(iid), status: eq('pending') })), 400,
      'A removal request is pending for this document');
    must(+(ctx.request.headers.get('Content-Length') || 0) <= MAX_UPLOAD + 1024 * 1024, 413, 'Request too large (max 10 MB)');
    let file;
    try { file = (await ctx.request.formData()).get('file'); } catch { file = null; }
    must(file && typeof file === 'object' && file.name, 400, 'No file received');
    const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const mime = ALLOWED_EXT[ext];
    must(mime, 400, 'Only PDF, JPG, PNG or WEBP files are allowed');
    must(file.size > 0 && file.size <= MAX_UPLOAD, 400, 'File must be between 1 byte and 10 MB');
    const stored = `${item.customer_id}/${iid}_${hex(crypto.getRandomValues(new Uint8Array(8)))}${ext}`;
    await sb.putFile(stored, await file.arrayBuffer(), mime);
    // only succeeds if nobody else uploaded in the meantime
    const updated = await sb.update('checklist_items', {
      status: 'in_review', file_path: stored, original_name: file.name.split(/[\\/]/).pop().slice(0, 200),
      mime, uploaded_by: user.id, uploaded_at: now(), reject_reasons: [], reject_note: '',
      reviewed_by: null, reviewed_at: null,
    }, { id: eq(iid), status: 'in.(pending,rejected)' });
    if (!updated.length) {
      await deleteFile(sb, stored);
      throw new ApiError(409, 'This document was just updated by someone else. Refresh and try again.');
    }
    await deleteFile(sb, item.file_path); // replacing a rejected file
    await log(sb, item.customer_id, user.id, item.status === 'rejected' ? 'Document re-uploaded' : 'Document uploaded', item.name);
    return { ok: true };
  },

  async file(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(canAccessCustomer(user, item.customer_id), 403, 'Not allowed');
    must(item.file_path, 404, 'No file uploaded');
    let res;
    try { res = await sb.getFile(item.file_path); } catch { throw new ApiError(404, 'File missing in storage'); }
    const disp = ctx.query.get('download') ? 'attachment' : 'inline';
    const safeName = (item.original_name || 'document').replace(/[^A-Za-z0-9._ -]/g, '_');
    return new Response(res.body, {
      headers: {
        'Content-Type': item.mime || 'application/octet-stream',
        'Content-Disposition': `${disp}; filename="${safeName}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },

  async requestRemoval(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(canAccessCustomer(user, item.customer_id), 403, 'Not allowed');
    must(item.file_path, 400, 'There is no document to remove');
    const reason = str((await ctx.json()).reason);
    try {
      await sb.insert('removal_requests', { item_id: iid, requested_by: user.id, reason });
    } catch (e) {
      if (e instanceof SupabaseError && e.code === '23505') throw new ApiError(400, 'A removal request is already pending');
      throw e;
    }
    await log(sb, item.customer_id, user.id, 'Removal requested', item.name + (reason ? ` — ${reason}` : ''));
    return { ok: true };
  },

  async listRemovals(ctx) {
    const rows = await ctx.sb.select('removal_requests', {
      select: 'id,reason,created_at,item_id,requester:users!removal_requests_requested_by_fkey(full_name,role),' +
        'item:checklist_items(name,status,original_name,customer_id,customer:users!checklist_items_customer_id_fkey(full_name,passport_no))',
      status: eq('pending'), order: 'id',
    });
    return {
      requests: rows.map(r => ({
        id: r.id, reason: r.reason, created_at: r.created_at, item_id: r.item_id,
        item_name: r.item.name, item_status: r.item.status, original_name: r.item.original_name,
        customer_id: r.item.customer_id, customer_name: r.item.customer.full_name, passport_no: r.item.customer.passport_no,
        by_name: r.requester?.full_name ?? null, by_role: r.requester?.role ?? null,
      })),
    };
  },

  async decideRemoval(ctx, user, { rid, decision }) {
    const { sb } = ctx;
    const status = decision === 'approve' ? 'approved' : 'denied';
    const done = await sb.update('removal_requests', { status, decided_by: user.id, decided_at: now() }, { id: eq(rid), status: eq('pending') });
    must(done.length, 404, 'Request not found or already decided');
    const item = await getItem(sb, done[0].item_id);
    if (status === 'approved') await removeDocument(sb, item);
    await log(sb, item.customer_id, user.id, `Removal ${status}`, item.name);
    return { ok: true };
  },

  async adminRemove(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(item.file_path, 400, 'There is no document to remove');
    await sb.update('removal_requests', { status: 'approved', decided_by: user.id, decided_at: now() }, { item_id: eq(iid), status: eq('pending') });
    await removeDocument(sb, item);
    await log(sb, item.customer_id, user.id, 'Document removed by admin', item.name);
    return { ok: true };
  },

  async reviewQueue(ctx) {
    const rows = await ctx.sb.select('checklist_items', {
      select: ITEM_SELECT + ',customer:users!checklist_items_customer_id_fkey(full_name,passport_no,visa_type,country)',
      status: eq('in_review'), order: 'uploaded_at',
    });
    return {
      items: rows.map(r => ({
        ...itemJson(r), customer_name: r.customer.full_name, passport_no: r.customer.passport_no,
        visa_type: r.customer.visa_type, country: r.customer.country,
      })),
    };
  },

  async accept(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(item.file_path, 400, 'No document uploaded');
    await sb.update('checklist_items', { status: 'accepted', reject_reasons: [], reject_note: '', reviewed_by: user.id, reviewed_at: now() }, { id: eq(iid) });
    await log(sb, item.customer_id, user.id, 'Document accepted', item.name);
    return { ok: true };
  },

  async reject(ctx, user, { iid }) {
    const { sb } = ctx;
    const item = await getItem(sb, iid);
    must(item.file_path, 400, 'No document uploaded');
    const b = await ctx.json();
    const reasons = (b.reasons || []).filter(r => typeof r === 'string' && r.trim());
    const note = str(b.note);
    must(reasons.length || note, 400, 'Select at least one reason or write a custom reason');
    await sb.update('checklist_items', { status: 'rejected', reject_reasons: reasons, reject_note: note, reviewed_by: user.id, reviewed_at: now() }, { id: eq(iid) });
    await log(sb, item.customer_id, user.id, 'Document rejected', `${item.name} — ` + [...reasons, ...(note ? [note] : [])].join('; '));
    return { ok: true };
  },
};

async function removeDocument(sb, item) {
  await sb.update('checklist_items', {
    status: 'pending', file_path: null, original_name: null, mime: null, uploaded_by: null,
    uploaded_at: null, reject_reasons: [], reject_note: '', reviewed_by: null, reviewed_at: null,
  }, { id: eq(item.id) });
  await deleteFile(sb, item.file_path);
}

// ------------------------------------------------------------------ routing --

const A = 'admin', S = 'staff', CU = 'customer';
const ALL = [A, S, CU];
const ROUTES = [
  // method, pattern, handler, allowed roles (null = public)
  ['POST', /^\/api\/login$/, 'login', null],
  ['POST', /^\/api\/logout$/, 'logout', ALL],
  ['GET', /^\/api\/me$/, 'me', ALL],
  ['POST', /^\/api\/me\/password$/, 'changePassword', ALL],
  ['GET', /^\/api\/stats$/, 'stats', [A, S]],
  ['GET', /^\/api\/users$/, 'listUsers', [A, S]],
  ['POST', /^\/api\/users$/, 'createUser', [A, S]], // staff: customers only
  ['PUT', /^\/api\/users\/(?<uid>\d+)$/, 'updateUser', [A]],
  ['GET', /^\/api\/customers\/(?<uid>\d+)$/, 'customer', ALL],
  ['POST', /^\/api\/customers\/(?<uid>\d+)\/items$/, 'addItem', [A]],
  ['POST', /^\/api\/customers\/(?<uid>\d+)\/apply-checklist$/, 'applyChecklist', [A]],
  ['POST', /^\/api\/customers\/(?<uid>\d+)\/checklist-request$/, 'requestChecklist', ALL],
  ['GET', /^\/api\/checklist-requests$/, 'listChecklistRequests', [A]],
  ['GET', /^\/api\/checklists$/, 'listChecklists', [A, S]],
  ['POST', /^\/api\/checklists$/, 'createChecklist', [A]],
  ['PUT', /^\/api\/checklists\/(?<cid>\d+)$/, 'updateChecklist', [A]],
  ['DELETE', /^\/api\/checklists\/(?<cid>\d+)$/, 'deleteChecklist', [A]],
  ['GET', /^\/api\/doc-types$/, 'listDocTypes', [A]],
  ['POST', /^\/api\/doc-types$/, 'addDocType', [A]],
  ['DELETE', /^\/api\/doc-types\/(?<did>\d+)$/, 'deleteDocType', [A]],
  ['DELETE', /^\/api\/items\/(?<iid>\d+)$/, 'deleteItem', [A]],
  ['POST', /^\/api\/items\/(?<iid>\d+)\/upload$/, 'upload', ALL],
  ['GET', /^\/api\/items\/(?<iid>\d+)\/file$/, 'file', ALL],
  ['POST', /^\/api\/items\/(?<iid>\d+)\/remove-request$/, 'requestRemoval', ALL],
  ['POST', /^\/api\/items\/(?<iid>\d+)\/remove$/, 'adminRemove', [A]],
  ['POST', /^\/api\/items\/(?<iid>\d+)\/accept$/, 'accept', [A]],
  ['POST', /^\/api\/items\/(?<iid>\d+)\/reject$/, 'reject', [A]],
  ['GET', /^\/api\/reviews$/, 'reviewQueue', [A]],
  ['GET', /^\/api\/removals$/, 'listRemovals', [A]],
  ['POST', /^\/api\/removals\/(?<rid>\d+)\/(?<decision>approve|deny)$/, 'decideRemoval', [A]],
];

async function currentUser(sb, token) {
  if (!token) return null;
  const row = await sb.one('sessions', { select: 'created_at,user:users(*)', token: eq(token) });
  if (!row || !row.user || !row.user.active) return null;
  if (Date.now() - Date.parse(row.created_at) > SESSION_DAYS * 86400 * 1000) return null;
  return row.user;
}

function jsonResponse(status, obj, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(obj), { status, headers });
}

async function handleApi(request, env, url) {
  const missing = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY'].filter(k => !env[k]);
  if (missing.length) {
    return jsonResponse(500, { error: `Server not configured: missing ${missing.join(' and ')} (Worker → Settings → Variables and Secrets)` });
  }
  const cookies = [];
  let body;
  const ctx = {
    request, query: url.searchParams, sb: supabase(env),
    secure: env.COOKIE_SECURE === '1' ? '; Secure' : '',
    setCookie: c => cookies.push(c),
    cookie: name => {
      const m = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
      return m ? m[1] : null;
    },
    json: async () => {
      if (body === undefined) {
        const text = await request.text();
        try { body = text ? JSON.parse(text) : {}; } catch { throw new ApiError(400, 'Invalid JSON'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};
      }
      return body;
    },
  };
  for (const [method, pattern, name, roles] of ROUTES) {
    const m = url.pathname.match(pattern);
    if (!m || method !== request.method) continue;
    try {
      let user = null;
      if (roles) {
        user = await currentUser(ctx.sb, ctx.cookie('sid'));
        must(user, 401, 'Please log in');
        must(roles.includes(user.role), 403, 'You do not have permission for this action');
      }
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, /^\d+$/.test(v) ? +v : v]));
      const result = await handlers[name](ctx, user, params);
      return result instanceof Response ? result : jsonResponse(200, result, cookies);
    } catch (e) {
      if (e instanceof ApiError) return jsonResponse(e.status, { error: e.message }, cookies);
      console.error(e instanceof SupabaseError ? `Supabase error: ${e.message}` : e.stack || e);
      return jsonResponse(e instanceof SupabaseError ? 502 : 500,
        { error: e instanceof SupabaseError ? 'Database error, please try again' : 'Server error' });
    }
  }
  return jsonResponse(404, { error: 'Not found' });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
