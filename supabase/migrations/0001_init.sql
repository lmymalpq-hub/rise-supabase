-- RISE — schema Postgres adapté depuis db_schema.sql (version Python)
-- Toutes les tables sont en RLS strict : aucun accès direct depuis le client.
-- Les Edge Functions utilisent service_role pour bypass RLS.

-- =========================================================================
-- staff : équipiers (Salim, Anna, Yasin…) + admin Marwan
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.staff (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT        NOT NULL,
    pin_hash        TEXT        NOT NULL,                -- PBKDF2-SHA256 hex (200k iter)
    pin_salt        TEXT        NOT NULL,                -- 16 bytes hex
    pin_length      INTEGER,                             -- 4, 5 ou 6
    prefix_hash_4   TEXT,                                -- HMAC pepper sur pin[:4]
    prefix_hash_5   TEXT,
    prefix_hash_6   TEXT,
    pdvs            TEXT,                                -- CSV : 'vh' / 'marais' / 'vh,marais'
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    is_supervisor   BOOLEAN     NOT NULL DEFAULT FALSE,
    onboarded_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_staff_active ON public.staff(active);

-- =========================================================================
-- sessions : tokens d'auth après login PIN
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.sessions (
    token         TEXT        PRIMARY KEY,
    staff_id      BIGINT      NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_staff ON public.sessions(staff_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);

-- =========================================================================
-- checkins : photos uploadées par les équipiers
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.checkins (
    id           BIGSERIAL   PRIMARY KEY,
    pdv          TEXT        NOT NULL,                   -- 'vh' ou 'marais'
    category     TEXT        NOT NULL,                   -- 'terrasse', 'comptoir', etc.
    photo_path   TEXT        NOT NULL,                   -- chemin dans le bucket Storage
    photo_bytes  BIGINT,
    note         TEXT,
    staff_id     BIGINT      REFERENCES public.staff(id) ON DELETE SET NULL,
    user_label   TEXT,                                   -- snapshot du nom au moment de l'upload
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status       TEXT        NOT NULL DEFAULT 'ok',      -- 'ok' | 'archived' (legacy : 'redo' deprecate)
    feedback     TEXT,                                    -- DEPRECATED, conservé pour compat
    annotations  JSONB,                                   -- shapes dessinées par admin (cercle/flèche/ligne)
    step_id      BIGINT                                   -- FK ajoutée plus tard si séquences guidées migrées
);
CREATE INDEX IF NOT EXISTS idx_checkins_pdv_date  ON public.checkins(pdv, created_at);
CREATE INDEX IF NOT EXISTS idx_checkins_category  ON public.checkins(category);
CREATE INDEX IF NOT EXISTS idx_checkins_user      ON public.checkins(user_label);
CREATE INDEX IF NOT EXISTS idx_checkins_staff_id  ON public.checkins(staff_id);
CREATE INDEX IF NOT EXISTS idx_checkins_status    ON public.checkins(status);

-- =========================================================================
-- staff_notes : retours admin → équipier (avec lien optionnel à un checkin)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.staff_notes (
    id           BIGSERIAL   PRIMARY KEY,
    staff_id     BIGINT      NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    pdv          TEXT        NOT NULL,
    category     TEXT        NOT NULL,
    note_date    TEXT        NOT NULL,                   -- 'YYYY-MM-DD' (suffixé '#cN' si lié à un checkin)
    score        INTEGER,                                 -- 0..10 (DEPRECATED, conservé)
    mood         TEXT,                                    -- 'thumb_up' | 'ok' | 'thumb_down' | 'excellent'
    remark       TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at      TIMESTAMPTZ,                             -- NULL = non lu, timestamp = acquitté par l'équipier
    checkin_id   BIGINT      REFERENCES public.checkins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_notes_staff_date ON public.staff_notes(staff_id, note_date);
CREATE INDEX IF NOT EXISTS idx_staff_notes_unread    ON public.staff_notes(staff_id, read_at);
CREATE INDEX IF NOT EXISTS idx_staff_notes_checkin   ON public.staff_notes(checkin_id);

-- =========================================================================
-- push_subscriptions : Web Push VAPID par device
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id           BIGSERIAL   PRIMARY KEY,
    staff_id     BIGINT      NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    endpoint     TEXT        NOT NULL UNIQUE,
    p256dh       TEXT        NOT NULL,
    auth         TEXT        NOT NULL,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_staff ON public.push_subscriptions(staff_id);

-- =========================================================================
-- app_settings : config runtime (wrapper Gemini, modèle, etc.)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
    key         TEXT        PRIMARY KEY,
    value       TEXT        NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================================
-- RLS — Row Level Security
-- =========================================================================
-- Stratégie : aucun client (anon ou authenticated) ne peut lire ou écrire
-- ces tables directement. Toutes les opérations passent par les Edge Functions
-- qui utilisent SUPABASE_SERVICE_ROLE_KEY (bypass RLS).
-- C'est volontaire — on conserve le modèle d'auth PIN custom de la version Python
-- au lieu de basculer sur Supabase Auth, pour rétro-compat des PINs existants.

ALTER TABLE public.staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkins           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_notes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings       ENABLE ROW LEVEL SECURITY;

-- Aucune policy = aucun accès depuis client. Service role bypasse RLS automatiquement.

-- =========================================================================
-- Storage buckets : à créer manuellement via le Dashboard Supabase
-- =========================================================================
-- 1. Bucket "rise-uploads" : PRIVÉ. Stocke les photos check-ins.
--    Convention path : <pdv>/<YYYY-MM-DD>/<HHMMSS>_<category>.jpg
--    Accès : Edge Functions only (signed URLs pour les clients)
--
-- 2. Bucket "site" : PUBLIC. Stocke les assets du SPA (index.html, app.js, sw.js).
--    Accès : public read, write via Supabase CLI lors du déploiement.
