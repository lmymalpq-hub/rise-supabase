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

  // Compression client avant upload : redimensionne via canvas en JPEG
  // max 1280px (côté le plus long) à qualité 0.85. Évite que les photos
  // de 3 MB du téléphone soient envoyées telles quelles au backend.
  async function compressImage(file, maxDim = 1280, quality = 0.85) {
    if (!file || !file.type || !file.type.startsWith("image/")) return file;
    try {
      const img = new Image();
      img.src = URL.createObjectURL(file);
      await img.decode();
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * ratio);
      const h = Math.round(img.height * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      const blob = await new Promise(res => canvas.toBlob(res, "image/jpeg", quality));
      URL.revokeObjectURL(img.src);
      if (!blob) return file;
      // Si la compression est moins bonne que l'original, garde l'original
      if (blob.size > file.size) return file;
      return new File([blob], (file.name || "photo.jpg").replace(/\.[^.]+$/, "") + ".jpg",
                       { type: "image/jpeg" });
    } catch (e) {
      console.warn("compressImage failed, falling back to original", e);
      return file;
    }
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

    async upload({ pdv, category, photoFile, note, stepId }) {
      // Compression côté client (Sprint TS-17b) : 3 MB → ~250 KB
      const compressed = await compressImage(photoFile);
      const fd = new FormData();
      fd.append("pdv", pdv);
      fd.append("category", category);
      if (note) fd.append("note", note);
      if (stepId != null) fd.append("step_id", String(stepId));
      fd.append("photo", compressed, "photo.jpg");
      const r = await fetch(FN_BASE + "/upload", {
        method: "POST",
        headers: authedHeaders(),
        body: fd,
      });
      return jsonOrThrow(r);
    },

    compressImage,

    async getSequence(pdv, category) {
      const qs = new URLSearchParams({ pdv, category });
      const r = await fetch(FN_BASE + "/sequences-get?" + qs, { headers: authedHeaders() });
      return jsonOrThrow(r);
    },

    // Admin séquences (dashboard)
    async listSequences() {
      const r = await fetch(FN_BASE + "/sequences-admin", { headers: authedHeaders() });
      return jsonOrThrow(r);
    },
    async sequenceAdminOp(op, payload = {}) {
      const r = await fetch(FN_BASE + "/sequences-admin", {
        method: "POST",
        headers: { ...authedHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ op, ...payload }),
      });
      return jsonOrThrow(r);
    },

    async getFramework(zone) {
      const r = await fetch(FN_BASE + "/frameworks-get?zone=" + encodeURIComponent(zone),
        { headers: authedHeaders() });
      return jsonOrThrow(r);
    },

    async createVoiceBriefing({ pdv, zone, serviceDate, serviceSlot, audioBlob }) {
      const fd = new FormData();
      fd.append("pdv", pdv);
      fd.append("zone", zone);
      fd.append("service_date", serviceDate);
      fd.append("service_slot", serviceSlot);
      fd.append("audio", audioBlob, "briefing.webm");
      const r = await fetch(FN_BASE + "/voice-briefings-create", {
        method: "POST",
        headers: authedHeaders(),
        body: fd,
      });
      return jsonOrThrow(r);
    },

    async listVoiceBriefings(params = {}) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") qs.set(k, v); });
      const r = await fetch(FN_BASE + "/voice-briefings-list" + (qs.toString() ? "?" + qs : ""),
        { headers: authedHeaders() });
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
    async listCheckins(params = {}) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v != null && v !== "") qs.set(k, v);
      });
      const url = FN_BASE + "/checkins-list" + (qs.toString() ? "?" + qs : "");
      const r = await fetch(url, { headers: authedHeaders() });
      return jsonOrThrow(r);
    },

    async listStaff({ include_inactive = false, with_counts = true } = {}) {
      const qs = new URLSearchParams();
      if (include_inactive) qs.set("include_inactive", "1");
      if (with_counts) qs.set("with_counts", "1");
      const r = await fetch(FN_BASE + "/staff-list?" + qs, { headers: authedHeaders() });
      return jsonOrThrow(r);
    },

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
