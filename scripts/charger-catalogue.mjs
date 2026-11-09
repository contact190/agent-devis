// Télécharge le catalogue de CalculDevis (profilés, compositions, volets, prix, formules)
// en LECTURE SEULE et l'enregistre dans data/catalogue.json (jamais envoyé sur GitHub).
// Les comptes utilisateurs et journaux d'accès sont retirés : l'agent n'en a pas besoin.

import { mkdir, writeFile } from 'node:fs/promises';

const URL_CATALOGUE = 'https://uxfktjdibabwcjinynlk.supabase.co/storage/v1/object/public/app-state/catalog.json';

const reponse = await fetch(`${URL_CATALOGUE}?t=${Date.now()}`);
if (!reponse.ok) {
  console.error(`Échec du téléchargement du catalogue (code ${reponse.status})`);
  process.exit(1);
}
const catalogue = await reponse.json();
delete catalogue.userAccounts;
delete catalogue.accessLogs;

await mkdir('data', { recursive: true });
await writeFile('data/catalogue.json', JSON.stringify(catalogue));

const sc = catalogue.shutterComponents || {};
console.log(`Catalogue chargé : ${catalogue.compositions?.length} compositions, ${catalogue.profiles?.length} profilés, ` +
  `${catalogue.accessories?.length} accessoires, ${catalogue.glass?.length} vitrages, ` +
  `${Object.values(sc).reduce((n, l) => n + l.length, 0)} composants de volet.`);
