// Catalogue CalculDevis toujours à jour, sans action manuelle.
//
// Fonctionnement :
// - Au premier besoin, le catalogue est téléchargé (lecture seule).
// - Ensuite, avant chaque calcul, on regarde le petit fichier meta.json de CalculDevis
//   (quelques Ko) au plus une fois par minute. Il contient une empreinte du catalogue :
//   si elle a changé (un prix ou une formule modifié dans CalculDevis), on recharge.
// - Si Supabase ne répond pas, on continue avec la dernière version connue.
//
// Plus tard (étape 4) : les prix du fournisseur arriveront aussi automatiquement depuis Dropbox.

const BASE = 'https://uxfktjdibabwcjinynlk.supabase.co/storage/v1/object/public/app-state';
const INTERVALLE_VERIFICATION_MS = 60_000;

let catalogue = null;
let empreinte = null;
let derniereVerification = 0;
let miseAJour = null;

async function telechargerJson(nom) {
  const reponse = await fetch(`${BASE}/${nom}?t=${Date.now()}`);
  if (!reponse.ok) throw new Error(`${nom} : code ${reponse.status}`);
  return reponse.json();
}

async function recharger(nouvelleEmpreinte) {
  const donnees = await telechargerJson('catalog.json');
  // L'agent n'a pas besoin des comptes utilisateurs ni des journaux d'accès.
  delete donnees.userAccounts;
  delete donnees.accessLogs;
  catalogue = donnees;
  empreinte = nouvelleEmpreinte;
  console.log(`[catalogue] chargé (empreinte ${empreinte ?? 'inconnue'})`);
}

async function verifier() {
  derniereVerification = Date.now();
  let empreinteCloud = null;
  try {
    empreinteCloud = (await telechargerJson('meta.json'))?.hashes?.catalog ?? null;
  } catch (e) {
    if (catalogue) {
      console.warn(`[catalogue] vérification impossible, on garde la version actuelle (${e.message})`);
      return;
    }
  }
  if (!catalogue || empreinteCloud === null || empreinteCloud !== empreinte) {
    await recharger(empreinteCloud);
  }
}

/** Renvoie le catalogue à jour. À appeler avant chaque calcul. */
export async function getCatalogue() {
  const aVerifier = !catalogue || Date.now() - derniereVerification > INTERVALLE_VERIFICATION_MS;
  if (aVerifier) {
    // Une seule mise à jour à la fois, même si plusieurs demandes arrivent ensemble.
    miseAJour ??= verifier().finally(() => { miseAJour = null; });
    try {
      await miseAJour;
    } catch (e) {
      if (!catalogue) throw new Error(`Catalogue CalculDevis indisponible : ${e.message}`);
      console.warn(`[catalogue] mise à jour échouée, version actuelle conservée (${e.message})`);
    }
  }
  return catalogue;
}
