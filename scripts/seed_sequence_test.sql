-- Séquence test : Marais + Fermeture Comptoir
-- À exécuter via : supabase db execute -f scripts/seed_sequence_test.sql --linked
-- ou coller dans Supabase Studio → SQL Editor

BEGIN;

-- Désactive toute ancienne séquence sur la même paire pour éviter les doublons
UPDATE public.category_sequences
SET active = false
WHERE pdv = 'marais' AND category = 'fermeture-comptoir';

-- Crée la séquence
WITH new_seq AS (
  INSERT INTO public.category_sequences (pdv, category, title, active)
  VALUES ('marais', 'fermeture-comptoir', 'Fermeture comptoir Marais — checklist soir', true)
  RETURNING id
)
INSERT INTO public.category_steps (sequence_id, order_idx, name, hint, optional, active)
SELECT new_seq.id, x.ord, x.name, x.hint, x.optional, true
FROM new_seq, (VALUES
  (1, 'Vitrine pâtisseries vidée', 'Tous les produits retirés, vitrine essuyée', false),
  (2, 'Machine à café rincée', 'Cycle de rinçage lancé + bac à marc vidé', false),
  (3, 'Comptoir essuyé', 'Plateaux, étagères, plan de travail dégraissés', false),
  (4, 'Caisse fermée + Z', 'Ticket Z imprimé et rangé dans le coffre', false),
  (5, 'Lumières comptoir éteintes', 'Optionnel — vérification finale', true)
) AS x(ord, name, hint, optional);

COMMIT;

-- Vérification
SELECT s.id AS seq_id, s.title, st.order_idx, st.name, st.hint, st.optional
FROM public.category_sequences s
JOIN public.category_steps st ON st.sequence_id = s.id
WHERE s.pdv = 'marais' AND s.category = 'fermeture-comptoir' AND s.active = true
ORDER BY st.order_idx;
