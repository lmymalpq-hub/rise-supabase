# Brief équipe — bascule RISE Supabase

> Script à lire à voix haute en début de service le jour du switch.
> ~10 min. Faire 1× au PdV Victor Hugo, 1× au PdV Marais.

---

## 1. Pourquoi on change (1 min)

> "On bascule l'app RISE sur une nouvelle infrastructure. **Côté vous, rien ne change visuellement** ou presque. C'est juste une nouvelle URL et de nouveaux QR codes. **Vos PIN restent les mêmes.**"

**Pourquoi techniquement** (à mentionner si quelqu'un demande) :
- Plus rapide (images chargées **150× plus vite** qu'avant)
- Plus fiable (serveur cloud Supabase, plus le Mac de Marwan)
- Préparé pour grossir (Herbonata + autres apps partagent la même infra)

---

## 2. La nouvelle URL (2 min)

> "L'ancienne URL ne fonctionne plus à partir de demain. La nouvelle URL est :
>
> **https://lmymalpq-hub.github.io/rise-supabase/**
>
> Je vous l'envoie dans le WhatsApp principal. Vous l'ouvrez, vous tapez votre PIN habituel, et vous re-installez l'icône sur votre écran d'accueil."

**iPhone :** ouvrir le lien dans Safari → bouton Partager → "Sur l'écran d'accueil"
**Android :** ouvrir dans Chrome → menu ⋮ → "Installer l'application"

---

## 3. Les nouveaux QR codes (2 min)

> "Les QR codes que vous avez aux stations sont changés. **Marwan repasse les coller** ce matin / ce soir. Le geste reste pareil :
> 1. Tu pointes l'appareil photo natif sur le QR
> 2. La page s'ouvre déjà avec PdV + catégorie pré-remplis
> 3. Tap photo → tap envoyer. Fini.

**Si tu vois un ancien QR sur une station** (oublié) : préviens-moi, je viens recoller.

---

## 4. Ce qui reste pareil (1 min)

- **Ton PIN** : pas changé. Si "0432" marchait avant, "0432" marche toujours.
- **Tes notifs** : si tu avais activé les notifs sur l'ancienne app, **tu dois ré-activer** sur la nouvelle (Safari/Chrome demande à nouveau l'autorisation).
- **Tes anciennes photos** : toutes conservées et visibles côté Marwan.
- **Tes scores et streak dopamine** : conservés. Tu retrouves tes points cumulés.

---

## 5. Nouveautés (1 min)

> "Sur la nouvelle version :
> - Les **catégories sont groupées par zone** (Salle / Comptoir / Cuisine) → plus rapide à trouver
> - Les **photos chargent 100× plus vite** dans le dashboard de Marwan
> - Si tu reçois une remarque de Marwan avec une photo annotée, tu **vois la photo directement** dans 'Mes retours' (avant fallait deviner)"

---

## 6. Si ça beugue (1 min)

| Problème | Action |
|---|---|
| "Je tape mon PIN, ça refuse" | Tu vérifies que tu es bien sur la nouvelle URL (lmymalpq-hub.github.io) et pas l'ancienne |
| "Je clique sur le QR, rien se passe" | Tu ouvres l'app installée sur ton écran d'accueil, et tu choisis manuellement PdV + catégorie |
| "Je suis bloqué dans 'Chargement...'" | Tu fais un swipe vers le bas (refresh) ou tu fermes/réouvres l'app |
| "Truc bizarre" | Screenshot + WhatsApp à Marwan |

---

## 7. Marche à suivre côté Marwan (post-brief)

- [ ] Coller TOUS les nouveaux QR codes aux stations dans la foulée du brief
- [ ] Envoyer le lien `https://lmymalpq-hub.github.io/rise-supabase/` dans le WhatsApp principal
- [ ] Vérifier 1× avec chaque salarié que la PWA est bien installée
- [ ] À H+2 du 1er service : checker dans le dashboard que les premiers check-ins arrivent
- [ ] À H+24 : désactiver l'ancien serveur Python sur le Mac (kill process + retirer du startup)

---

## 8. Plan de rollback

Si **dans la première semaine** un problème majeur empêche l'équipe de bosser :

1. Marwan relance le serveur Python sur le Mac (`cd rise/ && python3 server.py`)
2. Recolle les anciens QR codes
3. Envoie l'ancienne URL `https://10.0.90.42:8788` dans le WhatsApp
4. Les données accumulées sur Supabase resteront — on peut migrer dans l'autre sens si besoin

Le repo `rise` (Python) **reste à jour et fonctionnel** pendant la transition. Pas de panique.
