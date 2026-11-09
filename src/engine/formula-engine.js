import { create, all } from 'mathjs';

const math = create(all);

/**
 * Formula Engine for Joinery Configurator
 */
export class FormulaEngine {
  constructor(database) {
    this.db = database || {};
  }

  evaluate(formula, scope, errorContext = '', errorList = null) {
    if (!formula || typeof formula !== 'string' || formula.trim() === '') return 0;
    try {
      // 1. Convert French decimals "1,5" -> "1.5" but preserve function commas "max(1, 2)"
      let cleanFormula = formula.replace(/(\d),(\d)/g, '$1.$2');
      
      // 2. Convert JS logical operators to mathjs
      cleanFormula = cleanFormula.replace(/&&/g, ' and ').replace(/\|\|/g, ' or ');

      // 3. Inject custom functions
      const evalScope = { 
        ...scope, 
        'if': (cond, a, b) => cond ? a : b 
      };

      const result = math.evaluate(cleanFormula, evalScope);
      if (typeof result === 'number' && isNaN(result)) {
        throw new Error("NaN");
      }
      return result;
    } catch (err) {
      console.warn(`Formula Error [${errorContext}]: "${formula}"`, err);
      if (errorList) errorList.push({ context: errorContext, formula, error: err.message });
      return 0;
    }
  }

  getUsageCategory(label) {
    const l = (label || '').toLowerCase();
    if (l.includes('dormant') || l.includes('cadre') || l.includes('seuil') || l.includes('precadre')) return 'DORMANT (CADRE)';
    if (l.includes('fixe') || l.includes('fix')) return 'FIXE';
    if (l.includes('ouvrant') || l.includes('battement') || l.includes('inverseur')) return 'FENETRE (OUVRANT)';
    if (l.includes('parclose')) {
      // If parclose is mentioned with fix/fixe, it goes to FIXE, otherwise OUVRANT
      return (l.includes('fixe') || l.includes('fix')) ? 'FIXE' : 'FENETRE (OUVRANT)';
    }
    if (l.includes('lame') || l.includes('coulisse') || l.includes('caisson') || l.includes('axe') || l.includes('glissiere')) return 'VOLET ROULANT';
    if (l.includes('traverse') || l.includes('montant')) return 'FIXE'; 
    return 'ACCESSOIRES / FINITION';
  }

  /**
   * Resolve a formula by replacing L and H with their values
   */
  resolveFormula(formula, scope) {
    if (!formula || typeof formula !== 'string') return '';
    let resolved = formula;
    
    // Replace standard variables
    const vars = {
      'nb_moteurs': scope.nb_moteurs,
      'L': scope.L !== undefined ? Math.round(scope.L) : undefined,
      'H': scope.H !== undefined ? Math.round(scope.H) : undefined,
      'HC': scope.HC !== undefined ? Math.round(scope.HC) : undefined,
      'HT': scope.HT !== undefined ? Math.round(scope.HT) : undefined,
      'EPt': scope.EPt !== undefined ? Math.round(scope.EPt) : undefined,
      'Epd': scope.Epd !== undefined ? Math.round(scope.Epd) : undefined
    };

    Object.entries(vars).forEach(([key, val]) => {
      if (val !== undefined) {
        const regex = new RegExp('\\b' + key + '\\b', 'g');
        resolved = resolved.replace(regex, val);
      }
    });

    return resolved;
  }

