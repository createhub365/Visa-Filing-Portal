"""
Visa Filing Portal - zero-dependency server (Python 3.9+ standard library only).
Data lives in Supabase: Postgres tables (via the REST API) + a private Storage bucket for documents.

Setup:  copy .env.example to .env and fill SUPABASE_URL and SUPABASE_SECRET_KEY
Run:    python app.py        then open http://localhost:8000
Default admin login:  admin / admin123   (change it after first login)
"""
import hashlib
import hmac
import http.client
import json
import mimetypes
import os
import queue
import re
import secrets
import socket
import sys
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlencode, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE, "static")
MAX_UPLOAD = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}

REJECT_REASONS = [
    "Blurry / unreadable document",
    "Does not match profile",
    "Name mismatch",
    "Passport number mismatch",
    "Document expired",
    "Incomplete / pages missing",
    "Wrong document uploaded",
    "Not signed / not attested",
]

STAGES = [
    "Documents Collection",
    "Documents Under Review",
    "Application Filed",
    "Biometrics / Interview",
    "Decision Awaited",
    "Visa Approved",
    "Visa Rejected",
]

CHECKLIST_TEMPLATES = {
    "Tourist Visa": [
        "Passport (first & last page)", "Passport size photograph", "Aadhaar / National ID",
        "Bank statement (last 6 months)", "Income tax return (last 2 years)",
        "Flight booking", "Hotel booking", "Travel insurance", "Cover letter",
    ],
    "Student Visa": [
        "Passport (first & last page)", "Passport size photograph", "Offer / admission letter",
        "Academic certificates & marksheets", "IELTS / TOEFL score card", "Statement of purpose",
        "Proof of funds / bank statement", "Education loan sanction letter", "Medical certificate",
    ],
    "Work Visa": [
        "Passport (first & last page)", "Passport size photograph", "Job offer letter",
        "Employment contract", "Educational certificates", "Experience letters",
        "Updated resume / CV", "Police clearance certificate", "Medical certificate",
    ],
    "Business Visa": [
        "Passport (first & last page)", "Passport size photograph", "Invitation letter",
        "Company cover letter", "Company registration proof", "Bank statement (last 6 months)",
        "Income tax return (last 2 years)", "Flight booking",
    ],
}


def load_env():
    path = os.path.join(BASE, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()
PORT = int(os.environ.get("PORT", "8000"))
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY", "")
BUCKET = os.environ.get("SUPABASE_BUCKET", "documents")
COOKIE_SECURE = "; Secure" if os.environ.get("COOKIE_SECURE") == "1" else ""


# ----------------------------------------------------------------- supabase --

class SupabaseError(Exception):
    def __init__(self, status, info):
        super().__init__(f"{status}: {info}")
        self.status = status
        self.code = info.get("code") if isinstance(info, dict) else None
        self.info = info


class Supabase:
    """Minimal client for Supabase REST (PostgREST) and Storage using the server's secret key."""

    def __init__(self, url, key, bucket):
        self.url, self.key, self.bucket = url, key, bucket
        self._pool = queue.LifoQueue()  # keep-alive connections, reused across requests

    def _request(self, method, path, data, headers):
        u = urlparse(self.url)
        for attempt in (1, 2):
            try:
                conn = self._pool.get_nowait()
            except queue.Empty:
                cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
                conn = cls(u.netloc, timeout=30)
            try:
                conn.request(method, path, body=data, headers=headers)
                resp = conn.getresponse()
                raw = resp.read()
            except (http.client.RemoteDisconnected, ConnectionResetError, BrokenPipeError):
                conn.close()  # stale keep-alive connection: retry once on a fresh one
                if attempt == 2:
                    raise
                continue
            except Exception:
                conn.close()
                raise
            self._pool.put(conn)
            return resp.status, raw

    def _send(self, method, path, body=None, headers=None, query=None):
        headers = dict(headers or {})
        headers["apikey"] = self.key
        if not self.key.startswith("sb_"):  # legacy service_role JWT
            headers["Authorization"] = f"Bearer {self.key}"
        data = None
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif body is not None:
            data = json.dumps(body).encode()
            headers.setdefault("Content-Type", "application/json")
        status, raw = self._request(method, path + ("?" + urlencode(query) if query else ""), data, headers)
        if status >= 400:
            try:
                info = json.loads(raw)
            except ValueError:
                info = {"message": raw.decode(errors="replace")}
            raise SupabaseError(status, info)
        return raw

    @staticmethod
    def _json(raw):
        return json.loads(raw) if raw else None

    # -- database --
    def select(self, table, query):
        return self._json(self._send("GET", f"/rest/v1/{table}", query=query))

    def one(self, table, query):
        rows = self.select(table, {**query, "limit": 1})
        return rows[0] if rows else None

    def insert(self, table, rows):
        return self._json(self._send("POST", f"/rest/v1/{table}", rows, {"Prefer": "return=representation"}))

    def update(self, table, values, query):
        return self._json(self._send("PATCH", f"/rest/v1/{table}", values,
                                     {"Prefer": "return=representation"}, query))

    def delete(self, table, query):
        self._send("DELETE", f"/rest/v1/{table}", query=query)

    def rpc(self, fn, args=None):
        return self._json(self._send("POST", f"/rest/v1/rpc/{fn}", args or {}))

    # -- storage --
    def put_file(self, path, data, mime):
        self._send("POST", f"/storage/v1/object/{self.bucket}/{quote(path)}", data,
                   {"Content-Type": mime, "x-upsert": "true"})

    def get_file(self, path):
        return self._send("GET", f"/storage/v1/object/authenticated/{self.bucket}/{quote(path)}")

    def delete_file(self, path):
        self._send("DELETE", f"/storage/v1/object/{self.bucket}", {"prefixes": [path]})


sb = Supabase(SUPABASE_URL, SUPABASE_KEY, BUCKET)


def eq(v):
    return f"eq.{v}"


def now():
    return datetime.now(timezone.utc).isoformat()


ITERATIONS = 100_000  # Cloudflare Workers' WebCrypto caps PBKDF2 at 100k; keep both backends compatible


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS).hex()
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest}"


