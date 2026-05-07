-- Sprint TS-16 : portage des voicenotes superviseur + transcription Gemini

-- Frameworks (canevas affichés au superviseur pendant l'enregistrement)
CREATE TABLE IF NOT EXISTS public.frameworks (
    id          BIGSERIAL   PRIMARY KEY,
    zone        TEXT        NOT NULL UNIQUE,         -- 'salle' | 'cuisine'
    title       TEXT        NOT NULL,
    content     TEXT        NOT NULL,                -- markdown / texte structuré
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Voice briefings (1 row par briefing audio post-service)
CREATE TABLE IF NOT EXISTS public.voice_briefings (
    id                  BIGSERIAL   PRIMARY KEY,
    pdv                 TEXT        NOT NULL,
    zone                TEXT        NOT NULL,             -- 'salle' | 'cuisine'
    service_date        TEXT        NOT NULL,             -- 'YYYY-MM-DD'
    service_slot        TEXT        NOT NULL,             -- 'morning' | 'afternoon' | 'full_day'
    supervisor_staff_id BIGINT      REFERENCES public.staff(id) ON DELETE SET NULL,
    supervisor_name     TEXT,
    status              TEXT        NOT NULL DEFAULT 'draft',  -- draft | uploading | transcribing | done | failed
    audio_files         JSONB,                          -- [{filename, size, duration_sec, uploaded_at}]
    raw_transcription   TEXT,
    synthesis           TEXT,
    synthesis_meta      JSONB,                          -- {model, tokens_in, tokens_out, cost_estimate}
    error_msg           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_briefings_date    ON public.voice_briefings(pdv, service_date DESC);
CREATE INDEX IF NOT EXISTS idx_briefings_status  ON public.voice_briefings(status);
CREATE INDEX IF NOT EXISTS idx_briefings_supervisor ON public.voice_briefings(supervisor_staff_id, created_at DESC);

ALTER TABLE public.frameworks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voice_briefings ENABLE ROW LEVEL SECURITY;