  calculateComponentBOM(config, L, H, compositionId, glassId, optionalSides, totalH = null, originalL = null, originalH = null, EPt = 0, errors = [], glassLAdj = 0, glassHAdj = 0) {
    const opt = optionalSides || { top: true, bottom: true, left: true, right: true };
    let composition = (this.db.compositions || []).find(c => c.id === compositionId);
    if (!composition) {
      composition = (this.db.compositions || []).find(c => c.name === compositionId);
    }
    if (!composition) return { profiles: [], accessories: [], glass: null, gasket: null };

    let HC = 0;
    if (config.hasShutter) {
      if (config.shutterOverrides?.customHC) {
        HC = config.shutterOverrides.customHC;
      } else if (config.shutterConfig?.caissonId && this.db.shutterComponents) {
        const cRef = (this.db.shutterComponents?.caissons || []).find(c => c.id === config.shutterConfig.caissonId);
        HC = parseFloat(cRef?.height) || 0;
      }
    }

    const profiles = [];
    const accessories = [];
    // --- Epd DETECTION (Dormant Thickness) ---
    let Epd = 40; 
    const isDormantFn = (l, n) => /dormant|cadre|chassis|batit|dorme/i.test(((l || '') + ' ' + (n || '')).toLowerCase());
    const dormantId = composition.elements.find(el => {
       if (el.type !== 'profile') return false;
       const pDef = (this.db.profiles || []).find(x => x.id === el.id);
       return pDef && isDormantFn(el.label, pDef.name);
    })?.id;
    if (dormantId) {
       const pDef = (this.db.profiles || []).find(x => x.id === dormantId);
       Epd = pDef.thickness || (parseInt((pDef.name || '').match(/\d+/)?.[0]) || 40);
     }

    // 1. Calculate glass dimensions and quantity first to have them in scope
    const tempScope = { L, H, HC, totalH: totalH || H, originalL: originalL || L, totalOriginalH: originalH || H, EPt, Epd };
    const tempGlassScope = { ...tempScope, L: L + (glassLAdj || 0), H: H + (glassHAdj || 0) };
    const glassL = this.evaluate(composition.glassFormulaL || 'L', tempGlassScope, 'Largeur Vitre', errors);
    const glassH = this.evaluate(composition.glassFormulaH || 'H', tempGlassScope, 'Hauteur Vitre', errors);
    const glassQtyRaw = this.evaluate(composition.glassFormulaQty || '1', tempGlassScope, 'Quantité Vitre', errors);
    const glassQty = isNaN(glassQtyRaw) ? 0 : glassQtyRaw;

    // Calculate glass2 dimensions if formulas are specified
    const hasGlass2 = !!(composition.glass2FormulaL || composition.glass2FormulaH || composition.glass2FormulaQty);
    let glass2L = 0;
    let glass2H = 0;
    let glass2Qty = 0;
    if (hasGlass2) {
      glass2L = this.evaluate(composition.glass2FormulaL || 'L', tempGlassScope, 'Largeur Vitre 2', errors);
      glass2H = this.evaluate(composition.glass2FormulaH || 'H', tempGlassScope, 'Hauteur Vitre 2', errors);
      const glass2QtyRaw = this.evaluate(composition.glass2FormulaQty || '1', tempGlassScope, 'Quantité Vitre 2', errors);
      glass2Qty = isNaN(glass2QtyRaw) ? 0 : glass2QtyRaw;
    }

    // 2. Build the final enriched scope for all subsequent calculations
    const windowDir = (config.openingDirection || 'gauche').toLowerCase();
    const scope = { 
      ...tempScope,
      glassQty,
      qty: glassQty, // alias
      glass2Qty,
      openingDirection: windowDir,
      isGauche: windowDir.includes('gauch'),
      isDroit: windowDir.includes('droit'),
      isDroite: windowDir.includes('droit') // Alias for French
    };
    
    const originalScope = { ...scope, L: originalL || L, H: originalH || H };

    // Enriched scope specifically for glass, gasket, and parcloses
    const glassScope = {
      ...scope,
      L: L + (glassLAdj || 0),
      H: H + (glassHAdj || 0)
    };

    const isCompoundWithTraverse = config.compoundType === 'compound';
    
    // Detection via layout/config
    let hasHorizontalTraverse = (config.customLayout?.rows?.length > 1) || (config.rows > 1) || (isCompoundWithTraverse && config.compoundConfig?.orientation === 'vertical');
    let hasVerticalTraverse = (config.customLayout?.cols?.length > 1) || (config.cols > 1) || (isCompoundWithTraverse && config.compoundConfig?.orientation === 'horizontal');

    // Detection via composition elements (manual traverses)
    composition.elements.forEach(el => {
      const p = (this.db.profiles || []).find(x => x.id === el.id || x.name === el.id);
      const a = (this.db.accessories || []).find(x => x.id === el.id || x.name === el.id);
      const s = ((el.label || '') + ' ' + (p?.name || a?.name || '')).toLowerCase();
      
      if (s.includes('traverse')) {
        // A horizontal traverse piece implies a [T] on vertical frames
        if (s.includes('horiz') || s.includes(' h') || s.includes(' l') || s.includes('largeur')) {
          hasHorizontalTraverse = true;
        }
        // A vertical traverse piece implies a [T] on horizontal frames
        if (s.includes('vert') || s.includes(' v') || s.includes('hauteur')) {
          hasVerticalTraverse = true;
        }
      }
    });

    const expandedElements = [];

    // --- FILTER GLOBAL FRAME ELEMENTS IF IN COMPOUND MODE ---
    let elementsToProcess = composition.elements || [];
    if (config._compoundMode) {
      elementsToProcess = elementsToProcess.filter(el => {
        const itemName = this.db.profiles?.find(px => px.id === el.id)?.name || 
                         this.db.accessories?.find(ax => ax.id === el.id)?.name || '';
        // Cover joints are ALWAYS global in compound mode.
        // Dormants are only filtered if explicitly requested by the compound engine (for Traversing mode).
        const isCj = /couvres?[- ]?joints?|cj[vh]?/i.test(((el.label || '') + ' ' + itemName).toLowerCase());
        const isDormant = /dormant/i.test(((el.label || '') + ' ' + itemName).toLowerCase());
        
        if (isCj) return false;
        if (isDormant && config._filterDormant) return false;
        return true;
      });
    }

    elementsToProcess.forEach(el => {
      let label = el.label || '';
      let itemName = '';
      
      if (el.type === 'profile') {
        let p = (this.db.profiles || []).find(x => x.id === el.id);
        if (!p) {
          p = (this.db.profiles || []).find(x => x.name === el.id); // Fallback if ID is actually a name
        }
        if (p) itemName = p.name || '';
      } else if (el.type === 'accessory') {
        const a = (this.db.accessories || []).find(x => x.id === el.id);
        if (a) itemName = a.name || '';
      }

      const searchStr = (label + ' ' + itemName).toLowerCase();
      const isCouvreJoint = /couvres?[- ]?joints?|cj[vh]?/i.test(searchStr);
      const isDormant = /dormant|cadre|chassis|batit|dorme/i.test(searchStr);

      if (!isCouvreJoint && !isDormant) {
        expandedElements.push({ ...el, isFrame: false, isCouvreJoint: false });
        return;
      }
      const isHorizontal = /haut|bas|couvres?[- ]?joints?\s?h|cj[h]/i.test(searchStr) || (/\bL\b| L$/i.test(searchStr));
      const isVertical = /gauche|droite|couvres?[- ]?joints?\s?v|cj[v]/i.test(searchStr) || (/\bH\b| H$/i.test(searchStr));
      
      let finalHorizontal = isHorizontal;
      let finalVertical = isVertical;

      // Special Refinement: If an explicit side is mentioned, prioritize it over generic L/H markers
      // This prevents "Cadre H (Gauche)" from matching both because of the "H"
      if (/haut|bas|gauche|droite/i.test(searchStr)) {
        finalHorizontal = /haut|bas/i.test(searchStr);
        finalVertical = /gauche|droite/i.test(searchStr);
      }
      if (isCouvreJoint) {
        if (/cj[h]/i.test(searchStr)) { finalHorizontal = true; finalVertical = false; }
        else if (/cj[v]/i.test(searchStr)) { finalHorizontal = false; finalVertical = true; }
      }
      let baseLabel = label || itemName;
      
      // Marquage T croisé pour l'atelier
      if (isDormant) {
        if (isHorizontal && hasVerticalTraverse) baseLabel += ' [T]';
        if (isVertical && hasHorizontalTraverse) baseLabel += ' [T]';
      }

      const isActuallyCouvreJoint = isCouvreJoint;

      // SUB-PARTS never get expanded frame elements (they only get their own internal opening profiles)
      // This ensures the main frame doesn't double-count profiles inside sub-parts for multi-chassis
      if (opt.isSubPart && (isDormant || isCouvreJoint)) {
        return;
      }

      // ACCESSORIES never get expanded/split
      if (el.type === 'accessory') {
        expandedElements.push({ ...el, isFrame: isDormant || isCouvreJoint, isCouvreJoint: isActuallyCouvreJoint });
        return;
      }

      // Smart Formula Swapping Helper
      const swapFormula = (f, from, to) => {
        if (!f || typeof f !== 'string') return f;
        const regex = new RegExp(`\\b${from}\\b`, 'g');
        return f.replace(regex, to);
      };

      // PROFILES expansion logic
      if (finalHorizontal) {
        const hasHaut = searchStr.includes('haut');
        const hasBas = searchStr.includes('bas');
        const isGenericH = !hasHaut && !hasBas;
        
        // Ensure horizontal profiles use 'L' if they were accidentally defined with 'H'
        const hFormula = swapFormula(el.formula || 'L', 'H', 'L');
        
        if (isActuallyCouvreJoint) {
          if (isGenericH) {
            if (opt.top) expandedElements.push({ ...el, formula: hFormula, label: baseLabel + " (Haut)", qty: el.qty === 2 ? 1 : el.qty, isCouvreJoint: true, isFrame: true });
            if (opt.bottom) expandedElements.push({ ...el, formula: hFormula, label: baseLabel + " (Bas)", qty: el.qty === 2 ? 1 : el.qty, isCouvreJoint: true, isFrame: true });
          } else {
            const allowTop = opt.top;
            const allowBottom = opt.bottom;
            if (hasHaut && allowTop) expandedElements.push({ ...el, formula: hFormula, label: baseLabel, isCouvreJoint: true, isFrame: true });
            if (hasBas && allowBottom) expandedElements.push({ ...el, formula: hFormula, label: baseLabel, isCouvreJoint: true, isFrame: true });
          }
        } else {
          if (isGenericH) {
            expandedElements.push({ ...el, formula: hFormula, label: baseLabel, qty: el.qty, isCouvreJoint: false, isFrame: true });
          } else {
            if (hasHaut) expandedElements.push({ ...el, formula: hFormula, label: baseLabel, isCouvreJoint: false, isFrame: true });
            if (hasBas) expandedElements.push({ ...el, formula: hFormula, label: baseLabel, isCouvreJoint: false, isFrame: true });
          }
        }
      } else if (finalVertical) {
        const hasGauche = searchStr.includes('gauche');
        const hasDroite = searchStr.includes('droite');
        const isGenericV = !hasGauche && !hasDroite;

        // Ensure vertical profiles use 'H' if they were accidentally defined with 'L'
        const vFormula = swapFormula(el.formula || 'H', 'L', 'H');

        if (isActuallyCouvreJoint) {
          if (isGenericV) {
            if (opt.left) expandedElements.push({ ...el, formula: vFormula, label: baseLabel + " (Gauche)", qty: el.qty === 2 ? 1 : el.qty, isCouvreJoint: true, isFrame: true });
            if (opt.right) expandedElements.push({ ...el, formula: vFormula, label: baseLabel + " (Droite)", qty: el.qty === 2 ? 1 : el.qty, isCouvreJoint: true, isFrame: true });
          } else {
            const allowLeft = opt.left;
            const allowRight = opt.right;
            if (hasGauche && allowLeft) expandedElements.push({ ...el, formula: vFormula, label: baseLabel, isCouvreJoint: true, isFrame: true });
            if (hasDroite && allowRight) expandedElements.push({ ...el, formula: vFormula, label: baseLabel, isCouvreJoint: true, isFrame: true });
          }
        } else {
          if (isGenericV) {
            expandedElements.push({ ...el, formula: vFormula, label: baseLabel, qty: el.qty, isCouvreJoint: false, isFrame: true });
          } else {
            if (hasGauche) expandedElements.push({ ...el, formula: vFormula, label: baseLabel, isCouvreJoint: false, isFrame: true });
            if (hasDroite) expandedElements.push({ ...el, formula: vFormula, label: baseLabel, isCouvreJoint: false, isFrame: true });
          }
        }
      } else {
        // Generic 4-sided
        expandedElements.push({ ...el, label: baseLabel, qty: el.qty, isCouvreJoint: isActuallyCouvreJoint, isFrame: true });
      }
    });

    expandedElements.forEach(el => {
      let elQty = el.qty;
      const isAccessory = el.type === 'accessory';
      const formulaRaw = el.formula != null ? String(el.formula) : '';
      const formulaStr = (formulaRaw.trim() !== '') ? formulaRaw : (isAccessory ? '1' : '');
      
      // Use totalH and initialL for Couvre Joint if available.
      let currentScope = (el.isCouvreJoint) ? { ...scope, H: totalH || scope.totalOriginalH || H, L: originalL || scope.originalL || L } : scope;
      if (el.isCouvreJoint) {
        currentScope = { ...currentScope, ...originalScope, H: totalH || scope.totalOriginalH || H, L: originalL || scope.originalL || L };
      }
      
      const value = this.evaluate(formulaStr, currentScope, el.label || itemName, errors);
      const isError = isNaN(value);
      const safeValue = isError ? 0 : value;
      const qty = safeValue * elQty;

      // Skip items with quantity 0 (except if it's a fixed length profile we might want to see? No, usually skip)
      if (qty <= 0 && !isError) return;

      if (el.type === 'profile') {
        let pRef = (this.db.profiles || []).find(p => p.id === el.id);
        if (!pRef) {
          pRef = (this.db.profiles || []).find(p => p.name === el.id);
        }
        if (pRef) {
          let unitPrice = 0;
          let cost = 0;
          
          if (pRef.pricePerBar) {
            unitPrice = pRef.pricePerBar;
            cost = (qty / (pRef.barLength || 6000)) * unitPrice;
          } else if (pRef.pricePerKg) {
            unitPrice = pRef.pricePerKg;
            cost = (qty / 1000) * (pRef.weightPerM || 1) * unitPrice;
          }

          profiles.push({
            ...pRef,
            label: el.label,
            qty: elQty,
            formula: el.formula,
            resolvedFormula: this.resolveFormula(formulaStr, currentScope),
            calculation: `${this.resolveFormula(formulaStr, currentScope)}`,
            isFrame: el.isFrame,
            isCouvreJoint: el.isCouvreJoint,
            length: safeValue,
            usage: this.getUsageCategory((el.label || '') + ' ' + (pRef.name || '')),
            error: isError ? "Formule Invalide" : null,
            unitPrice: unitPrice,
            compositionId: composition.id,
            compositionName: composition.name,
            totalMeasure: safeValue * elQty,
            cost: cost
          });
        }
      } else if (el.type === 'accessory') {
        const aRef = (this.db.accessories || []).find(a => a.id === el.id);
        if (aRef) {
          // Compatibility Check
          if (aRef.compatibilityFormula && aRef.compatibilityFormula.trim() !== '') {
            try {
              const ok = this.evaluate(aRef.compatibilityFormula, currentScope);
              if (!ok) return; // Skip incompatible accessory
            } catch (e) {
              console.warn(`[FormulaEngine] Compatibility error for accessory ${aRef.id}:`, e.message);
            }
          }

          // NEW: Filter by side if specified in the accessory database
          const windowDir = (config.openingDirection || 'gauche').toLowerCase();
          if (aRef.side && aRef.side !== 'both' && aRef.side !== windowDir) {
            return; // Skip this accessory as it's for the other side
          }

          const unitUpper = (aRef.unit || '').toUpperCase();
          const isLinear = ['M', 'ML', 'JOINT'].includes(unitUpper);
          const finalQty = isLinear ? (qty / 1000) : qty;

          accessories.push({
            ...aRef,
            label: el.label,
            qty: finalQty,
            isFrame: el.isFrame,
            isCouvreJoint: el.isCouvreJoint,
            multiplier: el.qty || 1,
            formula: el.formula || '1',
            resolvedFormula: this.resolveFormula(el.formula || '1', currentScope),
            error: isError ? "Formule Invalide" : null,
            unitPrice: aRef.price || 0,
            totalMeasure: qty, 
            cost: (finalQty || 0) * (aRef.price || 0)
          });
        }
      }
    });

    const glass = (this.db.glass || []).find(g => g.id === glassId);
    // Normalize rangeId: strip hyphens and spaces for flexible matching
    const normalizeRangeId = (id) => (id || '').replace(/[-\s]+/g, '').toLowerCase();
    const compNormRangeId = normalizeRangeId(composition.rangeId);

    let gasket = null;
    
    if (glass) {
      const allGasketEntries = this.db.gasketCompatibility || [];
      
      let compatibility = allGasketEntries.find(
        c => normalizeRangeId(c.rangeId) === compNormRangeId &&
             parseFloat(c.glassThickness) === parseFloat(glass.thickness)
      );
      
      // Fallback: only if no rangeId is explicitly defined (headless or manual composition)
      if (!compatibility && !composition.rangeId) {
        compatibility = allGasketEntries.find(
          c => parseFloat(c.glassThickness) === parseFloat(glass.thickness)
        );
      }
      
      if (compatibility) {
        const gRef = (this.db.accessories || []).find(a => a.id === compatibility.gasketId);
        if (gRef) {
          const formula = compatibility.formula || '(L+H)*2';
          const lenMm = this.evaluate(formula, glassScope, 'Joint Vitrage', errors);
          const isError = isNaN(lenMm);
          const safeLenMm = isError ? 0 : lenMm;
          const qtyMl = safeLenMm / 1000;
          
          gasket = {
            ...gRef,
            isGlassGasket: true,
            label: 'Joint de Vitrage',
            qty: qtyMl,
            multiplier: 1,
            unit: 'Joint',
            formula: formula,
            resolvedFormula: this.resolveFormula(formula, scope),
            error: isError ? "Formule Invalide" : null,
            unitPrice: gRef.price || 0,
            totalMeasure: safeLenMm,
            cost: qtyMl * (gRef.price || 0)
          };
        }
      }
    }

    const glassArea = (((isNaN(glassL)?0:glassL) * (isNaN(glassH)?0:glassH)) / 1000000) * (isNaN(glassQty)?0:glassQty);
    const glassWeight = glass ? (glassArea * glass.weightPerM2) : 0;
    const glassCost = glass ? (glassArea * glass.pricePerM2) : 0;

    let glass2 = null;
    let gasket2 = null;
    if (glass && hasGlass2 && glass2Qty > 0) {
      const glass2Area = (((isNaN(glass2L)?0:glass2L) * (isNaN(glass2H)?0:glass2H)) / 1000000) * (isNaN(glass2Qty)?0:glass2Qty);
      const glass2Weight = glass2Area * glass.weightPerM2;
      const glass2Cost = glass2Area * glass.pricePerM2;
      glass2 = {
        ...glass,
        label: 'Vitrage 2',
        width: isNaN(glass2L)?0:glass2L,
        height: isNaN(glass2H)?0:glass2H,
        qty: isNaN(glass2Qty)?0:glass2Qty,
        area: glass2Area,
        weight: glass2Weight,
        cost: glass2Cost,
        calculation: `L: ${this.resolveFormula(composition.glass2FormulaL || 'L', glassScope)} = ${Math.round(glass2L)} | H: ${this.resolveFormula(composition.glass2FormulaH || 'H', glassScope)} = ${Math.round(glass2H)}`,
        error: (isNaN(glass2L) || isNaN(glass2H) || isNaN(glass2Qty)) ? "Formule Invalide" : null
      };

      // Gasket for glass2
      const allGasketEntries = this.db.gasketCompatibility || [];
      let compatibility = allGasketEntries.find(
        c => normalizeRangeId(c.rangeId) === compNormRangeId &&
             parseFloat(c.glassThickness) === parseFloat(glass.thickness)
      );
      if (!compatibility && !composition.rangeId) {
        compatibility = allGasketEntries.find(
          c => parseFloat(c.glassThickness) === parseFloat(glass.thickness)
        );
      }
      if (compatibility) {
        const gRef = (this.db.accessories || []).find(a => a.id === compatibility.gasketId);
        if (gRef) {
          const formula = compatibility.formula || '(L+H)*2';
          const scope2 = { ...glassScope, L: glass2L, H: glass2H };
          const lenMm = this.evaluate(formula, scope2, 'Joint Vitrage 2', errors);
          const isError = isNaN(lenMm);
          const safeLenMm = isError ? 0 : lenMm;
          const qtyMl = (safeLenMm / 1000) * glass2Qty;
          
          gasket2 = {
            ...gRef,
            isGlassGasket: true,
            label: 'Joint de Vitrage 2',
            qty: qtyMl,
            multiplier: 1,
            unit: 'Joint',
            formula: formula,
            resolvedFormula: this.resolveFormula(formula, scope2),
            error: isError ? "Formule Invalide" : null,
            unitPrice: gRef.price || 0,
            totalMeasure: safeLenMm * glass2Qty,
            cost: qtyMl * (gRef.price || 0)
          };
        }
      }
    }

    // Add Parcloses based on glass compatibility ONLY if not already present in profiles
    if (glass) {
      const hasManualParcloseH = profiles.some(p => p.label?.toLowerCase() === 'parcloseh');
      const hasManualParcloseV = profiles.some(p => p.label?.toLowerCase() === 'parclosev');
      
      let glassProfiles = (this.db.glassProfileCompatibility || []).filter(
        c => normalizeRangeId(c.rangeId) === compNormRangeId &&
             parseFloat(c.glassThickness) === parseFloat(glass.thickness)
      );

      // Fallback 1: Fuzzy match (prefix/suffix)
      if (glassProfiles.length === 0) {
        glassProfiles = (this.db.glassProfileCompatibility || []).filter(
          c => {
            const norm = normalizeRangeId(c.rangeId);
            return norm && compNormRangeId && (compNormRangeId.startsWith(norm) || norm.startsWith(compNormRangeId)) &&
                   parseFloat(c.glassThickness) === parseFloat(glass.thickness);
          }
        );
      }

      // Fallback 2: If no range match AND no rangeId is defined on the composition,
      // try matching by thickness ONLY (supports generic/manual compositions)
      if (glassProfiles.length === 0 && !composition.rangeId) {
        glassProfiles = (this.db.glassProfileCompatibility || []).filter(
          c => parseFloat(c.glassThickness) === parseFloat(glass.thickness)
        );
      }

      if (glassProfiles.length === 0) {
          console.warn(`[Parclose] No compatibility found for range=${composition.rangeId} thickness=${glass.thickness}`);
      } else {
          glassProfiles = [glassProfiles[0]]; // Only take the first matching configuration to prevent duplicate parclose generation
      }

      glassProfiles.forEach(gp => {
        console.log(`[Parclose] Match found: H=${gp.profileHId} V=${gp.profileVId}`);
        // Handle Parclose Horizontal for Glass 1
        const pHRef = (this.db.profiles || []).find(p => p.id === gp.profileHId);
        if (pHRef && !hasManualParcloseH) {
          const unitPrice = (pHRef.pricePerBar || pHRef.pricePerKg || 0);
          const formulaH = gp.formulaH || composition.glassFormulaL || 'L';
          const hValue = this.evaluate(formulaH, glassScope, 'ParcloseH', errors);
          const isErrorH = isNaN(hValue);
          const safeHValue = isErrorH ? 0 : hValue;
          const hQty = gp.qtyH || 2;
          
          profiles.push({
            ...pHRef,
            label: 'ParcloseH',
            isFrame: false,
            isCouvreJoint: false,
            qty: hQty,
            length: safeHValue,
            formula: formulaH,
            resolvedFormula: this.resolveFormula(formulaH, glassScope),
            error: isErrorH ? "Formule Invalide" : null,
            unitPrice: unitPrice,
            totalMeasure: safeHValue * hQty,
            cost: ((safeHValue * hQty) / (pHRef.barLength || 6000)) * unitPrice
          });
        }

        // Handle Parclose Horizontal for Glass 2
        if (pHRef && !hasManualParcloseH && glass2Qty > 0) {
          const unitPrice = (pHRef.pricePerBar || pHRef.pricePerKg || 0);
          const formulaH2 = gp.formulaH === composition.glassFormulaL ? composition.glass2FormulaL : (gp.formulaH || composition.glass2FormulaL || 'L');
          const scope2 = { ...glassScope, L: glass2L, H: glass2H };
          const hValue = this.evaluate(formulaH2, scope2, 'ParcloseH 2', errors);
          const isErrorH = isNaN(hValue);
          const safeHValue = isErrorH ? 0 : hValue;
          const hQty = gp.qtyH || 2;
          
          profiles.push({
            ...pHRef,
            label: 'ParcloseH 2',
            isFrame: false,
            isCouvreJoint: false,
            qty: hQty,
            length: safeHValue,
            formula: formulaH2,
            resolvedFormula: this.resolveFormula(formulaH2, scope2),
            error: isErrorH ? "Formule Invalide" : null,
            unitPrice: unitPrice,
            totalMeasure: safeHValue * hQty,
            cost: ((safeHValue * hQty) / (pHRef.barLength || 6000)) * unitPrice
          });
        }

        // Handle Parclose Vertical for Glass 1
        const pVRef = (this.db.profiles || []).find(p => p.id === gp.profileVId);
        if (pVRef && !hasManualParcloseV) {
          const unitPrice = (pVRef.pricePerBar || pVRef.pricePerKg || 0);
          const formulaV = gp.formulaV || composition.glassFormulaH || 'H';
          const vValue = this.evaluate(formulaV, glassScope, 'ParcloseV', errors);
          const isErrorV = isNaN(vValue);
          const safeVValue = isErrorV ? 0 : vValue;
          const vQty = gp.qtyV || 2;
          
          profiles.push({
            ...pVRef,
            label: 'ParcloseV',
            isFrame: false,
            isCouvreJoint: false,
            qty: vQty,
            length: safeVValue,
            formula: formulaV,
            resolvedFormula: this.resolveFormula(formulaV, glassScope),
            error: isErrorV ? "Formule Invalide" : null,
            unitPrice: unitPrice,
            totalMeasure: safeVValue * vQty,
            cost: pVRef.pricePerBar 
              ? ((safeVValue * vQty) / (pVRef.barLength || 6000)) * unitPrice
              : ((safeVValue * vQty) / 1000) * (pVRef.weightPerM || 1) * unitPrice
          });
        }

        // Handle Parclose Vertical for Glass 2
        if (pVRef && !hasManualParcloseV && glass2Qty > 0) {
          const unitPrice = (pVRef.pricePerBar || pVRef.pricePerKg || 0);
          const formulaV2 = gp.formulaV === composition.glassFormulaH ? composition.glass2FormulaH : (gp.formulaV || composition.glass2FormulaH || 'H');
          const scope2 = { ...glassScope, L: glass2L, H: glass2H };
          const vValue = this.evaluate(formulaV2, scope2, 'ParcloseV 2', errors);
          const isErrorV = isNaN(vValue);
          const safeVValue = isErrorV ? 0 : vValue;
          const vQty = gp.qtyV || 2;
          
          profiles.push({
            ...pVRef,
            label: 'ParcloseV 2',
            isFrame: false,
            isCouvreJoint: false,
            qty: vQty,
            length: safeVValue,
            formula: formulaV2,
            resolvedFormula: this.resolveFormula(formulaV2, scope2),
            error: isErrorV ? "Formule Invalide" : null,
            unitPrice: unitPrice,
            totalMeasure: safeVValue * vQty,
            cost: pVRef.pricePerBar 
              ? ((safeVValue * vQty) / (pVRef.barLength || 6000)) * unitPrice
              : ((safeVValue * vQty) / 1000) * (pVRef.weightPerM || 1) * unitPrice
          });
        }
      });
    }

    return {
      profiles,
      accessories,
      glass: glass ? {
        ...glass,
        width: isNaN(glassL)?0:glassL,
        height: isNaN(glassH)?0:glassH,
        qty: isNaN(glassQty)?0:glassQty,
        area: glassArea,
        weight: glassWeight,
        cost: glassCost,
        calculation: `L: ${this.resolveFormula(composition.glassFormulaL || 'L', glassScope)} = ${Math.round(glassL)} | H: ${this.resolveFormula(composition.glassFormulaH || 'H', glassScope)} = ${Math.round(glassH)}`,
        error: (isNaN(glassL) || isNaN(glassH) || isNaN(glassQty)) ? "Formule Invalide" : null
      } : { name: 'Vitrage Manquant', width: 0, height: 0, qty: 0, area: 0, weight: 0, cost: 0 },
      glass2,
      gasket,
      gasket2
    };
  }

