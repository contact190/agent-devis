// Serveur web : interface clients + discussion avec l'agent.
// Lancement : npm start  ->  http://localhost:3000

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as S from './stockage.js';
import { genererDevisPdf } from './pdf/devis-pdf.js';
import { calculerRappels } from './regles/rappels.js';
import { discuter, MODELE } from './agent/agent.js';
import { creerPlan, saisirMesures, accepterDevisRevise } from './chantier.js';
import { genererFicheMetreurPdf } from './pdf/fiche-metreur-pdf.js';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(dirname(fileURLToPath(import.meta.url)), '..', 'public')));

const route = fn => (req, res) => fn(req, res).catch(e => res.status(500).json({ erreur: e.message }));

// ───────────── Clients ─────────────
app.get('/api/clients', route(async (req, res) => res.json(await S.listerClients(String(req.query.q || '')))));
app.post('/api/clients', route(async (req, res) => res.json(await S.creerClient(req.body))));
app.get('/api/clients/:id', route(async (req, res) => {
  const client = await S.lireClient(req.params.id);
  if (!client) return res.status(404).json({ erreur: 'Client introuvable' });
  res.json({ ...client, devis: (await S.listerDevis(client.id)).map(({ lignes, ...d }) => ({ ...d, nbLignes: lignes.length })) });
}));
app.patch('/api/clients/:id', route(async (req, res) => {
  const c = await S.modifierClient(req.params.id, req.body);
  c ? res.json(c) : res.status(404).json({ erreur: 'Client introuvable' });
}));

// ───────────── Devis ─────────────
app.get('/api/devis/:id', route(async (req, res) => {
  const d = await S.lireDevis(req.params.id);
  d ? res.json(d) : res.status(404).json({ erreur: 'Devis introuvable' });
}));
app.get('/api/devis/:id/pdf', route(async (req, res) => {
  const devis = await S.lireDevis(req.params.id);
  if (!devis) return res.status(404).json({ erreur: 'Devis introuvable' });
  const pdf = await genererDevisPdf(devis, await S.lireClient(devis.clientId));
  res.type('application/pdf').set('Content-Disposition', `inline; filename="${devis.id}.pdf"`).send(pdf);
}));
app.post('/api/devis/:id/statut', route(async (req, res) => res.json(await S.changerStatutDevis(req.params.id, req.body.statut))));
app.post('/api/devis/:id/avance', route(async (req, res) => res.json(await S.enregistrerAvance(req.params.id, req.body.montant))));

// ───────────── Plan de chantier et mesures ─────────────
app.post('/api/devis/:id/plan', route(async (req, res) => res.json(await creerPlan(req.params.id, req.body.etages))));
app.post('/api/devis/:id/mesures', route(async (req, res) => res.json(await saisirMesures(req.params.id, req.body.mesures))));
app.post('/api/devis/:id/accepter', route(async (req, res) => res.json(await accepterDevisRevise(req.params.id))));
app.get('/api/devis/:id/fiche-metreur', route(async (req, res) => {
  const devis = await S.lireDevis(req.params.id);
  if (!devis?.planChantier) return res.status(404).json({ erreur: 'Pas de plan de chantier pour ce devis' });
  const pdf = await genererFicheMetreurPdf(devis, await S.lireClient(devis.clientId));
  res.type('application/pdf').set('Content-Disposition', `inline; filename="Fiche-metreur-${devis.id}.pdf"`).send(pdf);
}));

// ───────────── Rappels ─────────────
async function rappels() {
  const clients = await S.listerClients();
  const nom = id => clients.find(c => c.id === id)?.nom || id;
  const devis = (await S.listerDevis()).filter(d => !['remplace', 'annule'].includes(d.statut));
  return calculerRappels(devis.map(d => ({
    client: `${nom(d.clientId)} (${d.id})`,
    statut: d.statut, totalTTC: d.totalTTC, dateEnvoi: d.dateEnvoi,
    avance: d.avances.reduce((s, a) => s + a.montant, 0),
    planChantier: d.planChantier || null, datePlan: d.datePlan,
    mesuresValidees: d.mesuresValidees, dateMesures: d.dateMesures,
    devisRevise: d.attenteAccordClient ? { valideParClient: false } : null, dateDevisRevise: d.dateDevisRevise,
    fabricationLancee: d.fabricationLancee,
  })));
}
app.get('/api/rappels', route(async (req, res) => res.json(await rappels())));

// ───────────── Discussion avec l'agent ─────────────
const conversations = new Map(); // conversations en mémoire, une par onglet ouvert
app.get('/api/etat', (req, res) => res.json({ agentDisponible: !!process.env.ANTHROPIC_API_KEY, modele: MODELE }));
app.post('/api/chat', route(async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.json({ reponse: "L'agent n'est pas encore branché : la clé API Claude doit être ajoutée dans le fichier .env." });
  }
  const id = req.body.conversationId || randomUUID();
  const historique = conversations.get(id) || [];
  const premierMessage = historique.length === 0;
  let contexte = '';
  if (req.body.clientId) {
    const c = await S.lireClient(req.body.clientId);
    if (c) contexte = `Fiche client ouverte : ${c.nom} (id ${c.id}).`;
  }
  const reponse = await discuter(historique, String(req.body.message || ''), {
    contexte, rappels: premierMessage ? await rappels() : [],
  });
  conversations.set(id, historique);
  res.json({ conversationId: id, reponse });
}));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Agent devis : http://localhost:${PORT}`));
