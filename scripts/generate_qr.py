#!/usr/bin/env python3
"""Génère les QR codes pour toutes les combinaisons (PdV, catégorie).

Chaque QR pointe vers la SPA équipier avec PdV + catégorie déjà pré-remplis :
  https://lmymalpq-hub.github.io/rise-supabase/?pdv=vh&category=terrasse

Génère aussi un PDF imprimable consolidé (qr_print.pdf, 3 pages, 6 QR par page).

Usage :
    python3 -m pip install 'qrcode[pil]' Pillow
    python3 scripts/generate_qr.py
"""

from pathlib import Path

import qrcode
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qr_output"
OUT.mkdir(exist_ok=True)

BASE_URL = "https://lmymalpq-hub.github.io/rise-supabase/"

PDV_LABELS = {
    "vh":     "Le Pain Quotidien Victor Hugo",
    "marais": "Le Pain Quotidien Marais",
}
CAT_LABELS = {
    "terrasse":           "Photo Terrasse",
    "comptoir":           "Photo Comptoir",
    "pertes-comptoir":    "Pertes Comptoir",
    "nettoyage-comptoir": "Nettoyage Comptoir",
    "fermeture-comptoir": "Fermeture Comptoir",
    "pertes-cuisine":     "Pertes Cuisine",
    "nettoyage-cuisine":  "Nettoyage Cuisine",
    "fermeture-cuisine":  "Fermeture Cuisine",
    "fermeture-salle":    "Fermeture Salle",
}

PDVS = list(PDV_LABELS.keys())
CATEGORIES = list(CAT_LABELS.keys())


def gen_pngs():
    n = 0
    for pdv in PDVS:
        for cat in CATEGORIES:
            url = f"{BASE_URL}?pdv={pdv}&category={cat}"
            img = qrcode.make(url, box_size=10, border=2)
            img.save(str(OUT / f"{pdv}_{cat}.png"))
            n += 1
    return n


def gen_pdf():
    PAGE_W, PAGE_H = 2480, 3508
    COLS, ROWS = 2, 3
    QR_SIZE = 1000
    MARGIN = 100
    GAP_X = (PAGE_W - 2 * MARGIN - COLS * QR_SIZE) // (COLS - 1)
    GAP_Y = 200

    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 60)
        font_small = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 40)
    except Exception:
        font = ImageFont.load_default()
        font_small = font

    combos = [(p, c) for p in PDVS for c in CATEGORIES]
    pages = []
    i = 0
    while i < len(combos):
        page = Image.new("RGB", (PAGE_W, PAGE_H), "white")
        draw = ImageDraw.Draw(page)
        draw.text((MARGIN, 30), "RISE — QR codes équipe LPQ", fill="#8b4513", font=font)
        draw.text(
            (MARGIN, 110),
            BASE_URL + "  ·  Coller à la station",
            fill="#6b5b4c", font=font_small,
        )
        for slot in range(COLS * ROWS):
            if i >= len(combos):
                break
            pdv, cat = combos[i]
            col = slot % COLS
            row = slot // COLS
            x = MARGIN + col * (QR_SIZE + GAP_X)
            y = 220 + row * (QR_SIZE + GAP_Y)
            qr = Image.open(OUT / f"{pdv}_{cat}.png").resize((QR_SIZE, QR_SIZE))
            page.paste(qr, (x, y))
            title = PDV_LABELS[pdv].replace("Le Pain Quotidien ", "LPQ ")
            sub = CAT_LABELS[cat]
            draw.text((x, y + QR_SIZE + 20), title, fill="#2c1810", font=font_small)
            draw.text((x, y + QR_SIZE + 80), sub, fill="#8b4513", font=font)
            i += 1
        pages.append(page)

    pdf = OUT / "qr_print.pdf"
    pages[0].save(str(pdf), save_all=True, append_images=pages[1:], resolution=300.0)
    return len(pages), pdf


if __name__ == "__main__":
    n = gen_pngs()
    print(f"OK : {n} PNG dans {OUT}")
    pages, pdf = gen_pdf()
    print(f"OK : PDF {pages} pages → {pdf}")
