// Teste la boucle de l'agent SANS clé API : un faux Claude demande un outil puis répond.
import { discuter } from '../src/agent/agent.js';

let appel = 0;
const fauxClaude = {
  messages: {
    create: async ({ messages }) => {
      appel++;
      if (appel === 1) {
        return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'calculer_menuiserie', input: {
          L: 1000, H: 1900, couleurId: 'RAL7024M', vitrageId: '5/12/5',
          assemblage: { type: 'fix_ouvrant', orientation: 'vertical', traverseId: 'P-1777190967369-943',
            parties: [{ type: 'opening', compositionId: 'COMP-1776870207633' }, { type: 'fixe', compositionId: 'COMP-1776940195996', dimension: 900 }] },
        } }] };
      }
      const resultat = JSON.parse(messages.at(-1).content[0].content);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: `Total HT : ${resultat.prix.prixUnitaireHT} DA` }] };
    },
  },
};

const historique = [];
const reponse = await discuter(historique, 'Fixe bas 900 + ouvrant H40 2V, 1000x1900, gris, 5/12/5', { client: fauxClaude });
const ok = reponse === 'Total HT : 36549.29 DA' && historique.length === 4;
console.log(`${ok ? 'OK   ' : 'ECHEC'} Boucle agent → outil → réponse : « ${reponse} » (${historique.length} messages)`);
process.exit(ok ? 0 : 1);