  /**
   * Recursive grid BOM calculation (handles root and sub-layouts)
   */
  calculateGridBOM(grid, L, H, config, totalH = null, originalL = null, originalH = null, errors = []) {
    let profiles = [];
    let accessories = [];
    let glasses = [];

    const { cols, rows, cells } = grid;
    const totalColFrac = cols.reduce((a, b) => a + b, 0) || 1;
    const totalRowFrac = rows.reduce((a, b) => a + b, 0) || 1;
    
    const colWidths = cols.map(c => (c / totalColFrac) * L);
    const rowHeights = rows.map(r => (r / totalRowFrac) * H);

    // 1. Process Cells
    rows.forEach((_, ri) => {
      cols.forEach((_, ci) => {
        const cell = cells[ri][ci];
        const Lc = colWidths[ci];
        const Hc = rowHeights[ri];
        
        if (cell.subLayout) {
          // Recursive call for sub-layout
          const subRes = this.calculateGridBOM(cell.subLayout, Lc, Hc, config, totalH, originalL, originalH, errors);
          profiles = [...profiles, ...subRes.profiles];
          accessories = [...accessories, ...subRes.accessories];
          glasses = [...glasses, ...subRes.glasses];
        } else {
          // Normal leaf cell
          const compId = cell.compositionId || config.compositionId;
          const glId = cell.glassId || config.glassId;

          // Compute Glass adjustments for interior divisions (subdivisions)
          let glassLAdj = 0;
          let glassHAdj = 0;

          // Vertical adjustments (columns)
          if (cols.length > 1) {
            const trvId = grid.verticalTraverseId || grid.traverseId;
            let pRef = null;
            if (trvId) {
              pRef = (this.db.profiles || []).find(p => p.id === trvId);
            }
            if (!pRef) {
              const trv = this.db.traverses?.find(t => t.type === 'verticale') || this.db.traverses?.[0];
              if (trv && trv.profileId) {
                pRef = (this.db.profiles || []).find(p => p.id === trv.profileId);
              }
            }
            const vertThickness = pRef ? (pRef.thickness || parseInt((pRef.name || '').match(/\d+/)?.[0]) || 0) : 0;

            if (ci > 0) glassLAdj += vertThickness / 2;
            if (ci < cols.length - 1) glassLAdj += vertThickness / 2;
          }

          // Horizontal adjustments (rows)
          if (rows.length > 1) {
            const trvId = grid.horizontalTraverseId || grid.traverseId;
            let pRef = null;
            if (trvId) {
              pRef = (this.db.profiles || []).find(p => p.id === trvId);
            }
            if (!pRef) {
              const trv = this.db.traverses?.find(t => t.type === 'horizontale') || this.db.traverses?.[0];
              if (trv && trv.profileId) {
                pRef = (this.db.profiles || []).find(p => p.id === trv.profileId);
              }
            }
            const horizThickness = pRef ? (pRef.thickness || parseInt((pRef.name || '').match(/\d+/)?.[0]) || 0) : 0;

            if (ri > 0) glassHAdj += horizThickness / 2;
            if (ri < rows.length - 1) glassHAdj += horizThickness / 2;
          }

          const res = this.calculateComponentBOM(config, Lc, Hc, compId, glId, config.optionalSides, totalH, originalL, originalH, 0, errors, glassLAdj, glassHAdj);
          profiles = [...profiles, ...res.profiles];
          accessories = [...accessories, ...res.accessories];
           if (res.gasket) accessories.push(res.gasket);
          if (res.gasket2) accessories.push(res.gasket2);
          if (res.glass) glasses.push(res.glass);
          if (res.glass2) glasses.push(res.glass2);
        }
      });
    });

    // 2. Add Traverses for THIS grid level
    // Vertical traverses (between columns)
    if (cols.length > 1) {
      cols.slice(0, -1).forEach((_, ci) => {
        const trv = this.db.traverses?.find(t => t.type === 'verticale') || this.db.traverses?.[0];
        if (trv && trv.profileId) {
          const pRef = (this.db.profiles || []).find(p => p.id === trv.profileId);
          if (pRef) {
            const len = H; // Spans height of CURRENT grid
            const pPrice = pRef.pricePerBar 
              ? (len / (pRef.barLength || 6000)) * pRef.pricePerBar
              : (pRef.pricePerKg ? (len / 1000) * (pRef.weightPerM || 1) * pRef.pricePerKg : 0);

            profiles.push({
              ...pRef,
              label: `Traverse Verticale (L:${Math.round(L)} H:${Math.round(H)})`,
              qty: 1,
              length: len,
              formula: 'H',
              usage: 'DORMANT',
              cost: pPrice
            });
          }
        }
      });
    }

    // Horizontal traverses (between rows)
    if (rows.length > 1) {
      rows.slice(0, -1).forEach((_, ri) => {
        const trv = this.db.traverses?.find(t => t.type === 'horizontale') || this.db.traverses?.[0];
        if (trv && trv.profileId) {
          const pRef = (this.db.profiles || []).find(p => p.id === trv.profileId);
          if (pRef) {
            const len = L; // Spans width of CURRENT grid
            const pPrice = pRef.pricePerBar 
              ? (len / (pRef.barLength || 6000)) * pRef.pricePerBar
              : (pRef.pricePerKg ? (len / 1000) * (pRef.weightPerM || 1) * pRef.pricePerKg : 0);

            profiles.push({
              ...pRef,
              label: `Traverse Horizontale (L:${Math.round(L)} H:${Math.round(H)})`,
              qty: 1,
              length: len,
              formula: 'L',
              usage: 'DORMANT',
              cost: pPrice
            });
          }
        }
      });
    }

    return { profiles, accessories, glasses };
  }
  processShutterComponent(item, vars, shutterPack, key = '', config = {}, errors = []) {
    const isDouble = config.shutterConfig?.isDoubleShutter || false;
    const usage = item.usageVolet || 'BOTH';

    // 0. Usage Filtering
    if (isDouble) {
      if (usage === 'SINGLE_ONLY' || usage === 'SIMPLE') return;
    } else {
      if (usage === 'DOUBLE') return;
    }

    const { L, H, HC, HT } = vars;
    const barLength = parseFloat(item.barLength) || 6400;
    
    // Detect if this shutter component is a couvre-joint
    const isCJ = /couvres?[- ]?joints?|cj[vh]?/i.test((item.name || '').toLowerCase());
    const effectiveH = HT || (H + HC);

    // Rule: Couvre Joint reduction on horizontal components
    let itemScopeL = L;
    let cjReduction = 0;
    
    // Detect from shutterConfig (legacy/explicit) or from selectedOptions (standard)
    if (config.shutterConfig?.couvreJointType === 'total') cjReduction = 3;
    else if (config.shutterConfig?.couvreJointType === 'half') cjReduction = 1.5;
    else if (config.selectedOptions && config.selectedOptions.length > 0) {
      const cjOptions = config.selectedOptions.map(id => (this.db.options || []).find(o => o.id === id)).filter(o => o);
      const sideCJs = cjOptions.filter(o => {
        const n = (o.name || '').toLowerCase();
        return n.includes('couvre-joint') && (n.includes('gauche') || n.includes('droit') || n.includes('latéral') || n.includes('lateral'));
      });
      if (sideCJs.length >= 2) cjReduction = 3;
      else if (sideCJs.length === 1) cjReduction = 1.5;
    }

    if (key === 'caissonId' || key === 'lameId' || key === 'lameFinaleId' || key === 'axeId' || key === 'baguetteId') {
      itemScopeL -= cjReduction;
    }

    const evalScope = { 
      ...vars, 
      L: itemScopeL, 
      H: effectiveH, 
      HC, 
      HT: HT || (H + HC),
      nb_moteurs: isDouble ? (config.shutterConfig?.motorCount || 2) : 1
    };

    // For compatibility and alerts, if it is a double shutter, components (except caisson) should be evaluated against individual shutter dimensions (divided by 2)
    const compScope = { 
      ...evalScope,
      L_total: evalScope.L,
      isDouble
    };
    if (isDouble && key !== 'caissonId') {
      compScope.L = evalScope.L / 2;
      compScope.area = evalScope.area / 2;
      if (compScope.totalWeight !== undefined && compScope.totalWeight !== null) {
        compScope.totalWeight = evalScope.totalWeight / 2;
      }
      if (compScope.liftingWeight !== undefined && compScope.liftingWeight !== null) {
        compScope.liftingWeight = evalScope.liftingWeight / 2;
      }
    }

    // 1. Compatibility Check (Standalone Logic V3.3)
    const compatFormulaToUse = (isDouble && item.doubleCompatibilityFormula) ? item.doubleCompatibilityFormula : item.compatibilityFormula;
    if (compatFormulaToUse) {
      const isCompatible = this.evaluate(compatFormulaToUse, compScope, `Compatibilité ${item.name}`);
      if (!isCompatible) return;
    }

    // 1.5 Technical Alert Evaluation
    if (item.technicalAlert) {
      try {
        const alertMsg = this.evaluate(item.technicalAlert, compScope, `Alerte ${item.name}`, errors);
        if (alertMsg && String(alertMsg).trim() !== '' && alertMsg !== true && alertMsg !== false) {
           // Evaluated for use in BOM or reports
        }
      } catch(e) {
        console.warn(`[Technical Alert Error] ${item.name}:`, e.message);
      }
    }

    // 2. Calculate Piece Length (Dimension de coupe)
    let itemLength = 0;
    const cuttingFormulaToUse = (isDouble && item.doubleCuttingFormula) ? item.doubleCuttingFormula : item.cuttingFormula;
    
    if (cuttingFormulaToUse) {
      itemLength = this.evaluate(cuttingFormulaToUse, evalScope);
    } else {
      if (key === 'caissonId' || key === 'axeId' || key === 'lameId' || key === 'lameFinaleId') {
        itemLength = itemScopeL;
      } else if (key === 'glissiereId') {
        itemLength = effectiveH;
      }
    }

    // 2. Calculate Piece Count (Nombre de pièces)
    // Use doubleQtyFormula if in double mode and formula exists
    const formulaToUse = (isDouble && item.doubleQtyFormula) ? item.doubleQtyFormula : (item.formula || '1');
    const pieceCount = this.evaluate(formulaToUse, evalScope);
    if (pieceCount <= 0) return;

    // 3. Inclusion & Existing Checks (Standalone Logic V3.2)
    const includedParts = config.shutterConfig?.includedParts || { caisson: true, tablier: true, axe: true, glissieres: true, accessories: true };
    const isExistant = config.shutterConfig?.isExistant || false;
    const categoryMap = {
      'caissonId': 'caisson', 'lameId': 'tablier', 'lameFinaleId': 'tablier',
      'axeId': 'axe', 'glissiereId': 'glissieres', 'kitId': 'accessories', 'baguetteId': 'tablier'
    };
    const category = categoryMap[key] || 'accessories';
    if (!includedParts[category]) return;

    let itemPrice = item.price || 0;
    let displayName = item.name;
    let nameSuffix = '';

    // Special case: Caisson Tunnel (Existing)
    if (key === 'caissonId' && isExistant) {
      itemPrice = 0;
      nameSuffix = ' (Existant - Tunnel)';
    }

    // 4. Glissiere Params Logic
    if (key === 'glissiereId' && config.shutterConfig?.glissiereParams) {
      const params = config.shutterConfig.glissiereParams;
      const paramStrings = [];
      
      const opt1L = (isDouble && item.doubleOpt1Label) ? item.doubleOpt1Label : item.opt1Label;
      const opt1V = (isDouble && item.doubleOpt1Values) ? item.doubleOpt1Values : item.opt1Values;
      const opt1P = (isDouble && item.doubleOpt1Prices) ? item.doubleOpt1Prices : item.opt1Prices;

      if (opt1L) {
        const val = params.opt1 || opt1V?.split(',')[0]?.trim();
        if (val) paramStrings.push(`${opt1L}: ${val}mm`);
      }
      if (item.opt2Label) {
        const val = params.opt2 || item.opt2Values?.split(',')[0]?.trim();
        if (val) paramStrings.push(`${item.opt2Label}: ${val}mm`);
      }
      if (paramStrings.length > 0) displayName += ` (${paramStrings.join(', ')})`;

      // Option Plus-Values
      if (opt1V && opt1P) {
        const vals = opt1V.split(',').map(v => v.trim());
        const prs = opt1P.split(',').map(p => parseFloat(p.trim()) || 0);
        const selectedVal = params.opt1 || vals[0];
        const vIdx = vals.indexOf(selectedVal);
        if (vIdx !== -1 && prs[vIdx] !== undefined) itemPrice += prs[vIdx];
      }
      if (item.opt2Label && item.opt2Prices) {
        const vals = item.opt2Values.split(',').map(v => v.trim());
        const prs = item.opt2Prices.split(',').map(p => parseFloat(p.trim()) || 0);
        const selectedVal = params.opt2 || vals[0];
        const vIdx = vals.indexOf(selectedVal);
        if (vIdx !== -1 && prs[vIdx] !== undefined) itemPrice += prs[vIdx];
      }
    }

    // 5. Calculate Total Measure for Pricing
    const unitUpper = (item.priceUnit || 'Unité').toUpperCase().trim();
    let finalCost = 0;
    const linearTotalMm = pieceCount * itemLength;

    if (unitUpper === 'ML' || unitUpper === 'M' || unitUpper === 'JOINT') {
      finalCost = (linearTotalMm / 1000) * itemPrice;
    } else if (unitUpper === 'BARRE') {
      finalCost = (linearTotalMm / barLength) * itemPrice;
    } else {
      finalCost = pieceCount * itemPrice;
    }

    const weight = (key === 'lameId') ? (vars.area * (parseFloat(item.weightPerM2) || 0)) : null;

    const finalQty = (key === 'lameId' || key === 'caissonId' || key === 'axeId' || key === 'lameFinaleId' || key === 'glissiereId') ? Math.ceil(pieceCount) : pieceCount;

    shutterPack.push({
      ...item,
      itemKey: key,
      name: displayName + nameSuffix,
      qty: finalQty,
      totalWeight: weight,
      totalMeasure: linearTotalMm, 
      length: itemLength,
      barLength: barLength,
      price: itemPrice,
      priceUnit: item.priceUnit || 'Unité',
      unit: item.priceUnit || 'Unité',
      resolvedFormula: `${this.resolveFormula(formulaToUse, evalScope)} x [${this.resolveFormula(cuttingFormulaToUse || (key === 'glissiereId' ? 'H' : 'L'), evalScope)}]`,
      usage: 'VOLET ROULANT',
      cost: finalCost
    });

    // 6. Process Add-ons
    if (item.addOns && Array.isArray(item.addOns)) {
      const parentQty = Math.ceil(pieceCount);
      // Enrich scope with parent item's calculated quantities
      const addonScope = {
        ...compScope,
        nb_lames: parentQty,
        qty_lame: parentQty,
        nb_volets: isDouble ? 2 : 1,
      };

      // Pass 1: Determine which add-on names are replaced by active precadre add-ons
      const addonsToSkip = new Set();
      item.addOns.forEach(addon => {
        // Skip add-ons that require precadre when precadre is not active
        if (addon.requiresPrecadre && !config.hasPrecadre) return;
        // Check compatibility
        if (addon.compatibilityFormula) {
          const isCompatible = this.evaluate(addon.compatibilityFormula, addonScope, `Compatibilité Add-on ${addon.name}`, errors);
          if (!isCompatible) return;
        }
        // Collect names of add-ons that this active add-on replaces
        if (Array.isArray(addon.replacesAddons)) {
          addon.replacesAddons.forEach(name => addonsToSkip.add(name));
        }
      });

      // Pass 2: Process add-ons, skipping replaced ones
      item.addOns.forEach(addon => {
        // Skip add-ons that require precadre when precadre is not active
        if (addon.requiresPrecadre && !config.hasPrecadre) return;
        // Skip add-ons whose name is in the replaced set
        if (addonsToSkip.has(addon.name)) return;

        if (addon.compatibilityFormula) {
          const isCompatible = this.evaluate(addon.compatibilityFormula, addonScope, `Compatibilité Add-on ${addon.name}`, errors);
          if (!isCompatible) return;
        }
        const formulaToUse = (isDouble && addon.doubleFormula) ? addon.doubleFormula : (addon.formula || '1');
        // Calculate base qty from formula
        const baseAddonQty = this.evaluate(formulaToUse, addonScope, `Quantité Add-on ${addon.name}`, errors);
        
        // AUTO-MULTIPLY by parent piece count (e.g. 2 caps * 40 slats)
        const totalAddonQty = baseAddonQty * parentQty;

        if (totalAddonQty > 0) {
          const addonPrice = addon.price || 0;
          const addonUnit = (addon.unit || 'Unité').toUpperCase();
          let addonCost = (addonUnit === 'BARRE') ? (totalAddonQty / 6400 * addonPrice) : (totalAddonQty * addonPrice);
          shutterPack.push({
            id: `${item.id}-addon-${(addon.name || 'opt').replace(/\s+/g, '-').toLowerCase()}`,
            name: `Add-on (${item.name}): ${addon.name}`,
            qty: totalAddonQty,
            unit: addon.unit || 'Unité',
            priceUnit: addon.unit || 'Unité',
            price: addonPrice,
            formula: formulaToUse,
            resolvedFormula: `${formulaToUse} (${baseAddonQty}) x ${parentQty} pcs = ${totalAddonQty}`,
            cost: addonCost
          });
        }
      });
    }

    // 7. Baguette
    const isBaguetteActive = (item.hasBaguette !== undefined ? !!item.hasBaguette : !!config.shutterConfig?.enableBaguette);
    if (key === 'lameId' && isBaguetteActive) {
      const bPrice = item.baguettePrice || 0;
      const bUnit = item.priceUnit || 'ML';
      const bUnitUpper = bUnit.toUpperCase().trim();
      
      const bLinearTotalMm = pieceCount * itemLength;
      let bCost = 0;

      if (bUnitUpper === 'ML' || bUnitUpper === 'M' || bUnitUpper === 'JOINT') {
        bCost = (bLinearTotalMm / 1000) * bPrice;
      } else if (bUnitUpper === 'BARRE') {
        bCost = (bLinearTotalMm / barLength) * bPrice;
      } else {
        bCost = pieceCount * bPrice;
      }

      shutterPack.push({
        id: `${item.id}-baguette`,
        itemKey: 'baguetteId',
        name: `Baguette pour ${item.name}`,
        qty: pieceCount,
        length: itemLength,
        totalMeasure: bLinearTotalMm,
        priceUnit: bUnit,
        price: bPrice,
        cost: bCost
      });
    }
  }

