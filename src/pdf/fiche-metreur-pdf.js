// Fiche du métreur : une ligne par ouverture du plan de chantier, avec les cotes du devis
// et des cases vides à remplir sur le chantier (même colonnes que CalculDevis).

import PDFDocument from 'pdfkit';
import { getCatalogue } from '../catalogue.js';
import { ouverturesDuPlan } from '../chantier.js';

const mm = v => v * 2.8346;
const BLEU = '#1e3a8a', GRIS = '#64748b';

export async function genererFicheMetreurPdf(devis, client) {
  const qs = (await getCatalogue()).quoteSettings || {};
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: mm(12), bufferPages: true, info: { Title: `Fiche métreur ${devis.id}` } });
  const morceaux = [];
  doc.on('data', b => morceaux.push(b));
  const fin = new Promise(r => doc.on('end', () => r(Buffer.concat(morceaux))));

  const gauche = mm(12), droite = doc.page.width - mm(12), largeur = droite - gauche;
  const cols = [
    { t: 'Repère', w: 22 }, { t: 'Emplacement', w: 26 }, { t: 'Menuiserie (devis)', w: 52 }, { t: 'Cotes devis', w: 24 },
    { t: 'Larg. réelle', w: 22 }, { t: 'Haut. réelle', w: 22 }, { t: 'Ép. mur', w: 18 }, { t: 'H. poignée', w: 19 },
    { t: 'Sens G/D', w: 16 }, { t: 'LV volet', w: 17 },
  ];
  const fixe = cols.reduce((s, c) => s + c.w, 0);
  cols.push({ t: 'Observations', w: largeur / 2.8346 - fixe });
  let x = gauche; cols.forEach(c => { c.x = x; c.w = mm(c.w); x += c.w; });

  const entete = () => {
    if (qs.logoBase64?.startsWith('data:image')) {
      try { doc.image(Buffer.from(qs.logoBase64.split(',')[1], 'base64'), gauche, mm(8), { fit: [mm(32), mm(14)] }); } catch { /* ignoré */ }
    }
    doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(14).text('FICHE MÉTREUR — RELEVÉ DES COTES', gauche + mm(40), mm(9));
    doc.fillColor('#0f172a').font('Helvetica').fontSize(9)
      .text(`Client : ${client?.nom || ''}   ·   Commande : ${devis.id}   ·   Adresse : ${client?.adresse || '—'}`, gauche + mm(40), mm(16));
    doc.fillColor(GRIS).fontSize(8)
      .text('Mesures en mm. Écart de plus de +10 cm avec le devis = devis à refaire. Ép. mur obligatoire pour les volets roulants.', gauche + mm(40), mm(21));
    return mm(28);
  };
  const enTeteTableau = y => {
    doc.rect(gauche, y, largeur, mm(7)).fill(BLEU);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(7.5);
    cols.forEach(c => doc.text(c.t, c.x + mm(1), y + mm(2.3), { width: c.w - mm(2), align: 'center', lineBreak: false }));
    return y + mm(7);
  };

  let y = enTeteTableau(entete());
  const hLigne = mm(11);
  let etageCourant = null;
  for (const o of ouverturesDuPlan(devis.planChantier)) {
    if (y + hLigne + mm(7) > doc.page.height - mm(14)) { doc.addPage(); y = enTeteTableau(entete()); etageCourant = null; }
    const titre = `${o.etage} — ${o.appartement}`;
    if (titre !== etageCourant) {
      doc.rect(gauche, y, largeur, mm(6)).fill('#e0e7ff');
      doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(8).text(titre, gauche + mm(2), y + mm(1.8));
      y += mm(6); etageCourant = titre;
    }
    doc.lineWidth(0.5).strokeColor('#94a3b8');
    cols.forEach(c => doc.rect(c.x, y, c.w, hLigne).stroke());
    const m = o.mesures || {};
    const valeurs = [
      o.repere, o.emplacement, `${o.designation}${o.avecVolet ? '  + volet' : ''}`, `${o.Ldevis} × ${o.Hdevis}`,
      m.L ?? '', m.H ?? '', m.profondeur ?? (o.avecVolet ? '' : '—'), m.hauteurPoignee ?? '', m.sens ?? '', m.lv ?? (o.avecVolet ? '' : '—'), m.observation ?? '',
    ];
    doc.fillColor('#0f172a').font('Helvetica').fontSize(7.5);
    cols.forEach((c, i) => doc.text(String(valeurs[i]), c.x + mm(1), y + mm(1.5), {
      width: c.w - mm(2), height: hLigne - mm(2), align: i < 3 || i === 10 ? 'left' : 'center', ellipsis: true,
    }));
    if (o.avecVolet && !m.profondeur) doc.rect(cols[6].x + 1, y + 1, cols[6].w - 2, hLigne - 2).lineWidth(1.2).strokeColor('#f59e0b').stroke();
    y += hLigne;
  }

  y += mm(6);
  if (y + mm(18) > doc.page.height - mm(14)) { doc.addPage(); y = entete(); }
  doc.fillColor('#0f172a').font('Helvetica').fontSize(9)
    .text('Date du relevé : ____ / ____ / ________', gauche, y)
    .text('Nom et signature du métreur : ______________________________', gauche + mm(90), y)
    .text('Visa client : ______________________', gauche + mm(200), y);

  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fillColor(GRIS).fontSize(7).text(`${qs.companyName || ''} — Fiche métreur ${devis.id} — page ${i + 1} / ${pages.count}`,
      gauche, doc.page.height - mm(8), { width: largeur, align: 'center', lineBreak: false });
  }
  doc.end();
  return fin;
}