def check_password(password, stored):
    parts = stored.split("$")
    if len(parts) == 2:  # legacy format: salt$digest at 200k iterations
        salt, digest, iterations = parts[0], parts[1], 200_000
    else:
        _, iterations, salt, digest = parts
        iterations = int(iterations)
    calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), iterations).hex()
    return hmac.compare_digest(calc, digest)


def needs_rehash(stored):
    return not stored.startswith(f"pbkdf2_sha256${ITERATIONS}$")


def init_db():
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("Missing SUPABASE_URL / SUPABASE_SECRET_KEY. Copy .env.example to .env and fill them in.")
    try:
        admin = sb.one("users", {"select": "id", "role": eq("admin")})
    except SupabaseError as e:
        if e.code in ("PGRST205", "42P01"):
            sys.exit("Tables not found. Run supabase/schema.sql in the Supabase SQL editor first.")
        sys.exit(f"Could not connect to Supabase: {e}")
    except OSError as e:
        sys.exit(f"Could not reach Supabase at {SUPABASE_URL}: {e}")
    if not admin:
        sb.insert("users", {"username": "admin", "pw": hash_password("admin123"), "role": "admin",
                            "full_name": "Administrator"})
        print("Created default admin -> username: admin  password: admin123")


def log(customer_id, user_id, action, detail=""):
    sb.insert("activity", {"customer_id": customer_id, "user_id": user_id, "action": action, "detail": detail})


# --------------------------------------------------------------- serializers --

USER_FIELDS = ["id", "username", "role", "full_name", "email", "phone", "passport_no", "nationality",
               "dob", "visa_type", "country", "stage", "notes", "active", "created_at"]
USER_SELECT = ",".join(USER_FIELDS)
PROFILE_FIELDS = ["full_name", "email", "phone", "passport_no", "nationality", "dob",
                  "visa_type", "country", "stage", "notes"]
ITEM_SELECT = ("*,uploader:users!checklist_items_uploaded_by_fkey(full_name,role),"
               "removal_requests(id,reason,created_at,status,requester:users!removal_requests_requested_by_fkey(full_name,role))")


def user_json(row):
    return {k: row.get(k) for k in USER_FIELDS}


