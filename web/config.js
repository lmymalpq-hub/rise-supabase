// Configuration injectée au build et lue par index.html.
// La SUPABASE_ANON_KEY est publique par design — elle sert juste à passer
// l'API gateway. Toute l'auth réelle se fait via les Edge Functions custom.
window.RISE_CONFIG = {
  SUPABASE_URL: "https://hndbsoxmqtznbnyjqjen.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhuZGJzb3htcXR6bmJueWpxamVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzkzODQsImV4cCI6MjA5MzY1NTM4NH0.HKYKCA4GXT7fMAG4H-WR3hWtlamNQZL6bDpio2rFgLo",
  STATIONS: {
    pdv: {
      vh: "Le Pain Quotidien Victor Hugo",
      marais: "Le Pain Quotidien Marais",
    },
    pdv_emoji: { vh: "🏛️", marais: "⛲" },
    categories: {
      terrasse: "Photo Terrasse",
      comptoir: "Photo Comptoir",
      "pertes-comptoir": "Pertes Comptoir",
      "nettoyage-comptoir": "Nettoyage Comptoir",
      "fermeture-comptoir": "Fermeture Comptoir",
      "pertes-cuisine": "Pertes Cuisine",
      "nettoyage-cuisine": "Nettoyage Cuisine",
      "fermeture-cuisine": "Fermeture Cuisine",
      "fermeture-salle": "Fermeture Salle",
    },
    category_emoji: {
      terrasse: "🪑",
      comptoir: "🥐",
      "pertes-comptoir": "🥖",
      "nettoyage-comptoir": "🧽",
      "fermeture-comptoir": "🌙",
      "pertes-cuisine": "🍳",
      "nettoyage-cuisine": "🧹",
      "fermeture-cuisine": "🌙",
      "fermeture-salle": "🌙",
    },
  },
};