  /**
   * Calculate BOM (Bill of Materials) for a given configuration
   */

  calculateCompoundBOM(config, L, H, totalH, originalL = null, errors = []) {
    const { compoundType, compoundConfig } = config;
    if (!compoundConfig || !compoundConfig.parts) return { profiles: [], accessories: [], glasses: [] };
    const { parts, unionId, traverseId, orientation } = compoundConfig;

    const results = { profiles: [], accessories: [], glasses: [] };
    const isVerticalSplit = orientation === 'horizontal'; // Côte à côte = séparation verticale

    // --- 1. GLOBAL FRAME ---
    const mainOp = (parts || []).find(p => p.type === 'opening' && p.compositionId) || 
                   (parts || []).find(p => p.compositionId) || 
                   (parts || [])[0];
    const frameCompId = (mainOp && mainOp.compositionId) || config.compositionId || '';
    
    const isMultiChassis = (compoundType === 'fix_coulissant' || compoundType === 'structure');
    
    if (frameCompId) {
       const globalOpt = config.optionalSides || { top: true, bottom: true, left: true, right: true };
       const frameRes = this.calculateComponentBOM(config, L, H, frameCompId, config.glassId, globalOpt, totalH, originalL || L, totalH);
       
       const isCouvreJointFn = p => /couvres?[- ]?joints?|cj[vh]?/i.test(((p.label || '') + ' ' + (p.name || '')).toLowerCase());
       const isDormantFn = p => /dormant|cadre|chassis|batit|dorme/i.test(((p.label || '') + ' ' + (p.name || '')).toLowerCase());

       const frameProfiles = frameRes.profiles.filter(p => {
         if (isMultiChassis) return isCouvreJointFn(p); // Only global cover joints for multi-chassis
         return isDormantFn(p) || isCouvreJointFn(p);
       }).map(p => ({ ...p, source: 'Cadre Global' }));
       
       results.profiles.push(...frameProfiles);
       results.accessories.push(...frameRes.accessories.filter(a => {
         if (isMultiChassis) return isCouvreJointFn(a);
         return isDormantFn(a) || isCouvreJointFn(a);
       }).map(a => ({ ...a, source: 'Cadre Global' })));
    }

    // --- 2. DIVIDER SETUP ---
    const normalize = (s) => (s || '').replace(/[-\s]+/g, '').toLowerCase();
    const currentNormRangeId = normalize(config.rangeId);
    
    let effectiveDivId = (compoundType === 'fix_coulissant') ? unionId : traverseId;
    if (effectiveDivId === 'AUTO') {
      const targetRole = isVerticalSplit ? 'traverse_v' : 'traverse_h';
      const dividerEntry = (this.db.traverses || []).find(t => 
        (t.role === targetRole || t.type === targetRole) && 
        (t.rangeIds || []).some(rid => normalize(rid) === currentNormRangeId)
      );
      if (dividerEntry) effectiveDivId = dividerEntry.profileId;
    }

    const divProfile = (this.db.profiles || []).find(p => p.id === effectiveDivId);
    let divThick = divProfile?.thickness;

    if (!divThick || parseFloat(divThick) === 0) {
        // Fallback 1: Regex on name (e.g., "Traverse 25" -> 25)
        const nameMatch = (divProfile?.name || '').match(/(\d+)/);
        if (nameMatch) {
            divThick = parseInt(nameMatch[0]);
        } else {
            // Fallback 2: Check standard traverses for a match
            const trvEntry = (this.db.traverses || []).find(t => t.id === effectiveDivId || t.profileId === effectiveDivId);
            divThick = (compoundType === 'fix_coulissant') ? (trvEntry?.thickness || 3) : 0;
        }
    }

    // --- 3. RECURSIVE PROCESSING ---
    const processPartList = (partList, boxL, boxH, direction, depth = 0, parentPart = null) => {
      const isDividerHorizontal = direction === 'vertical';
      const divQty = (partList || []).length - 1;

      // Determine division profile and thickness dynamically based on depth
      let currentDivId = (isMultiChassis && depth === 0) ? unionId : (parentPart?.traverseId || traverseId);
      if (currentDivId === 'AUTO') {
        const targetRole = isDividerHorizontal ? 'traverse_h' : 'traverse_v';
        const dividerEntry = (this.db.traverses || []).find(t => 
          (t.role === targetRole || t.type === targetRole) && 
          (t.rangeIds || []).some(rid => normalize(rid) === currentNormRangeId)
        );
        if (dividerEntry) currentDivId = dividerEntry.profileId;
      }

      const currentDivProfile = (this.db.profiles || []).find(p => p.id === currentDivId);
      let currentDivThick = parentPart?.traverseThickness ?? (isMultiChassis && depth === 0 ? compoundConfig?.unionThickness : compoundConfig?.traverseThickness);
      
      if (currentDivThick == null || isNaN(Number(currentDivThick)) || Number(currentDivThick) === 0) {
        currentDivThick = currentDivProfile?.thickness;
      }

      if (!currentDivThick || parseFloat(currentDivThick) === 0) {
        // Fallback 1: Regex on name (e.g., "Traverse 25" -> 25)
        const nameMatch = (currentDivProfile?.name || '').match(/(\d+)/);
        if (nameMatch) {
          currentDivThick = parseInt(nameMatch[0]);
        } else {
          // Fallback 2: Check standard traverses/unions for a match
          const trvEntry = (this.db.traverses || []).find(t => t.id === currentDivId || t.profileId === currentDivId);
          if (trvEntry && trvEntry.thickness) {
            currentDivThick = trvEntry.thickness;
          } else {
            currentDivThick = 25; // Default to 25mm as requested by user
          }
        }
      }

      if (divQty > 0) {
        const len = isDividerHorizontal ? boxL : boxH;
        let prof = currentDivProfile || { id: 'TRAVERSE-TMP', name: 'Traverse à définir', pricePerBar: 0, weightPerM: 0 };
        let cost = prof.pricePerBar ? (len / prof.barLength * prof.pricePerBar) : ((len/1000) * (prof.weightPerM||0) * (prof.pricePerKg||0));
        
        results.profiles.push({
          ...prof,
          label: (isMultiChassis && depth === 0) ? 'Profilé d\'Union' : `Traverse ${isDividerHorizontal ? 'Horiz.' : 'Vert.'}`,
          source: 'Jonction',
          formula: isDividerHorizontal ? 'L' : 'H',
          resolvedFormula: `${len} mm`,
          unitPrice: prof.pricePerBar ? (prof.pricePerBar / (prof.barLength || 6000)) : ((prof.weightPerM||0) * (prof.pricePerKg||0) / 1000),
          qty: divQty, length: len, totalMeasure: len * divQty, cost: cost * divQty
        });

        // Process add-ons for divider/jonction profiles
        if (prof.addOns && Array.isArray(prof.addOns) && prof.addOns.length > 0) {
          const divAddonScope = { L: boxL, H: boxH, len };
          prof.addOns.forEach(addon => {
            // Compatibility check
            if (addon.compatibilityFormula) {
              try {
                const isCompatible = this.evaluate(addon.compatibilityFormula, divAddonScope, `Compatibilité Add-on Jonction ${addon.name}`, errors);
                if (!isCompatible) return;
              } catch(e) { return; }
            }

            const addonFormula = addon.formula || '1';
            let baseAddonQty = 1;
            try {
              baseAddonQty = this.evaluate(addonFormula, divAddonScope, `Qté Add-on Jonction ${addon.name}`, errors);
            } catch(e) { baseAddonQty = 1; }

            const totalAddonQty = baseAddonQty * divQty;
            if (totalAddonQty <= 0) return;

            const addonPrice = addon.price || 0;
            const addonUnit = (addon.unit || 'Unité').toUpperCase();
            let addonCost = addonUnit === 'ML' ? (totalAddonQty / 1000 * addonPrice) : (totalAddonQty * addonPrice);

            results.accessories.push({
              id: `${prof.id}-addon-${(addon.name || 'opt').replace(/\s+/g, '-').toLowerCase()}`,
              name: `Add-on (${prof.name}): ${addon.name}`,
              label: addon.name,
              qty: totalAddonQty,
              totalMeasure: addonUnit === 'ML' ? totalAddonQty : 0,
              unit: addon.unit || 'Unité',
              priceUnit: addon.unit || 'Unité',
              price: addonPrice,
              formula: addonFormula,
              resolvedFormula: `${addonFormula} (${baseAddonQty}) x ${divQty} jonctions = ${totalAddonQty}`,
              source: 'Jonction',
              cost: addonCost
            });
          });
        }
      }

      // Pre-calculate divider thickness (must be before items map)
      const divThickNum = Number(currentDivThick || 0);

      // 1. Pre-calculate raw dimensions for all parts
      // Apply partOverrides for BOTH dimensions (splitting and non-splitting)
      const splitKey = direction === 'horizontal' ? 'rawL' : 'rawH';
      const items = (partList || []).map((part, idx) => {
        const overrideW = config.partOverrides?.[part.id]?.width;
        const overrideH = config.partOverrides?.[part.id]?.height;
        const hasOvW = overrideW !== undefined && overrideW !== null && !isNaN(Number(overrideW));
        const hasOvH = overrideH !== undefined && overrideH !== null && !isNaN(Number(overrideH));

        let rawL, rawH;
        if (direction === 'horizontal') {
          rawL = Number(hasOvW ? overrideW : (part.width || (boxL / partList.length)));
          rawH = Number(hasOvH ? overrideH : boxH);
        } else {
          rawL = Number(hasOvW ? overrideW : boxL);
          rawH = Number(hasOvH ? overrideH : (part.height || (boxH / partList.length)));
        }

        return {
          ...part,
          idx,
          rawL,
          rawH,
          _hasOverrideSplit: direction === 'horizontal' ? hasOvW : hasOvH
        };
      });

      // 2. Recalculate auto parts in the splitting dimension
      // When some parts have explicit overrides, auto parts fill the remaining space
      const available = (direction === 'horizontal' ? boxL : boxH) - ((isMultiChassis || compoundType === 'fix_ouvrant') ? 0 : divQty * divThickNum);

      const overriddenParts = items.filter(it => it._hasOverrideSplit);
      const autoParts = items.filter(it => !it._hasOverrideSplit);

      if (overriddenParts.length > 0 && autoParts.length > 0) {
        // Redistribute remaining space among auto parts
        const overriddenTotal = overriddenParts.reduce((sum, it) => sum + it[splitKey], 0);
        const remainingSpace = Math.max(0, available - overriddenTotal);
        const autoTotal = autoParts.reduce((sum, it) => sum + it[splitKey], 0);
        if (autoTotal > 0) {
          const scale = remainingSpace / autoTotal;
          autoParts.forEach(it => { it[splitKey] *= scale; });
        } else if (autoParts.length > 0) {
          const perAuto = remainingSpace / autoParts.length;
          autoParts.forEach(it => { it[splitKey] = perAuto; });
        }
      } else {
        // No mixed overrides: use original overflow adjustment
        const totalRequested = items.reduce((sum, item) => sum + item[splitKey], 0);
        if (Math.abs(totalRequested - available) > 0.1) {
          const excess = totalRequested - available;
          const flexibleItems = items.filter(it => it.type !== 'fixe');
          
          if (flexibleItems.length > 0) {
            const totalFlex = flexibleItems.reduce((sum, it) => sum + it[splitKey], 0);
            flexibleItems.forEach(it => {
              const weight = totalFlex > 0 ? it[splitKey] / totalFlex : (1 / flexibleItems.length);
              it[splitKey] -= excess * weight;
            });
          } else {
            const scale = available / totalRequested;
            items.forEach(it => { it[splitKey] *= scale; });
          }
        }
      }


      // 3. Process each item with adjusted dimensions
      items.forEach((part, idx) => {
        const isFirst = idx === 0;
        const isLast = idx === items.length - 1;
        
        let calcL = part.rawL;
        let calcH = part.rawH;



        if (compoundType === 'fix_ouvrant' && part.type === 'opening') {
          if (direction === 'horizontal') {
            const hasLeftPart = !isFirst;
            const hasRightPart = !isLast;
            if (hasLeftPart) calcL += 25;
            if (hasRightPart) calcL += 25;
          } else if (direction === 'vertical') {
            const hasTopPart = !isFirst;
            const hasBottomPart = !isLast;
            if (hasTopPart) calcH += 25;
            if (hasBottomPart) calcH += 25;
          }
        }

        if (part.type === 'extra') {
          let extraRef = (this.db.extraElements || []).find(e => e.id === part.compositionId || e.id === part.extraElementId);
          if (!extraRef) {
            extraRef = (this.db.profiles || []).find(p => p.id === part.compositionId || p.id === part.extraElementId);
          }
          if (extraRef) {
            const f = extraRef.formula || (part.extraOrientation === 'L' ? 'L' : 'H');
            const evalScope = { L: calcL, H: calcH, HC: 0, totalH: totalH || calcH, originalL: originalL || calcL, EPt: 0, Epd: 40 };
            const len = this.evaluate(f, evalScope, part.label || extraRef.name, errors);
            
            const itemQty = part.qty || 1;
            let unitPrice = extraRef.pricePerBar || 0;
            let cost = 0;
            if (extraRef.pricePerBar) {
              cost = (len / (extraRef.barLength || 6000)) * extraRef.pricePerBar;
            } else if (extraRef.pricePerKg) {
              cost = (len / 1000) * (extraRef.weightPerM || 1) * extraRef.pricePerKg;
            }
            results.profiles.push({
              ...extraRef,
              label: part.label || extraRef.name,
              source: 'Élément Supplémentaire',
              formula: f,
              resolvedFormula: this.resolveFormula(f, evalScope),
              qty: itemQty,
              length: len,
              totalMeasure: len * itemQty,
              cost: cost * itemQty
            });
          }
          return;
        }

        if (part.type === 'group' && part.subParts) {
           processPartList(part.subParts, calcL, calcH, direction === 'horizontal' ? 'vertical' : 'horizontal', depth + 1, part);
           return;
        }

        const compId = part.compositionId || frameCompId;
        const useSubPart = !isMultiChassis || (depth > 0);
        
        const subPartOpt = useSubPart 
          ? { top: false, bottom: false, left: false, right: false, isSubPart: true } 
          : { ...(config.optionalSides || { top: true, bottom: true, left: true, right: true }), isSubPart: false };
        
        const currentEPt = useSubPart ? currentDivThick : 0;
        
        let glassLAdj = 0;
        let glassHAdj = 0;
        if (depth > 0 && partList.length > 1) {
          if (direction === 'horizontal') {
            if (idx > 0) glassLAdj += 12.5;
            if (idx < partList.length - 1) glassLAdj += 12.5;
          } else {
            if (idx > 0) glassHAdj += 12.5;
            if (idx < partList.length - 1) glassHAdj += 12.5;
          }
        }

        const res = this.calculateComponentBOM({
          ...config,
          compositionId: compId,
          openingDirection: part.openingDirection || config.openingDirection || 'gauche',
          _compoundMode: true,
          _filterDormant: compoundType === 'fix_ouvrant' // Only filter dormant if we handled it globally
        }, calcL, calcH, compId, part.glassId || config.glassId, subPartOpt, calcH, Number(originalL || L), totalH, currentEPt, errors, glassLAdj, glassHAdj);
        const sourceLabel = `Partie ${idx + 1} (${part.type})`;

        const filterFn = (i) => {
           const s = ((i.label || '') + ' ' + (i.name || '')).toLowerCase();
           const isCJ = i.isCouvreJoint || /couvres?[- ]?joints?|cj[vh]?/i.test(s);
           const isDormant = ['dormant', 'cadre', 'batit', 'dorme'].some(t => s.includes(t));

           if (isMultiChassis && depth === 0) {
              if (isCJ) return false; // CJ are now global
              return true; // Keep dormants for multi-chassis
           }
           
           if (s.includes('parclose') || s.includes('joint')) return true;
           if (isCJ) return false;
           if (isDormant) return false;
           if (part.type === 'fixe' && ['ouvrant', 'vantail', 'chicane', 'panneau', 'reducteur', 'poignee', 'cremone', 'paumelle', 'galet', 'serrure'].some(t => s.includes(t))) return false;
           return true;
        };

        results.profiles.push(...(res.profiles || []).filter(filterFn).map(p => ({ ...p, source: sourceLabel })));
        results.accessories.push(...(res.accessories || []).filter(filterFn).map(a => ({ ...a, source: sourceLabel })));
        if (res.gasket) results.accessories.push({ ...res.gasket, source: sourceLabel });
        if (res.gasket2) results.accessories.push({ ...res.gasket2, source: sourceLabel });
        if (res.glass) results.glasses.push({ ...res.glass, source: sourceLabel });
        if (res.glass2) results.glasses.push({ ...res.glass2, source: sourceLabel });
      });
    };

    processPartList(parts, L, H, orientation, 0);
    return results;
  }