def item_json(row):
    pending = [r for r in row.get("removal_requests") or [] if r["status"] == "pending"]
    rr = pending[0] if pending else None
    return {
        "id": row["id"], "customer_id": row["customer_id"], "name": row["name"],
        "description": row["description"], "status": row["status"],
        "has_file": bool(row["file_path"]), "original_name": row["original_name"], "mime": row["mime"],
        "uploaded_at": row["uploaded_at"], "uploaded_by": row.get("uploader"),
        "reject_reasons": row["reject_reasons"] or [], "reject_note": row["reject_note"],
        "reviewed_at": row["reviewed_at"],
        "removal_request": {
            "id": rr["id"], "reason": rr["reason"], "created_at": rr["created_at"],
            "by_name": (rr.get("requester") or {}).get("full_name"), "by_role": (rr.get("requester") or {}).get("role"),
        } if rr else None,
    }


def items_for(customer_id):
    rows = sb.select("checklist_items", {"select": ITEM_SELECT, "customer_id": eq(customer_id), "order": "id"})
    return [item_json(r) for r in rows]


def progress_of(items):
    p = {"pending": 0, "in_review": 0, "accepted": 0, "rejected": 0}
    for it in items:
        p[it["status"]] += 1
    p["total"] = len(items)
    return p


# ------------------------------------------------------------------ errors --

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


class RawResponse(Exception):
    def __init__(self, status, body, ctype, headers=None):
        super().__init__()
        self.status, self.body, self.ctype, self.headers = status, body, ctype, headers or {}


def require(cond, status, message):
    if not cond:
        raise ApiError(status, message)


def get_item(item_id):
    row = sb.one("checklist_items", {"id": eq(item_id)})
    require(row, 404, "Checklist item not found")
    return row


def can_access_customer(user, customer_id):
    return user["role"] in ("admin", "staff") or user["id"] == customer_id


def delete_file(path):
    if path:
        try:
            sb.delete_file(path)
        except SupabaseError as e:
            print(f"Warning: could not delete stored file {path}: {e}")


def pending_removal(item_id):
    return sb.one("removal_requests", {"select": "id", "item_id": eq(item_id), "status": eq("pending")})


# ---------------------------------------------------------------- handlers --
# Every handler: (req, user, **url_params) -> JSON-serializable object

def h_login(req, user):
    body = req.json()
    row = sb.one("users", {"username": eq((body.get("username") or "").strip())})
    require(row and check_password(body.get("password") or "", row["pw"]), 401, "Invalid username or password")
    require(row["active"], 403, "This account is disabled. Contact the office.")
    if needs_rehash(row["pw"]):  # upgrade old hashes so the Cloudflare Worker can verify them too
        sb.update("users", {"pw": hash_password(body["password"])}, {"id": eq(row["id"])})
    token = secrets.token_urlsafe(32)
    sb.insert("sessions", {"token": token, "user_id": row["id"]})
    req.set_cookie(f"sid={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800{COOKIE_SECURE}")
    return {"user": user_json(row)}


def h_logout(req, user):
    sb.delete("sessions", {"token": eq(req.cookie("sid"))})
    req.set_cookie(f"sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{COOKIE_SECURE}")
    return {"ok": True}


def h_me(req, user):
    return {"user": user_json(user), "reject_reasons": REJECT_REASONS, "stages": STAGES,
            "templates": CHECKLIST_TEMPLATES}


def h_change_password(req, user):
    body = req.json()
    require(check_password(body.get("current") or "", user["pw"]), 400, "Current password is wrong")
    new = body.get("new") or ""
    require(len(new) >= 6, 400, "New password must be at least 6 characters")
    sb.update("users", {"pw": hash_password(new)}, {"id": eq(user["id"])})
    return {"ok": True}


def h_stats(req, user):
    return sb.rpc("portal_stats")


def h_list_users(req, user):
    q = {"select": USER_SELECT, "order": "id.desc"}
    if user["role"] == "staff":
        q["role"] = eq("customer")
    elif req.query.get("role"):
        q["role"] = eq(req.query["role"])
    rows = sb.select("users", q)
    prog = {p["customer_id"]: p for p in sb.rpc("customer_progress")} \
        if any(r["role"] == "customer" for r in rows) else {}
    empty = {"pending": 0, "in_review": 0, "accepted": 0, "rejected": 0, "total": 0}
    out = []
    for r in rows:
        u = user_json(r)
        if r["role"] == "customer":
            p = prog.get(r["id"])
            u["progress"] = {k: p[k] for k in empty} if p else dict(empty)
        out.append(u)
    return {"users": out}


