// Choix de la largeur de glissière à partir de la profondeur de l'ouverture.
// Règle du patron : il faut toujours 10 mm de plus que la profondeur.
// On prend la plus petite largeur disponible qui couvre profondeur + 10 mm.
// Exemple : profondeur 130 -> il faut 140 -> 120 ne suffit pas -> 145 (invisible) ou 150 (visible).
// Les largeurs viennent du catalogue CalculDevis (champ opt1Values de chaque glissière).

export const MARGE_GLISSIERE_MM = 10;

/** Largeurs disponibles d'une glissière, ex. [{ largeur: 85, valeur: '85 (20000 92002)' }, ...] */
export function largeursDisponibles(glissiere) {
  return String(glissiere?.opt1Values || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
    .map(valeur => ({ largeur: parseFloat(valeur), valeur }))
    .filter(l => !isNaN(l.largeur))
    .sort((a, b) => a.largeur - b.largeur);
}

/**
 * Renvoie la largeur à utiliser, ou une erreur si aucune largeur ne convient.
 * @returns {{ ok: true, largeur: number, valeur: string } | { ok: false, message: string }}
 */
export function choisirLargeurGlissiere(glissiere, profondeurMm) {
  const profondeur = Number(profondeurMm);
  if (!profondeur || profondeur <= 0) {
    return { ok: false, message: "Profondeur de l'ouverture manquante : elle est obligatoire pour choisir la glissière." };
  }
  const besoin = profondeur + MARGE_GLISSIERE_MM;
  const largeurs = largeursDisponibles(glissiere);
  const choix = largeurs.find(l => l.largeur >= besoin);
  if (!choix) {
    const max = largeurs.at(-1)?.largeur;
    return { ok: false, message: `Profondeur ${profondeur} mm : il faut au moins ${besoin} mm, la plus grande largeur de « ${glissiere?.name} » est ${max} mm.` };
  }
  return { ok: true, largeur: choix.largeur, valeur: choix.valeur };
}
