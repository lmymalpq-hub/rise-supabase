-- Sprint TS-15 : portage des séquences guidées (wizard mode photo)
--
-- 1 séquence par (pdv, category) qui force un workflow step-by-step pour
-- les catégories complexes (nettoyage cuisine notamment).
-- Si pas de séquence active pour le combo → mode libre (comportement original).

CREATE TABLE IF NOT EXISTS public.category_sequences (
    id          BIGSERIAL   PRIMARY KEY,
    pdv         TEXT        NOT NULL,
    category    TEXT        NOT NULL,
    title       TEXT        NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(pdv, category)
);

CREATE TABLE IF NOT EXISTS public.category_steps (
    id                 BIGSERIAL   PRIMARY KEY,
    sequence_id        BIGINT      NOT NULL REFERENCES public.category_sequences(id) ON DELETE CASCADE,
    order_idx          INTEGER     NOT NULL,
    name               TEXT        NOT NULL,
    hint               TEXT,
    model_photo_path   TEXT,
    model_annotations  JSONB,
    optional           BOOLEAN     NOT NULL DEFAULT FALSE,
    active             BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_seq ON public.category_steps(sequence_id, active, order_idx);

-- FK manquante côté checkins.step_id (ajoutée maintenant que la table existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'checkins_step_id_fkey'
        AND table_name = 'checkins'
    ) THEN
        ALTER TABLE public.checkins
            ADD CONSTRAINT checkins_step_id_fkey
            FOREIGN KEY (step_id) REFERENCES public.category_steps(id) ON DELETE SET NULL;
    END IF;
END $$;

-- RLS strict (toutes les opérations passent par les Edge Functions service_role)
ALTER TABLE public.category_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_steps     ENABLE ROW LEVEL SECURITY;