def h_create_user(req, user):
    b = req.json()
    username = (b.get("username") or "").strip()
    role = b.get("role")
    require(role in ("staff", "customer"), 400, "Role must be staff or customer")
    require(user["role"] == "admin" or role == "customer", 403, "Staff can only create customers")
    require(re.fullmatch(r"[A-Za-z0-9_.@-]{3,40}", username), 400,
            "Username: 3-40 chars, letters/numbers/._@- only")
    require(len(b.get("password") or "") >= 6, 400, "Password must be at least 6 characters")
    require((b.get("full_name") or "").strip(), 400, "Full name is required")
    require(not sb.one("users", {"select": "id", "username": eq(username)}), 400, "Username already exists")
    row = {k: (b.get(k) or "").strip() for k in PROFILE_FIELDS}
    row["stage"] = row["stage"] or STAGES[0]
    row.update(username=username, pw=hash_password(b["password"]), role=role)
    uid = sb.insert("users", row)[0]["id"]
    if role == "customer":
        names = list(CHECKLIST_TEMPLATES.get(b.get("template") or "", []))
        names += [n.strip() for n in (b.get("extra_items") or []) if n.strip()]
        if names:
            sb.insert("checklist_items", [{"customer_id": uid, "name": n} for n in names])
        log(uid, user["id"], "Customer created", f"{len(names)} checklist items")
    return {"id": uid}


def h_update_user(req, user, uid):
    target = sb.one("users", {"id": eq(uid)})
    require(target, 404, "User not found")
    b = req.json()
    values = {k: (b[k] or "").strip() for k in PROFILE_FIELDS if k in b}
    if "active" in b and target["role"] != "admin":
        values["active"] = bool(b["active"])
        if not b["active"]:
            sb.delete("sessions", {"user_id": eq(uid)})
    if b.get("password"):
        require(len(b["password"]) >= 6, 400, "Password must be at least 6 characters")
        values["pw"] = hash_password(b["password"])
    if values:
        sb.update("users", values, {"id": eq(uid)})
        if target["role"] == "customer":
            if "stage" in values and values["stage"] != target["stage"]:
                log(uid, user["id"], "Stage changed", f"{target['stage']} → {values['stage']}")
            if b.get("password"):
                log(uid, user["id"], "Password reset")
    return {"ok": True}


def h_customer(req, user, uid):
    require(can_access_customer(user, uid), 403, "Not allowed")
    row = sb.one("users", {"select": USER_SELECT, "id": eq(uid), "role": eq("customer")})
    require(row, 404, "Customer not found")
    items = items_for(uid)
    out = {"customer": user_json(row), "items": items, "progress": progress_of(items)}
    if user["role"] in ("admin", "staff"):
        rows = sb.select("activity", {"select": "action,detail,at,actor:users!activity_user_id_fkey(full_name,role)",
                                      "customer_id": eq(uid), "order": "id.desc", "limit": 50})
        out["activity"] = [{"action": a["action"], "detail": a["detail"], "at": a["at"],
                            "by_name": (a.get("actor") or {}).get("full_name"),
                            "by_role": (a.get("actor") or {}).get("role")} for a in rows]
    return out


def h_add_item(req, user, uid):
    require(sb.one("users", {"select": "id", "id": eq(uid), "role": eq("customer")}), 404, "Customer not found")
    b = req.json()
    names = [b["name"]] if b.get("name") else list(CHECKLIST_TEMPLATES.get(b.get("template") or "", []))
    names = [n.strip() for n in names if n and n.strip()]
    require(names, 400, "Document name is required")
    desc = (b.get("description") or "").strip()
    sb.insert("checklist_items", [{"customer_id": uid, "name": n, "description": desc} for n in names])
    log(uid, user["id"], "Checklist updated", "Added: " + ", ".join(names))
    return {"ok": True}


def h_delete_item(req, user, iid):
    item = get_item(iid)
    sb.delete("checklist_items", {"id": eq(iid)})
    delete_file(item["file_path"])
    log(item["customer_id"], user["id"], "Checklist item deleted", item["name"])
    return {"ok": True}


