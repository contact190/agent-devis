// Discussion avec l'agent dans le terminal.
// Lancement : npm run discuter   (la clé doit être dans le fichier .env)
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { discuter, MODELE } from '../src/agent/agent.js';

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Clé API manquante : copiez .env.example en .env et mettez-y votre clé.');
  process.exit(1);
}
const rl = readline.createInterface({ input: stdin, output: stdout });
const historique = [];
console.log(`Agent devis (${MODELE}). Écrivez votre demande, ou « quitter ».\n`);
while (true) {
  const texte = (await rl.question('Vous > ')).trim();
  if (!texte) continue;
  if (/^(quitter|exit)$/i.test(texte)) break;
  try {
    console.log(`\nAgent > ${await discuter(historique, texte)}\n`);
  } catch (e) {
    console.error(`\nErreur : ${e.message}\n`);
  }
}
rl.close();