  calculateBOM(config) {
    if (!this.db || !config) return { profiles: [], accessories: [], glasses: [], shutters: [], errors: [] };
    const errors = [];
    let { L, H, glassId } = config;
    
    const isOnlyShutter = !!config.isOnlyShutter;
    let widthReduction = 0;

    if (!isOnlyShutter && config.hasShutter && config.shutterConfig) {
      const sc = this.db.shutterComponents;
      
      // FIX: Use overridden glissiereId if present
      let gid = config.shutterOverrides?.glissiereId || config.shutterConfig.glissiereId;

      if (gid === 'AUTO') {
        const kitId = config.shutterConfig.kitId;
        const selectedKit = (sc.kits || []).find(k => k.id === kitId);
        const kitType = selectedKit?.type || 'SANGLE';
        const type = kitType === 'MOTEUR' ? 'PALA' : (kitType === 'SANGLE' ? 'MONO' : 'OTHER');
        
        let compForRange = (config.compoundType && config.compoundType !== 'none' && config.compoundConfig?.parts?.length > 0)
          ? (this.db.compositions || []).find(c => c.id === (config.compoundConfig.parts.find(p => p.type === 'opening' && p.compositionId) || config.compoundConfig.parts[0])?.compositionId)
          : (this.db.compositions || []).find(c => c.id === config.compositionId);

        if (compForRange) {
          const autoG = (sc.glissieres || []).find(g => 
             (!g.rangeId || g.rangeId === compForRange.rangeId) && 
             g.shutterType === type
          );
          if (autoG) gid = autoG.id;
        }
      }

      const gDef = (sc.glissieres || []).find(x => x.id === gid);
      if (gDef) {
        if (gDef.thickness != null && gDef.thickness !== '') {
          widthReduction = parseFloat(gDef.thickness) || 0;
        } else if (gDef.shutterType === 'MONO') {
          widthReduction = 92;
        }
      }
    }

    const initialL = L;

    if (widthReduction > 0) {
      L -= widthReduction;
    }
    
    // --- 4. PREPARE DIMENSIONS ---
    let shutterHeight = 0;
    if (config.hasShutter) {
      const shutterConfig = config.shutterConfig || {};
      const customHC = config.shutterOverrides?.customHC;
      if (customHC !== undefined && customHC !== null && customHC !== '') {
        shutterHeight = parseFloat(customHC) || 0;
      } else {
        // FIX: Use overridden caissonId if present
        const effectiveCaissonId = config.shutterOverrides?.caissonId || shutterConfig.caissonId;
        const caisson = (this.db.shutterComponents?.caissons || []).find(c => c.id === effectiveCaissonId);
        shutterHeight = parseFloat(caisson?.height) || 0;
      }
    }

    const totalH = H;
    const windowH = isOnlyShutter ? 0 : Math.max(0, H - shutterHeight);

    let profiles = [];
    let accessories = [];
    let glasses = [];

    if (!isOnlyShutter) {
      if (config.compoundType && config.compoundType !== 'none') {
        const compRes = this.calculateCompoundBOM(config, L, windowH, totalH, initialL, errors);
        profiles = compRes.profiles;
        accessories = compRes.accessories;
        glasses = compRes.glasses;
      } else if (config.useCustomLayout && config.customLayout && config.customLayout.cols) {
        const gridResults = this.calculateGridBOM(config.customLayout, L, windowH, config, totalH, initialL, totalH);
        profiles = gridResults.profiles;
        accessories = gridResults.accessories;
        glasses = gridResults.glasses;
      } else {
        const res = this.calculateComponentBOM(config, L, windowH, config.compositionId, glassId, config.optionalSides, totalH, initialL, totalH, 0, errors);
        profiles = res.profiles;
        accessories = res.accessories;
        if (res.gasket) accessories.push(res.gasket);
        if (res.gasket2) accessories.push(res.gasket2);
        if (res.glass) glasses.push(res.glass);
        if (res.glass2) glasses.push(res.glass2);
      }
    }

    // 5. Précadre Filter: Remove only chevilles if pre-frame installation is selected
    let activeAccessories = [...accessories];
    if (config.hasPrecadre) {
      activeAccessories = activeAccessories.filter(a => {
        const searchStr = ((a.name || '') + ' ' + (a.label || '')).toLowerCase();
        return !searchStr.includes('cheville');
      });
    }

    // 6. Global Options & Variantes processing on the accumulated accessories
    const windowDir = (config.openingDirection || 'gauche').toLowerCase();
    const scope = {
      L: L,
      H: windowH,
      totalH: totalH,
      originalL: initialL,
      HC: shutterHeight,
      qty: 1,
      openingDirection: windowDir,
      isGauche: windowDir.includes('gauch'),
      isDroit: windowDir.includes('droit'),
      isDroite: windowDir.includes('droit')
    };

    if (!isOnlyShutter && config.selectedOptions && config.selectedOptions.length > 0) {
      config.selectedOptions.forEach(optId => {
        const option = this.db.options?.find(o => o.id === optId);
        if (option) {
          // Remove if a replacement is specified
          if (option.removeAccessoryId) {
            activeAccessories = activeAccessories.filter(a => a.id !== option.removeAccessoryId);
          }
          // Add the option accessory
          if (option.addAccessoryId) {
            const addRef = (this.db.accessories || []).find(a => a.id === option.addAccessoryId);
            if (addRef) {
              // Compatibility Check
              if (addRef.compatibilityFormula && addRef.compatibilityFormula.trim() !== '') {
                try {
                  const ok = this.evaluate(addRef.compatibilityFormula, scope);
                  if (!ok) return; // Skip incompatible option accessory
                } catch (e) {
                  console.warn(`[FormulaEngine] Option compatibility error for ${addRef.id}:`, e.message);
                }
              }

              const optionSide = config.optionSides?.[optId] || 'both';
              const multiplier = optionSide === 'both' ? 2 : 1;
              
              const rawQty = this.evaluate(option.formula || '1', scope, `Option: ${option.name}`, errors);
              const qty = rawQty * multiplier; 
              
              if (qty <= 0) return; // Skip if qty is 0              
              activeAccessories.push({
                ...addRef,
                label: `Option: ${option.name}${optionSide !== 'both' ? ' (' + optionSide + ')' : ''}`,
                qty: qty,
                multiplier: qty,
                totalMeasure: qty,
                formula: option.formula || '1',
                resolvedFormula: this.resolveFormula(option.formula || '1', scope),
                unitPrice: addRef.price || 0,
                cost: qty * (addRef.price || 0),
                side: optionSide
              });
            }
          }
        }
      });
    }

    // 6. Volet Roulant
    let shutterL = config.shutterOverrides?.customLV || initialL;
    let shutterH_val = isOnlyShutter ? H : windowH;
    
    if (!isOnlyShutter && config.compoundType && config.compoundType !== 'none' && config.compoundConfig?.shutterMode === 'opening_only') {
       const opPart = config.compoundConfig.parts?.find(p => p.type === 'opening');
       if (opPart) {
          if (config.compoundConfig.orientation !== 'vertical') {
             shutterL = config.shutterOverrides?.customLV || opPart.width;
          } else {
             shutterH_val = opPart.height;
          }
       }
    }

    const vars = { 
      L: shutterL, 
      H: shutterH_val, 
      HC: config.shutterOverrides?.customHC || shutterHeight, 
      HT: H,
      caissonSize: 0,
      lameWidth: 0,
      area: 0,
      axeSize: 0,
      kitId: config.shutterConfig?.kitId,
      caissonId: config.shutterConfig?.caissonId,
      axeId: config.shutterConfig?.axeId,
      lameId: config.shutterConfig?.lameId,
      openingDirection: config.openingDirection || 'gauche',
      nb_moteurs: config.shutterConfig?.isDoubleShutter ? (config.shutterConfig?.motorCount || 2) : 1
    };
    
    const sc = this.db.shutterComponents || {};

    if (vars.caissonId) {
      const c = (sc.caissons || []).find(x => x.id === vars.caissonId);
      if (c) vars.caissonSize = parseFloat(c.height) || parseFloat(c.size) || parseFloat(c.thickness) || 0;
    }
    vars.caisson = vars.caissonSize;
    if (vars.axeId) {
      const a = (sc.axes || []).find(x => x.id === vars.axeId);
      if (a) vars.axeSize = parseFloat(a.diameter) || parseFloat((a.name || "").match(/\d+/)?.[0]) || 0;
    }
    vars.area = (vars.L * vars.H) / 1000000;
    if (vars.lameId) {
      const l = (sc.lames || []).find(x => x.id === vars.lameId);
      if (l) {
        vars.lameWidth = parseFloat(l.lameWidth) || parseFloat((l.formula || "").match(/\/(\d+)/)?.[1]) || parseFloat((l.name || "").match(/\d+/)?.[0]) || 0;
        vars.weightPerM2 = parseFloat(l.weightPerM2) || 0;
        vars.totalWeight = vars.area * vars.weightPerM2;
      }
    }
    // Calculate liftingWeight based on axeSize (diameter)
    const axeDiameter = vars.axeSize || 0;
    vars.axeDiameter = axeDiameter;
    const totalWeight = vars.totalWeight || 0;
    vars.liftingWeight = totalWeight;

    const shutterPack = [];
    if (config.hasShutter && config.shutterConfig && this.db.shutterComponents) {
      const sc = this.db.shutterComponents;
      const families = [
        { key: 'caissonId',    source: sc.caissons },
        { key: 'lameId',       source: sc.lames },
        { key: 'lameFinaleId', source: sc.lameFinales },
        { key: 'glissiereId',  source: sc.glissieres },
        { key: 'axeId',        source: sc.axes },
        { key: 'moteurId',     source: sc.moteurs },
        { key: 'kitId',        source: sc.kits }
      ];

      families.forEach(({ key, source }) => {
        let selectedId = config.shutterOverrides?.[key] || config.shutterConfig[key];
        
        // Resolve AUTO glissière
        if (key === 'glissiereId' && selectedId === 'AUTO') {
          const kitId = config.shutterConfig.kitId;
          const selectedKit = (this.db.shutterComponents?.kits || []).find(k => k.id === kitId);
          const kitType = selectedKit?.type || 'SANGLE';
          const type = kitType === 'MOTEUR' ? 'PALA' : (kitType === 'SANGLE' ? 'MONO' : 'OTHER');
          
          let compositionId = config.compositionId;
          if (!compositionId && config.compoundConfig?.parts) {
             const parts = config.compoundConfig.parts;
             compositionId = (parts.find(p => p.type === 'opening' && p.compositionId) || parts.find(p => p.compositionId))?.compositionId;
          }

          const composition = (this.db.compositions || []).find(c => c.id === compositionId);
          if (composition) {
            const autoG = (source || []).find(g => (!g.rangeId || g.rangeId === composition.rangeId) && g.shutterType === type);
            if (autoG) selectedId = autoG.id;
          }
        }

        const item = (source || []).find(x => x.id === selectedId);
        if (item) {
          this.processShutterComponent(item, vars, shutterPack, key, config, errors);
        }
      });

      // 7. Automatic Shutter Extras (All components in 'extras' category)
      if (sc.extras && Array.isArray(sc.extras)) {
        sc.extras.forEach(extra => {
           this.processShutterComponent(extra, vars, shutterPack, 'extraId', config);
        });
      }
    }

    // --- AGGREGATION PRE-PASS (for UI summaries) ---
    
    // Aggregated Gasket (Singular field for compatibility if needed, but we don't pull it out of accessories anymore)
    let finalGasket = null;

    // Aggregated Glass (Singular field for UI)
    let finalGlass = { name: 'Vitrage', area: 0, weight: 0, cost: 0, qty: 0 };
    if (glasses.length > 0) {
      finalGlass = {
        ...glasses[0],
        name: glasses.length > 1 ? `Mixte (${glasses.length} panneaux)` : glasses[0].name,
        qty: glasses.reduce((sum, g) => sum + (g.qty || 0), 0),
        area: glasses.reduce((sum, g) => sum + (g.area || 0), 0),
        weight: glasses.reduce((sum, g) => sum + (g.weight || 0), 0),
        cost: glasses.reduce((sum, g) => sum + (g.cost || 0), 0)
      };
    }

    const bom = {
      profiles,
      glass: finalGlass,
      glassDetails: glasses,
      gasket: finalGasket,
      accessories: activeAccessories,
      shutters: shutterPack,
      errors: errors
    };

    return this.mergeBOM(bom);
  }