def h_upload(req, user, iid):
    item = get_item(iid)
    require(can_access_customer(user, item["customer_id"]), 403, "Not allowed")
    require(item["status"] in ("pending", "rejected"), 400,
            "A document is already uploaded. Request removal first.")
    require(not pending_removal(iid), 400, "A removal request is pending for this document")
    f = req.file("file")
    require(f, 400, "No file received")
    filename, data, _ = f
    ext = os.path.splitext(filename)[1].lower()
    require(ext in ALLOWED_EXT, 400, "Only PDF, JPG, PNG or WEBP files are allowed")
    require(0 < len(data) <= MAX_UPLOAD, 400, "File must be between 1 byte and 10 MB")
    mime = mimetypes.guess_type("x" + ext)[0] or "application/octet-stream"
    stored = f"{item['customer_id']}/{iid}_{secrets.token_hex(8)}{ext}"
    sb.put_file(stored, data, mime)
    # only succeeds if nobody else uploaded in the meantime
    updated = sb.update("checklist_items", {
        "status": "in_review", "file_path": stored, "original_name": os.path.basename(filename)[:200],
        "mime": mime, "uploaded_by": user["id"], "uploaded_at": now(), "reject_reasons": [],
        "reject_note": "", "reviewed_by": None, "reviewed_at": None,
    }, {"id": eq(iid), "status": "in.(pending,rejected)"})
    if not updated:
        delete_file(stored)
        raise ApiError(409, "This document was just updated by someone else. Refresh and try again.")
    delete_file(item["file_path"])  # replacing a rejected file
    action = "Document re-uploaded" if item["status"] == "rejected" else "Document uploaded"
    log(item["customer_id"], user["id"], action, item["name"])
    return {"ok": True}


def h_file(req, user, iid):
    item = get_item(iid)
    require(can_access_customer(user, item["customer_id"]), 403, "Not allowed")
    require(item["file_path"], 404, "No file uploaded")
    try:
        data = sb.get_file(item["file_path"])
    except SupabaseError:
        raise ApiError(404, "File missing in storage")
    disp = "attachment" if req.query.get("download") else "inline"
    safe_name = re.sub(r'[^A-Za-z0-9._ -]', "_", item["original_name"] or "document")
    raise RawResponse(200, data, item["mime"] or "application/octet-stream",
                      {"Content-Disposition": f'{disp}; filename="{safe_name}"', "Cache-Control": "private, no-store"})


def h_request_removal(req, user, iid):
    item = get_item(iid)
    require(can_access_customer(user, item["customer_id"]), 403, "Not allowed")
    require(item["file_path"], 400, "There is no document to remove")
    reason = (req.json().get("reason") or "").strip()
    try:
        sb.insert("removal_requests", {"item_id": iid, "requested_by": user["id"], "reason": reason})
    except SupabaseError as e:
        if e.code == "23505":  # unique index: one pending request per item
            raise ApiError(400, "A removal request is already pending")
        raise
    log(item["customer_id"], user["id"], "Removal requested", item["name"] + (f" — {reason}" if reason else ""))
    return {"ok": True}


def _remove_document(item):
    sb.update("checklist_items", {
        "status": "pending", "file_path": None, "original_name": None, "mime": None, "uploaded_by": None,
        "uploaded_at": None, "reject_reasons": [], "reject_note": "", "reviewed_by": None, "reviewed_at": None,
    }, {"id": eq(item["id"])})
    delete_file(item["file_path"])


def h_list_removals(req, user):
    rows = sb.select("removal_requests", {
        "select": "id,reason,created_at,item_id,requester:users!removal_requests_requested_by_fkey(full_name,role),"
                  "item:checklist_items(name,status,original_name,customer_id,"
                  "customer:users!checklist_items_customer_id_fkey(full_name,passport_no))",
        "status": eq("pending"), "order": "id"})
    out = []
    for r in rows:
        it, by = r["item"], r.get("requester") or {}
        out.append({"id": r["id"], "reason": r["reason"], "created_at": r["created_at"], "item_id": r["item_id"],
                    "item_name": it["name"], "item_status": it["status"], "original_name": it["original_name"],
                    "customer_id": it["customer_id"], "customer_name": it["customer"]["full_name"],
                    "passport_no": it["customer"]["passport_no"],
                    "by_name": by.get("full_name"), "by_role": by.get("role")})
    return {"requests": out}


