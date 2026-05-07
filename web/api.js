// Wrapper API minimal pour parler aux Edge Functions Supabase.
// Toutes les fonctions ajoutent automatiquement :
//   - apikey (anon, pour passer le gateway Supabase)
//   - Authorization Bearer <session.token> (auth custom PBKDF2 côté Edge)
//
// Stockage du token : localStorage 'rise_token'.

(function () {
  const cfg = window.RISE_CONFIG;
  const FN_BASE = cfg.SUPABASE_URL + "/functions/v1";

  function getToken() {
    return localStorage.getItem("rise_token") || null;
  }
  function setToken(t) {
    if (t) localStorage.setItem("rise_token", t);
    else localStorage.removeItem("rise_token");
  }
  function getStaff() {
    try {
      return JSON.parse(localStorage.getItem("rise_staff") || "null");
    } catch {
      return null;
    }
  }
  function setStaff(s) {
    if (s) localStorage.setItem("rise_staff", JSON.stringify(s));
    else localStorage.removeItem("rise_staff");
  }

  function authedHeaders(extra = {}) {
    const token = getToken();
    const h = {
      apikey: cfg.SUPABASE_ANON_KEY,
      ...extra,
    };
    if (token) h["Authorization"] = "Bearer " + token;
    return h;
  }

  async function jsonOrThrow(resp) {
    let body = null;
    try {
      body = await resp.json();
    } catch {}
    if (!resp.ok) {
      const msg = (body && (body.error || body.message)) || `HTTP ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      err.body = body;
      throw err;
    }
    return body;
  }

  const api = {
    getToken,
    setToken,
    getStaff,
    setStaff,
    isLogged: () => !!getToken() && !!getStaff(),

    async login(pin) {
      const r = await fetch(FN_BASE + "/auth", {
        method: "POST",
        headers: { apikey: cfg.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const b = await jsonOrThrow(r);
      setToken(b.token);
      setStaff({ staff_id: b.staff_id, name: b.name, is_supervisor: !!b.is_supervisor });
      return b;
    },

    logout() {
      setToken(null);
      setStaff(null);
    },

    async upload({ pdv, category, photoFile, note }) {
      const fd = new FormData();
      fd.append("pdv", pdv);
      fd.append("category", category);
      if (note) fd.append("note", note);
      fd.append("photo", photoFile, "photo.jpg");
      const r = await fetch(FN_BASE + "/upload", {
        method: "POST",
        headers: authedHeaders(), // pas de Content-Type, le browser pose le boundary
        body: fd,
      });
      return jsonOrThrow(r);
    },

    async myNotes({ from, to, only_unread } = {}) {
      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (only_unread) params.set("only_unread", "1");
      const url = FN_BASE + "/me-notes" + (params.toString() ? "?" + params : "");
      const r = await fetch(url, { headers: authedHeaders() });
      return jsonOrThrow(r);
    },

    async myUnreadCount() {
      const r = await fetch(FN_BASE + "/me-notes-unread-count", {
        headers: authedHeaders(),
      });
      return jsonOrThrow(r);
    },

    async myDopamineStats() {
      const r = await fetch(FN_BASE + "/me-dopamine-stats", {
        headers: authedHeaders(),
      });
      return jsonOrThrow(r);
    },

    async ackNote(noteId) {
      const r = await fetch(FN_BASE + "/me-notes-read?id=" + noteId, {
        method: "POST",
        headers: authedHeaders(),
      });
      return jsonOrThrow(r);
    },

    // Admin
    async annotateCheckin(checkinId, { annotations, note }) {
      const r = await fetch(FN_BASE + "/checkins-annotate?id=" + checkinId, {
        method: "POST",
        headers: authedHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ annotations, note }),
      });
      return jsonOrThrow(r);
    },

    async staffStats(staffId, windowDays = 30) {
      const r = await fetch(
        FN_BASE + `/staff-stats?id=${staffId}&window_days=${windowDays}`,
        { headers: authedHeaders() }
      );
      return jsonOrThrow(r);
    },
  };

  window.RiseAPI = api;
})();