  /**
   * Calculate final pricing
   */
  calculatePrice(config) {
    if (!this.db || !config) return { cost: 0, priceHT: 0, priceTTC: 0, subtotals: {}, bom: { profiles: [], accessories: [], glass: {}, shutters: [], errors: [] }, errors: [] };
    const bom = this.calculateBOM(config);
    const errors = bom.errors || [];
    const color = (this.db.colors || []).find(c => c.id === config.colorId);
    
    // Subtotals (Raw material costs)
    const profilesRaw = bom.profiles.reduce((sum, p) => sum + p.cost, 0);
    
    // Separate gaskets from other accessories for clear subtotal reporting
    const gasketsOnly = bom.accessories.filter(a => a.isGlassGasket);
    const accessoriesOnly = bom.accessories.filter(a => !a.isGlassGasket);
    
    const accessoriesTotal = accessoriesOnly.reduce((sum, a) => sum + (a.cost || 0), 0);
    const gasketTotal = (bom.gasket ? bom.gasket.cost : 0) + gasketsOnly.reduce((sum, g) => sum + (g.cost || 0), 0);
    
    const glassTotal = bom.glass ? bom.glass.cost : 0;
    const shutterTotal = (bom.shutters || []).reduce((sum, s) => sum + (s.cost || 0), 0);

    // Apply color factor ONLY to profiles
    const profilesTotal = profilesRaw * (color ? color.factor : 1.0);
    
    // Total cost (Revient)
    const totalRevient = profilesTotal + accessoriesTotal + glassTotal + gasketTotal + shutterTotal;
    
    const margin = config.margin || (this.db.margins?.default || 2.2);
    const priceHT = totalRevient * margin;
    
    return {
      cost: totalRevient,
      subtotals: {
        profiles: profilesTotal,
        accessories: accessoriesTotal,
        glass: glassTotal,
        gasket: gasketTotal,
        shutter: shutterTotal
      },
      priceHT,
      priceTTC: priceHT * 1.20,
      bom,
      errors
    };
  }