def h_decide_removal(req, user, rid, decision):
    status = "approved" if decision == "approve" else "denied"
    done = sb.update("removal_requests", {"status": status, "decided_by": user["id"], "decided_at": now()},
                     {"id": eq(rid), "status": eq("pending")})
    require(done, 404, "Request not found or already decided")
    item = get_item(done[0]["item_id"])
    if status == "approved":
        _remove_document(item)
    log(item["customer_id"], user["id"], f"Removal {status}", item["name"])
    return {"ok": True}


def h_admin_remove(req, user, iid):
    item = get_item(iid)
    require(item["file_path"], 400, "There is no document to remove")
    sb.update("removal_requests", {"status": "approved", "decided_by": user["id"], "decided_at": now()},
              {"item_id": eq(iid), "status": eq("pending")})
    _remove_document(item)
    log(item["customer_id"], user["id"], "Document removed by admin", item["name"])
    return {"ok": True}


def h_review_queue(req, user):
    rows = sb.select("checklist_items", {
        "select": ITEM_SELECT + ",customer:users!checklist_items_customer_id_fkey(full_name,passport_no,visa_type,country)",
        "status": eq("in_review"), "order": "uploaded_at"})
    out = []
    for r in rows:
        it = item_json(r)
        cu = r["customer"]
        it.update(customer_name=cu["full_name"], passport_no=cu["passport_no"],
                  visa_type=cu["visa_type"], country=cu["country"])
        out.append(it)
    return {"items": out}


def h_accept(req, user, iid):
    item = get_item(iid)
    require(item["file_path"], 400, "No document uploaded")
    sb.update("checklist_items", {"status": "accepted", "reject_reasons": [], "reject_note": "",
                                  "reviewed_by": user["id"], "reviewed_at": now()}, {"id": eq(iid)})
    log(item["customer_id"], user["id"], "Document accepted", item["name"])
    return {"ok": True}


def h_reject(req, user, iid):
    item = get_item(iid)
    require(item["file_path"], 400, "No document uploaded")
    b = req.json()
    reasons = [r for r in (b.get("reasons") or []) if isinstance(r, str) and r.strip()]
    note = (b.get("note") or "").strip()
    require(reasons or note, 400, "Select at least one reason or write a custom reason")
    sb.update("checklist_items", {"status": "rejected", "reject_reasons": reasons, "reject_note": note,
                                  "reviewed_by": user["id"], "reviewed_at": now()}, {"id": eq(iid)})
    log(item["customer_id"], user["id"], "Document rejected",
        f"{item['name']} — " + "; ".join(reasons + ([note] if note else [])))
    return {"ok": True}


# ------------------------------------------------------------------ routing --

A, S, CU = "admin", "staff", "customer"
ALL = (A, S, CU)
ROUTES = [
    # method, pattern, handler, allowed roles (None = public)
    ("POST", r"/api/login", h_login, None),
    ("POST", r"/api/logout", h_logout, ALL),
    ("GET", r"/api/me", h_me, ALL),
    ("POST", r"/api/me/password", h_change_password, ALL),
    ("GET", r"/api/stats", h_stats, (A, S)),
    ("GET", r"/api/users", h_list_users, (A, S)),
    ("POST", r"/api/users", h_create_user, (A, S)),  # staff: customers only
    ("PUT", r"/api/users/(?P<uid>\d+)", h_update_user, (A,)),
    ("GET", r"/api/customers/(?P<uid>\d+)", h_customer, ALL),
    ("POST", r"/api/customers/(?P<uid>\d+)/items", h_add_item, (A,)),
    ("DELETE", r"/api/items/(?P<iid>\d+)", h_delete_item, (A,)),
    ("POST", r"/api/items/(?P<iid>\d+)/upload", h_upload, ALL),
    ("GET", r"/api/items/(?P<iid>\d+)/file", h_file, ALL),
    ("POST", r"/api/items/(?P<iid>\d+)/remove-request", h_request_removal, ALL),
    ("POST", r"/api/items/(?P<iid>\d+)/remove", h_admin_remove, (A,)),
    ("POST", r"/api/items/(?P<iid>\d+)/accept", h_accept, (A,)),
    ("POST", r"/api/items/(?P<iid>\d+)/reject", h_reject, (A,)),
    ("GET", r"/api/reviews", h_review_queue, (A,)),
    ("GET", r"/api/removals", h_list_removals, (A,)),
    ("POST", r"/api/removals/(?P<rid>\d+)/(?P<decision>approve|deny)", h_decide_removal, (A,)),
]
ROUTES = [(m, re.compile(p + "$"), h, roles) for m, p, h, roles in ROUTES]


