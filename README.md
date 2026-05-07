# RISE — version Supabase 100%

> PWA conformité photo pour les équipes des 2 LPQ (Victor Hugo + Marais)
> en architecture **full Supabase** (pas de serveur applicatif tiers).

## Pourquoi 2 versions ?

| Repo | Stack | Statut |
|---|---|---|
| [`rise`](https://github.com/lmymalpq-hub/rise) | **Python** + SQLite + serveur HTTP custom | 🟢 **Fallback de secours**, version stable, conservée intacte |
| [`rise-supabase`](https://github.com/lmymalpq-hub/rise-supabase) **(ce repo)** | **TypeScript** Edge Functions + Postgres + Storage + Auth | 🚧 **En cours de réécriture** vers une stack 100% Supabase |

Les deux sont volontairement maintenues en parallèle : si la version Supabase pose problème en prod (cold start, limite Edge Function, coût, etc.), on revient sur la version Python sans drama.

## Architecture

```
   Équipiers (mobile)
          │  HTTPS
          ▼
  ┌────────────────────────────────────────┐
  │         SUPABASE (tout-en-un)           │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Storage bucket "site" (public)    │ │ ← sert index.html, app.js, sw.js
  │  └────────────────────────────────────┘ │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Edge Functions (TypeScript/Deno)  │ │ ← API : /auth, /upload, /notes, etc.
  │  └────────────────────────────────────┘ │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Database (Postgres)                │ │ ← staff, checkins, sessions, staff_notes
  │  └────────────────────────────────────┘ │
  │                                          │
  │  ┌────────────────────────────────────┐ │
  │  │ Storage bucket "rise-uploads" (priv)│ │ ← photos uploadées par les équipiers
  │  └────────────────────────────────────┘ │
  └────────────────────────────────────────┘
```

**Aucun service tiers** (ni Vercel, ni Railway, ni VPS) — tout sur Supabase.

## Structure du repo

```
rise-supabase/
├── README.md                    ← ce fichier
├── supabase/
│   ├── config.toml              ← config locale Supabase CLI
│   ├── migrations/              ← schema Postgres + RLS policies
│   │   └── 0001_init.sql
│   └── functions/               ← Edge Functions TypeScript
│       ├── _shared/             ← code partagé (auth, db, env)
│       ├── auth/                ← POST /auth — login PIN équipier/admin
│       ├── upload/              ← POST /upload — upload photo + insert checkin
│       ├── me-notes/            ← GET /me/notes — feedbacks de l'équipier
│       ├── me-notes-read/       ← POST /me/notes/:id/read — acquittement
│       ├── checkins-annotate/   ← POST /checkins/:id/annotate — annotation Marwan
│       └── staff-stats/         ← GET /staff/:id/stats — fiche équipier
└── docs/
    ├── public/                  ← assets statiques (icons, manifest, sw.js)
    └── src/                     ← SPA (HTML + CSS + JS, rendue depuis Storage)
```

## Variables d'environnement (Edge Functions)

| Variable | Rôle |
|---|---|
| `SUPABASE_URL` | URL du projet Supabase (auto fournie côté Edge) |
| `SUPABASE_SERVICE_ROLE_KEY` | clé admin pour bypass RLS dans les Edge Functions (auto) |
| `RISE_PIN_PEPPER` | secret pour HMAC PIN (à set manuellement dans Supabase Dashboard) |
| `RISE_VAPID_PUBLIC_KEY` / `RISE_VAPID_PRIVATE_KEY` | Web Push VAPID |
| `RISE_VAPID_SUBJECT` | mailto pour VAPID |
| `RISE_GEMINI_API_KEY` | API Gemini pour transcription voicenotes (Sprint futur) |

## Déploiement

### Pré-requis (toi, humain)

1. Compte Supabase + projet créé
2. Bucket Storage `rise-uploads` (privé) créé
3. Bucket Storage `site` (public) créé pour servir le SPA
4. Variables d'env posées dans Supabase Dashboard → Settings → Edge Functions → Secrets

### Déploiement (CLI)

```bash
# Premier setup (une fois)
supabase login
supabase link --project-ref <ton-project-ref>

# Déployer le schema DB
supabase db push

# Déployer toutes les Edge Functions
supabase functions deploy

# Déployer le SPA dans le bucket "site"
supabase storage cp -r docs/public/ ss:///site/
```

## État actuel — Sprint 1 (TypeScript scaffolding)

- [x] Repo créé + structure dossiers
- [x] Schema Postgres adapté depuis SQLite (`supabase/migrations/0001_init.sql`)
- [x] RLS policies basiques (PIN auth via service_role, pas d'accès direct client)
- [x] Edge Function `auth` (login PIN PBKDF2 compatible avec la version Python)
- [x] Edge Function `upload` (multipart → Storage + insert checkin)
- [ ] Edge Functions `me-notes`, `me-notes-read`, `checkins-annotate`, `staff-stats`
- [ ] SPA frontend dans `docs/`
- [ ] Web Push VAPID (Edge Function dédiée)
- [ ] Script de migration des données existantes (SQLite → Postgres)
- [ ] Tests E2E
- [ ] Bascule prod

## Migration depuis la version Python

Quand le côté Supabase sera prêt et testé, un script `scripts/migrate_from_python.ts` exportera :
1. Toutes les rows de `checkins.db` (Python) → INSERT dans Postgres Supabase
2. Toutes les photos `uploads/<pdv>/<date>/...` → upload vers bucket `rise-uploads`
3. Le pepper PBKDF2 sera réutilisé pour que les PINs existants continuent de fonctionner

Aucune donnée perdue. La version Python reste opérationnelle pendant la bascule.