  /**
   * Check if configuration is valid within technical limits
   */
  validate(config) {
    if (config.useCustomLayout) return { valid: true }; // Custom layouts skip basic range checks for now

    // If it's an assemblage, the global compositionId might be empty (Automatic)
    const isAssemblage = config.compoundType && config.compoundType !== 'none';
    const composition = (this.db.compositions || []).find(c => c.id === config.compositionId);
    
    if (!composition && !isAssemblage) return { valid: false, message: 'Composition inexistante' };

    const range = composition ? (this.db.ranges || []).find(r => r.id === composition.rangeId) : null;
    if (!range && !isAssemblage) return { valid: false, message: 'Gamme inexistante' };

    const glass = (this.db.glass || []).find(g => g.id === config.glassId);
    const isPrecadreOrVitrage = composition?.isPrecadre || (composition?.name || '').toLowerCase().includes('precadre') || (composition?.name || '').toLowerCase().includes('vitrage');
    if (!glass && !isPrecadreOrVitrage) return { valid: false, message: 'Vitrage selectionné inexistant' };

    const color = (this.db.colors || []).find(c => c.id === config.colorId);
    if (!color) return { valid: false, message: 'Couleur selectionnée inexistante' };

    const { L, H } = config;
    if (range) {
       if (L < range.minL || L > range.maxL) {
         return { valid: false, message: `Largeur hors limites (${range.minL}-${range.maxL} mm)` };
       }
       if (H < range.minH || H > range.maxH) {
         return { valid: false, message: `Hauteur hors limites (${range.minH}-${range.maxH} mm)` };
       }
    }

    return { valid: true };
  }