def current_user(token):
    if not token:
        return None
    row = sb.one("sessions", {"select": "user:users(*)", "token": eq(token)})
    user = row and row.get("user")
    return user if user and user["active"] else None


class Handler(BaseHTTPRequestHandler):
    server_version = "VisaPortal/2.0"

    # -- request helpers used by handlers --
    def cookie(self, name):
        jar = SimpleCookie(self.headers.get("Cookie", ""))
        return jar[name].value if name in jar else None

    def set_cookie(self, value):
        self._cookies.append(value)

    def body(self):
        if self._body is None:
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD + 1024 * 1024:
                raise ApiError(413, "Request too large (max 10 MB)")
            self._body = self.rfile.read(length) if length else b""
        return self._body

    def json(self):
        raw = self.body()
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            raise ApiError(400, "Invalid JSON")
        return data if isinstance(data, dict) else {}

    def file(self, field):
        ctype = self.headers.get("Content-Type", "")
        if not ctype.startswith("multipart/form-data"):
            return None
        msg = BytesParser(policy=policy.HTTP).parsebytes(
            b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + self.body())
        for part in msg.iter_parts():
            if part.get_param("name", header="content-disposition") == field and part.get_filename():
                return part.get_filename(), part.get_payload(decode=True) or b"", part.get_content_type()
        return None

    # -- dispatch --
    def do_GET(self): self.dispatch("GET")
    def do_POST(self): self.dispatch("POST")
    def do_PUT(self): self.dispatch("PUT")
    def do_DELETE(self): self.dispatch("DELETE")

    def dispatch(self, method):
        self._body, self._cookies = None, []
        url = urlparse(self.path)
        self.query = {k: v[0] for k, v in parse_qs(url.query).items()}
        if not url.path.startswith("/api/"):
            return self.serve_static(url.path) if method == "GET" else self.send_json(405, {"error": "Method not allowed"})
        for m, pattern, handler, roles in ROUTES:
            match = pattern.match(url.path)
            if not match or m != method:
                continue
            try:
                user = None
                if roles is not None:
                    user = current_user(self.cookie("sid"))
                    require(user, 401, "Please log in")
                    require(user["role"] in roles, 403, "You do not have permission for this action")
                params = {k: (int(v) if v.isdigit() else v) for k, v in match.groupdict().items()}
                return self.send_json(200, handler(self, user, **params))
            except RawResponse as r:
                return self.send_raw(r.status, r.body, r.ctype, r.headers)
            except ApiError as e:
                return self.send_json(e.status, {"error": e.message})
            except SupabaseError as e:
                self.log_error("Supabase error: %s", e)
                return self.send_json(502, {"error": "Database error, please try again"})
            except Exception as e:  # noqa: BLE001
                self.log_error("Unhandled error: %r", e)
                return self.send_json(500, {"error": "Server error"})
        self.send_json(404, {"error": "Not found"})

    def serve_static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(STATIC_DIR) or not os.path.isfile(full):
            full = os.path.join(STATIC_DIR, "index.html")
        with open(full, "rb") as fh:
            data = fh.read()
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype.endswith("javascript"):
            ctype += "; charset=utf-8"
        self.send_raw(200, data, ctype, {"Cache-Control": "no-cache"})

    def send_json(self, status, obj):
        self.send_raw(status, json.dumps(obj).encode(), "application/json; charset=utf-8")

    def send_raw(self, status, data, ctype, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        for ck in self._cookies:
            self.send_header("Set-Cookie", ck)
        self.end_headers()
        self.wfile.write(data)


class DualStackServer(ThreadingHTTPServer):
    """Listens on IPv6 and IPv4, so "localhost" (which Windows resolves to ::1 first) answers instantly."""
    address_family = socket.AF_INET6

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


if __name__ == "__main__":
    init_db()
    try:
        server = DualStackServer(("::", PORT), Handler)
    except OSError:  # no IPv6 on this machine
        server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Visa Filing Portal running at http://localhost:{PORT}  (Supabase: {SUPABASE_URL})", flush=True)
    server.serve_forever()
