// Devis PDF, présentation inspirée de celle de CalculDevis :
// en-tête société (logo, RC, IMP, MF), client, tableau des menuiseries, totaux, montant en lettres,
// validité, conditions particulières, signatures.

import PDFDocument from 'pdfkit';
import { getCatalogue } from '../catalogue.js';

const mm = v => v * 2.8346;
const BLEU = '#1e3a8a';
const GRIS = '#64748b';
const FOND = '#f1f5f9';
export const AVANCE_POURCENT = 50;

const prixFr = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ | /g, ' ');
const dateFr = iso => new Date(iso).toLocaleDateString('fr-FR');

// ───────────── Montant en lettres (même logique que CalculDevis) ─────────────
const U = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const D = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
function moinsDeCent(n) {
  if (n < 20) return U[n];
  const d = Math.floor(n / 10), u = n % 10;
  if (d === 7 || d === 9) return `${D[d]}${u === 1 && d === 7 ? ' et ' : '-'}${U[10 + u]}`;
  if (u === 0) return d === 8 ? 'quatre-vingts' : D[d];
  return `${D[d]}${u === 1 && d !== 8 ? ' et un' : '-' + U[u]}`;
}
function moinsDeMille(n) {
  const c = Math.floor(n / 100), r = n % 100;
  const cent = c === 0 ? '' : c === 1 ? 'cent' : `${U[c]} cent${r === 0 ? 's' : ''}`;
  return [cent, r ? moinsDeCent(r) : ''].filter(Boolean).join(' ');
}
function entierEnLettres(n) {
  if (n === 0) return 'zéro';
  const parts = [];
  const mds = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), k = Math.floor((n % 1e6) / 1000), r = n % 1000;
  if (mds) parts.push(`${moinsDeMille(mds)} milliard${mds > 1 ? 's' : ''}`);
  if (mil) parts.push(`${moinsDeMille(mil)} million${mil > 1 ? 's' : ''}`);
  if (k) parts.push(k === 1 ? 'mille' : `${moinsDeMille(k).replace(/s$/, '')} mille`);
  if (r) parts.push(moinsDeMille(r));
  return parts.join(' ');
}
export function montantEnLettres(montant) {
  const entier = Math.floor(montant);
  const cts = Math.round((montant - entier) * 100);
  let t = `${entierEnLettres(entier)} dinars`;
  if (cts) t += ` et ${entierEnLettres(cts)} centimes`;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ───────────── Description lisible d'une ligne ─────────────
function description(ligne, cat) {
  const c = ligne.configuration || {};
  const nom = (liste, id) => ((liste || []).find(x => x.id === id)?.name || '').trim();
  const lignes = [];
  if (c.compoundConfig?.parts?.length) {
    const parts = c.compoundConfig.parts.map(p => {
      const n = nom(cat.compositions, p.compositionId) || p.type;
      const dim = p.height || p.width;
      return dim ? `${n} (${dim} mm)` : n;
    });
    lignes.push(`Assemblé ${c.compoundConfig.orientation === 'vertical' ? 'superposé' : 'côte à côte'} : ${parts.join(' + ')}`);
  } else if (c.compositionId) {
    lignes.push(nom(cat.compositions, c.compositionId));
  }
  const couleur = nom(cat.colors, c.colorId);
  const vitrage = nom(cat.glass, c.glassId);
  lignes.push([couleur && `Couleur : ${couleur}`, vitrage && `Vitrage : ${vitrage}`].filter(Boolean).join(' · '));
  const options = (c.selectedOptions || []).map(id => nom(cat.options, id)).filter(Boolean);
  if (options.length) lignes.push(`Options : ${options.join(', ')}`);
  if (c.hasShutter && c.shutterConfig) {
    const sc = cat.shutterComponents || {}, s = c.shutterConfig;
    const kit = (sc.kits || []).find(k => k.id === s.kitId);
    lignes.push(`Volet roulant ${kit?.type === 'MOTEUR' ? 'motorisé' : 'à sangle'}${s.isDoubleShutter ? ' double' : ''} : ${nom(sc.caissons, s.caissonId)}, ${nom(sc.lames, s.lameId)}`);
  }
  return lignes.filter(Boolean);
}

/** Génère le PDF d'un devis et renvoie un Buffer. */
export async function genererDevisPdf(devis, client) {
  const cat = await getCatalogue();
  const qs = cat.quoteSettings || {};
  const doc = new PDFDocument({ size: 'A4', margin: mm(15), bufferPages: true, info: { Title: `Devis ${devis.id}`, Author: qs.companyName } });
  const morceaux = [];
  doc.on('data', b => morceaux.push(b));
  const fin = new Promise(r => doc.on('end', () => r(Buffer.concat(morceaux))));

  const pw = doc.page.width, gauche = mm(15), droite = pw - mm(15), largeur = droite - gauche;

  // ── En-tête société ──
  if (qs.logoBase64?.startsWith('data:image')) {
    try { doc.image(Buffer.from(qs.logoBase64.split(',')[1], 'base64'), gauche, mm(12), { fit: [mm(45), mm(22)] }); } catch { /* logo illisible : ignoré */ }
  }
  const xs = gauche + mm(52);
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(12).text(qs.companyName || '', xs, mm(12));
  doc.fillColor('#334155').font('Helvetica').fontSize(8)
    .text(qs.companyAddress || '', xs, doc.y + 2, { width: droite - xs })
    .text([qs.companyPhone, qs.companyEmail].filter(Boolean).join(' · '), { width: droite - xs })
    .fillColor(GRIS)
    .text(`RC : ${qs.companyRC || '-'} · IMP : ${qs.companyIMP || '-'} · MF : ${qs.companyMF || '-'}`, { width: droite - xs });
  if (qs.companyBank) doc.text(`Banque : ${qs.companyBank}`, { width: droite - xs });

  // ── Titre + client ──
  let y = mm(42);
  doc.roundedRect(gauche, y, mm(85), mm(26), 4).fill(FOND);
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(16).text('DEVIS', gauche + mm(4), y + mm(3));
  doc.fillColor('#0f172a').fontSize(10).text(`N° ${devis.id}`, gauche + mm(4), y + mm(11));
  doc.font('Helvetica').fontSize(8).fillColor(GRIS)
    .text(`Date : ${dateFr(devis.creeLe)}`, gauche + mm(4), y + mm(17))
    .text(devis.remplaceId ? `Remplace le devis ${devis.remplaceId}` : '', gauche + mm(4), y + mm(21));

  const xc = gauche + mm(95);
  doc.roundedRect(xc, y, droite - xc, mm(26), 4).lineWidth(0.8).strokeColor('#cbd5e1').stroke();
  doc.fillColor(GRIS).fontSize(7).text('CLIENT', xc + mm(4), y + mm(3));
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(client?.nom || '', xc + mm(4), y + mm(7), { width: droite - xc - mm(8) });
  doc.font('Helvetica').fontSize(8).fillColor('#334155');
  [client?.adresse, client?.telephone, client?.email, client?.rc && `RC : ${client.rc}`, client?.nif && `NIF : ${client.nif}`]
    .filter(Boolean).forEach(t => doc.text(t, { width: droite - xc - mm(8) }));

  // ── Tableau ──
  y = mm(76);
  const cols = [
    { titre: 'N°', x: gauche, w: mm(8), align: 'center' },
    { titre: 'Désignation', x: gauche + mm(8), w: mm(98), align: 'left' },
    { titre: 'Qté', x: gauche + mm(106), w: mm(12), align: 'center' },
    { titre: 'P.U. HT', x: gauche + mm(118), w: mm(30), align: 'right' },
    { titre: 'Total HT', x: gauche + mm(148), w: largeur - mm(148), align: 'right' },
  ];
  const enTete = () => {
    doc.rect(gauche, y, largeur, mm(7)).fill(BLEU);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(8);
    cols.forEach(c => doc.text(c.titre, c.x + mm(1.5), y + mm(2.2), { width: c.w - mm(3), align: c.align }));
    y += mm(7);
  };
  enTete();

  devis.lignes.forEach((l, i) => {
    const desc = description(l, cat);
    doc.font('Helvetica').fontSize(7.5);
    const hDesc = desc.reduce((h, t) => h + doc.heightOfString(t, { width: cols[1].w - mm(3) }), 0);
    const h = Math.max(mm(10), mm(6) + hDesc + mm(2));
    if (y + h > doc.page.height - mm(60)) { doc.addPage(); y = mm(15); enTete(); }
    if (i % 2) doc.rect(gauche, y, largeur, h).fill('#f8fafc');
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8.5)
      .text(String(i + 1), cols[0].x + mm(1.5), y + mm(2), { width: cols[0].w - mm(3), align: 'center' })
      .text(`${l.designation} — ${l.L} × ${l.H} mm`, cols[1].x + mm(1.5), y + mm(2), { width: cols[1].w - mm(3) });
    doc.font('Helvetica').fontSize(7.5).fillColor('#475569');
    let yd = y + mm(6);
    desc.forEach(t => { doc.text(t, cols[1].x + mm(1.5), yd, { width: cols[1].w - mm(3) }); yd = doc.y; });
    doc.fillColor('#0f172a').fontSize(8.5)
      .text(String(l.quantite), cols[2].x, y + mm(2), { width: cols[2].w, align: 'center' })
      .text(`${prixFr(l.prixUnitaireHT)} DA`, cols[3].x, y + mm(2), { width: cols[3].w - mm(1.5), align: 'right' })
      .font('Helvetica-Bold').text(`${prixFr(l.totalHT)} DA`, cols[4].x, y + mm(2), { width: cols[4].w - mm(1.5), align: 'right' });
    y += h;
    doc.moveTo(gauche, y).lineTo(droite, y).lineWidth(0.4).strokeColor('#e2e8f0').stroke();
  });

  // ── Totaux ──
  if (y + mm(75) > doc.page.height - mm(15)) { doc.addPage(); y = mm(15); }
  y += mm(4);
  const tva = devis.totalTTC - devis.totalHT;
  const xt = gauche + mm(100), wt = droite - xt;
  doc.roundedRect(xt, y, wt, mm(22), 4).fill(FOND);
  doc.fillColor('#334155').font('Helvetica').fontSize(9)
    .text('MONTANT TOTAL HT', xt + mm(4), y + mm(3)).text(`${prixFr(devis.totalHT)} DA`, xt, y + mm(3), { width: wt - mm(4), align: 'right' })
    .text(`TVA ${devis.tvaPourcent} %`, xt + mm(4), y + mm(9)).text(`${prixFr(tva)} DA`, xt, y + mm(9), { width: wt - mm(4), align: 'right' });
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(10)
    .text('NET À PAYER TTC', xt + mm(4), y + mm(15.5)).text(`${prixFr(devis.totalTTC)} DA`, xt, y + mm(15.5), { width: wt - mm(4), align: 'right' });

  doc.fillColor(GRIS).font('Helvetica').fontSize(8).text('Signature commercial', gauche, y + mm(3), { width: mm(45), align: 'center' })
    .text('Signature client', gauche + mm(48), y + mm(3), { width: mm(45), align: 'center' });
  y += mm(27);

  doc.fillColor('#0f172a').font('Helvetica-Oblique').fontSize(8.5)
    .text(`Arrêté le présent devis à la somme de : ${montantEnLettres(devis.totalTTC)}.`, gauche, y, { width: largeur });
  doc.font('Helvetica').text("Validité de l'offre : 1 semaine (7 jours)", gauche, doc.y + mm(2));

  // ── Conditions particulières ──
  y = doc.y + mm(5);
  const avance = prixFr(devis.totalTTC * AVANCE_POURCENT / 100);
  const conditions = [
    ['1. Tolérance dimensionnelle & cotes chantier :', "Le présent chiffrage est établi sur la base des cotes estimatives transmises. En cas d'écart dimensionnel supérieur à 10 cm (en largeur ou en hauteur) constaté lors du relevé définitif sur chantier, une révision du devis (ajustement tarifaire) sera automatiquement appliquée."],
    ['2. Modalités de règlement & acompte :', `Le versement d'un acompte de ${AVANCE_POURCENT} % du montant total TTC (soit ${avance} DA) est exigible dès la signature du devis pour validation définitive de la commande et lancement de la fabrication. Le solde sera réglé selon les modalités convenues.`],
    ['3. Hauteurs de poignée & allège :', "Hauteur de poignée conventionnelle (applicable à tout produit) : 1,50 m pour les portes et axée (au centre de l'ouvrant) pour les fenêtres. Pour tout produit comportant une partie fixe en bas, la hauteur du fixe plus allège est fixée à 1,10 m du sol fini."],
  ];
  doc.fontSize(7);
  const hCond = mm(8) + conditions.reduce((h, [t, c]) => h + doc.heightOfString(c, { width: largeur - mm(8) }) + mm(5), 0);
  if (y + hCond > doc.page.height - mm(15)) { doc.addPage(); y = mm(15); }
  doc.roundedRect(gauche, y, largeur, hCond, 4).lineWidth(0.6).fillAndStroke('#f8fafc', '#cbd5e1');
  doc.fillColor(BLEU).font('Helvetica-Bold').fontSize(8).text('CONDITIONS PARTICULIÈRES', gauche + mm(4), y + mm(3));
  let yc = y + mm(8);
  conditions.forEach(([titre, texte]) => {
    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(7).text(titre, gauche + mm(4), yc);
    doc.font('Helvetica').fillColor('#334155').text(texte, gauche + mm(4), doc.y + 1, { width: largeur - mm(8) });
    yc = doc.y + mm(2);
  });

  // ── Pied de page ──
  const pages = doc.bufferedPageRange();
  for (let i = 0; i < pages.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // écrire en bas de page sans créer de nouvelle page
    const yp = doc.page.height - mm(12);
    doc.fillColor(GRIS).font('Helvetica').fontSize(7)
      .text(qs.footerText || '', gauche, yp, { width: largeur, align: 'center', lineBreak: false })
      .text(`Page ${i + 1} / ${pages.count}`, gauche, yp + mm(4), { width: largeur, align: 'center', lineBreak: false });
  }

  doc.end();
  return fin;
}