  mergeBOM(bom) {
    const merge = (list, keyFields) => {
       const map = new Map();
       list.forEach(item => {
          // Include source in key to keep parts separate if they have different sources
          const fields = [...keyFields];
          if (item.source) fields.push('source');
          
          const key = fields.map(f => {
              const val = item[f];
              if (f === 'length' && typeof val === 'number') return Math.round(val);
              return val;
          }).join('|');
          
          if (map.has(key)) {
             const existing = map.get(key);
             existing.qty = (existing.qty || 0) + (item.qty || 0);
             existing.cost = (existing.cost || 0) + (item.cost || 0);
             if (existing.area !== undefined) existing.area = (existing.area || 0) + (item.area || 0);
             if (existing.weight !== undefined) existing.weight = (existing.weight || 0) + (item.weight || 0);
             if (existing.totalMeasure !== undefined) existing.totalMeasure = (existing.totalMeasure || 0) + (item.totalMeasure || 0);
             
             // Merge sources (fallback if not in key)
             if (!fields.includes('source')) {
                if (item.source && existing.source) {
                   const sources = new Set([...existing.source.split(', '), item.source]);
                   existing.source = Array.from(sources).join(', ');
                } else if (item.source) {
                   existing.source = item.source;
                }
             }
          } else {
             map.set(key, { ...item });
          }
       });
       return Array.from(map.values());
    };

    return {
       ...bom,
       profiles: merge(bom.profiles || [], ['id', 'length', 'label']),
       accessories: merge(bom.accessories || [], ['id', 'label']),
       glassDetails: merge(bom.glassDetails || bom.glasses || [], ['id', 'label', 'width', 'height'])
    };
  }
}
