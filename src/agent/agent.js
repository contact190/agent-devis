// L'agent : Claude comprend la demande, appelle les outils (moteur CalculDevis), répond.
// La clé API est lue dans la variable d'environnement ANTHROPIC_API_KEY (fichier .env).

import Anthropic from '@anthropic-ai/sdk';
import { OUTILS, executerOutil } from './outils.js';

export const MODELE = process.env.AGENT_MODELE || 'claude-sonnet-5-5';
const MAX_TOURS_OUTILS = 15;

export const CONSIGNES = `Tu es l'assistant devis d'Idéal Aluminium (menuiserie aluminium, Algérie). Tu parles français, simplement.

RÔLE
- Tu transformes une demande écrite en menuiseries calculées par le moteur CalculDevis (outil calculer_menuiserie).
- Tu ne calcules JAMAIS toi-même un prix, une cote ou une quantité : seuls les outils donnent des chiffres.
- Le catalogue CalculDevis fait foi : n'invente aucun id, ne propose jamais de corriger une règle du catalogue.

DÉROULEMENT
1. Appelle resume_catalogue pour connaître les ids (compositions, couleurs, vitrages, volet).
2. Pour chaque menuiserie, vérifie que tu as : composition (ou assemblage), largeur, hauteur, couleur, vitrage,
   sens d'ouverture (gauche par défaut), options. S'il y a un volet : caisson, axe, lame, lame finale,
   moteur ou sangle, kit, moteur si motorisé, et TOUJOURS la profondeur de l'ouverture.
3. S'il manque une information, pose UNE question courte qui regroupe tout ce qui manque. Ne devine pas.
   Utilise options_volet pour proposer uniquement des éléments compatibles.
4. Avant de calculer, affiche un RÉCAPITULATIF en tableau (une ligne par menuiserie) et demande « Je calcule ? ».
5. Après validation, appelle calculer_menuiserie pour chaque menuiserie et présente : désignation, quantité,
   prix unitaire HT, total HT, puis le total général HT et TTC. Signale toutes les alertes
   (ex. « PROBLÈME PROFONDEUR — raser »).
6. Si l'outil répond « manquants » ou « incompatible », explique-le simplement et propose les choix possibles.

RÈGLES MÉTIER
- Assemblé fixe + ouvrant : la hauteur du fixe se mesure jusqu'au haut de la traverse ; traverse = 25 mm ;
  l'ouverture prend automatiquement le reste. Le caisson est toujours déduit de la hauteur totale.
- Glissière : moteur → L invisible ; sangle → L visible ; caisson tunnel → Simple H25. Largeur choisie
  automatiquement selon la profondeur (largeur + 10 mm < profondeur), sinon alerte « raser ».
- Avance minimum 50 % pour passer en commande ; plan de chantier obligatoire ensuite (même pour une fenêtre).
- Écart de mesure réelle > +100 mm : devis à refaire ; < −100 mm : simple alerte.

STYLE
- Réponses courtes, tableaux pour les chiffres, montants en DA avec séparateur de milliers.
- Si tu remarques une habitude (ex. toujours la même couleur), propose de l'utiliser par défaut, sans l'imposer.`;

/**
 * Envoie un message à l'agent et renvoie sa réponse.
 * @param {Array} historique  messages précédents au format API (modifié sur place)
 * @param {string} texte      message de l'utilisateur
 * @param {object} [options]  { client, rappels: [] }
 */
export async function discuter(historique, texte, { client, rappels = [] } = {}) {
  const anthropic = client || new Anthropic();
  const contenu = rappels.length
    ? `[Rappels en cours]\n${rappels.map(r => `- ${r.client} : ${r.message}`).join('\n')}\n\n${texte}`
    : texte;
  historique.push({ role: 'user', content: contenu });

  const outils = OUTILS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));

  for (let tour = 0; tour < MAX_TOURS_OUTILS; tour++) {
    const reponse = await anthropic.messages.create({
      model: MODELE,
      max_tokens: 4096,
      system: CONSIGNES,
      tools: outils,
      messages: historique,
    });
    historique.push({ role: 'assistant', content: reponse.content });

    const appels = reponse.content.filter(b => b.type === 'tool_use');
    if (reponse.stop_reason !== 'tool_use' || appels.length === 0) {
      return reponse.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    }

    const resultats = [];
    for (const appel of appels) {
      const resultat = await executerOutil(appel.name, appel.input);
      resultats.push({ type: 'tool_result', tool_use_id: appel.id, content: JSON.stringify(resultat) });
    }
    historique.push({ role: 'user', content: resultats });
  }
  return "Je n'ai pas pu terminer : trop d'étapes. Pouvez-vous reformuler ou découper la demande ?";
}
