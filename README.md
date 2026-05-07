# RISE — version Supabase

> PWA conformité photo pour les équipes des 2 LPQ (Victor Hugo + Marais).
> **Backend 100% Supabase** (Edge Functions + Postgres + Storage privé).
> **Frontend** servi par GitHub Pages (workaround : Supabase ne sert pas
> de text/html par sécurité — voir section Hébergement).

## Pourquoi 2 versions ?

| Repo | Stack | Statut |
|---|---|---|
| [`rise`](https://github.com/lmymalpq-hub/rise) | **Python** + SQLite + serveur HTTP custom | 🟢 Fallback de secours, version stable, conservée intacte |
| [`rise-supabase`](https://github.com/lmymalpq-hub/rise-supabase) **(ce repo)** | **TypeScript** Edge Functions + Postgres + Storage | 🚧 En réécriture progressive |

Les deux sont volontairement maintenues en parallèle : si la version Supabase pose problème en prod (cold start, limite Edge Function, coût, etc.), on revient sur la version Python sans drama.

## URLs

- **App équipiers** : https://lmymalpq-hub.github.io/rise-supabase/
- **Dashboard Supabase** : https://supabase.com/dashboard/project/hndbsoxmqtznbnyjqjen
- **Edge Functions API** : https://hndbsoxmqtznbnyjqjen.supabase.co/functions/v1/

## Architecture

```
   Équipiers (mobile, PWA installable)
          │
          │  HTML/CSS/JS chargé depuis GitHub Pages (gratuit)
          ▼
  ┌────────────────────────────────────┐
  │  GitHub Pages — docs/index.html    │ ← shell HTML/JS uniquement
  └────────────────┬───────────────────┘
                   │  fetch() vers les Edge Functions
                   ▼
  ┌────────────────────────────────────────┐
  │       SUPABASE (backend complet)         │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ 8 Edge Functions (TypeScript/Deno) │ │ ← /auth, /upload, /me-notes, etc.
  │  └────────────────────────────────────┘ │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Database (Postgres) avec RLS strict │ │
  │  └────────────────────────────────────┘ │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Storage bucket "rise-uploads" (priv)│ │ ← photos servies via signed URLs
  │  └────────────────────────────────────┘ │
  └────────────────────────────────────────┘
```

**Pourquoi pas tout sur Supabase pour le frontend ?** Supabase Storage et Edge Runtime forcent `Content-Type: text/plain` + `X-Content-Type-Options: nosniff` sur tout HTML, par mesure anti-phishing. Du coup le shell HTML/CSS/JS est servi gratuitement par GitHub Pages depuis le dossier `docs/`. Tout le backend (DB, Edge Functions, Storage photos) reste 100% Supabase.

## Structure du repo

```
rise-supabase/
├── README.md                           ← ce fichier
├── .env.example                        ← template variables (vraies valeurs en local .env.local gitignored)
├── docs/                               ← SPA hébergée par GitHub Pages
│   ├── index.html                      ← shell HTML+CSS+JS (~30 KB)
│   ├── config.js                       ← URL Supabase + ANON_KEY + catalog stations
│   ├── api.js                          ← wrapper autour des Edge Functions
│   ├── sw.js                           ← service worker offline + Web Push
│   ├── manifest.json                   ← PWA installable
│   └── icon-192.png, icon-512.png
├── supabase/
│   ├── config.toml                     ← config CLI
│   ├── migrations/0001_init.sql        ← schema Postgres + indexes + RLS
│   └── functions/                      ← Edge Functions TypeScript
│       ├── _shared/{auth,db,cors}.ts   ← helpers partagés
│       ├── auth/                       ← POST /auth (login PIN PBKDF2)
│       ├── upload/                     ← POST /upload (photo → Storage)
│       ├── me-notes/                   ← GET /me/notes (notes équipier)
│       ├── me-notes-read/              ← POST /me/notes/:id/read (acquittement)
│       ├── me-notes-unread-count/      ← GET /me/notes/unread-count
│       ├── me-dopamine-stats/          ← GET /me/dopamine-stats
│       ├── checkins-annotate/          ← POST admin annotation + bridge staff_note
│       └── staff-stats/                ← GET /staff/:id/stats (fiche admin)
└── scripts/
    └── migrate_from_python.py          ← script one-shot SQLite → Postgres + Storage
```

## Variables d'environnement (Edge Functions Secrets)

| Variable | Rôle |
|---|---|
| `SUPABASE_URL` | URL du projet (auto fournie par le runtime) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé admin pour bypass RLS (auto) |
| `RISE_PIN_PEPPER` | secret HMAC PIN (réutilisé du repo Python) |
| `RISE_VAPID_PUBLIC_KEY` / `RISE_VAPID_PRIVATE_PEM` | clés Web Push VAPID |
| `RISE_VAPID_SUBJECT` | mailto pour VAPID |

## Déploiement

### Côté code

```bash
# Setup (une fois)
supabase login
supabase link --project-ref hndbsoxmqtznbnyjqjen

# Schema DB (idempotent)
supabase db push

# Déploiement Edge Functions
supabase functions deploy --no-verify-jwt

# Push GitHub → GitHub Pages auto-redeploy en 30 sec
git push origin main
```

### Côté données (one-shot)

```bash
export SUPABASE_ACCESS_TOKEN="sbp_..."
python3 scripts/migrate_from_python.py
```

## État actuel — Sprint TS-12 livré

- [x] Repo + schema Postgres + buckets Storage + secrets
- [x] 8 Edge Functions ACTIVE et testées en prod (auth, upload, me-notes, me-notes-read, me-notes-unread-count, me-dopamine-stats, checkins-annotate, staff-stats)
- [x] Migration des données depuis le repo Python (4 staff, 19 checkins, 19 staff_notes, 18 photos)
- [x] SPA équipier MVP (login PIN, picker PdV+cat, upload photo, modale notes + acquittement)
- [x] PWA manifest + service worker
- [ ] Edge Function `push-send` (Web Push VAPID) — Sprint TS-14
- [ ] Dashboard admin (web/dashboard.html) — Sprint TS-13
- [ ] Tests E2E sur tel équipier réel
- [ ] Bascule prod (régénération QR codes + brief équipe)

## Compatibilité avec la version Python

- Les **PINs PBKDF2** existants restent valides (même pepper, mêmes 200k iter).
- Les **abonnements Web Push** existants restent valides (mêmes clés VAPID).
- Le format `note_date` suffixé `'#cN'` (Sprint 5 Python) est conservé.

Aucune donnée perdue, aucun changement côté équipier au moment de la bascule (autre que l'URL).
