// ============================================
// Herramienta de ajuste de precios (paso 2 de la modularización gradual)
// Extraída de app.js como script clásico en el mismo scope global: la
// herramienta completa para subir/bajar precios en masa (por % o inflación,
// con redondeo y terminación comercial), su vista previa y el "deshacer".
// Usa los globals de app.js (products, sb, currentUserId, showToast, fmtMoney,
// escapeHtml, renderCatalog, fillProductSelectOptions) sin importarlos, y
// renderCatalog() en app.js la invoca de vuelta vía renderPriceUndoBar(). No
// migramos a módulos ES6 a propósito: ver docs y memoria del proyecto.
// ============================================

// ============================================
// Ajuste masivo de precios por inflación
// Sube o baja todos los precios del catálogo de una (un % a mano o la inflación
// del mes del INDEC), con redondeo prolijo —incluida terminación comercial
// $…90 / $…99— y vista previa antes de aplicar. Toca solo el precio de venta,
// nunca el costo. Pensado para la Argentina: con inflación alta, re-marcar
// producto por producto es inviable.
// ============================================
const priceAdjust = { pct: 10, dir: 1, round: '10', scope: '__all__', busy: false };

function pctLabel(pct){
  return (Math.round(pct * 10) / 10).toString().replace('.', ',') + '%';
}

// Redondea un precio con terminación comercial ($…90 / $…99). Redondea EN LA
// DIRECCIÓN del ajuste (hacia arriba al subir, hacia abajo al bajar) para no
// invertir el sentido: si no, por ejemplo $200 +10% con $…90 caería a $190
// (el …90 más cercano a 220), o sea un aumento que termina bajando el precio.
// dir: 1 sube, -1 baja; sin dir (undefined) usa el más cercano.
function endInPrice(value, ending, dir){
  const cercano = Math.round((value - ending) / 100) * 100 + ending;
  let base;
  if(dir === 1) base = cercano >= value ? cercano : cercano + 100;      // subir: hacia arriba
  else if(dir === -1) base = cercano <= value ? cercano : cercano - 100; // bajar: hacia abajo
  else base = cercano;
  return base > 0 ? base : ending;
}

function roundPrice(value, mode, dir){
  if(mode === 'end90') return endInPrice(value, 90, dir);
  if(mode === 'end99') return endInPrice(value, 99, dir);
  mode = Number(mode) || 0;
  if(mode <= 0) return Math.round(value * 100) / 100; // sin redondear: a 2 decimales
  return Math.round(value / mode) * mode;
}

function productosEnAlcance(){
  return products.filter(p => {
    if(!(Number(p.precio_venta) > 0)) return false;
    if(priceAdjust.scope === '__all__') return true;
    return (p.categoria || '').trim() === priceAdjust.scope;
  });
}

// Cambia la dirección del ajuste (subir=1 / bajar=-1) y adapta los textos. La
// inflación solo tiene sentido al subir, así que al bajar se esconde ese chip.
function setPriceDir(dir){
  priceAdjust.dir = dir;
  document.querySelectorAll('#pmDir .pm-dir-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.dir) === dir));
  const label = document.getElementById('pmPctLabel');
  if(label) label.textContent = dir === 1 ? '¿Cuánto querés aumentar?' : '¿Cuánto querés bajar?';
  const inflaChip = document.getElementById('pmChipInfla');
  if(inflaChip){
    inflaChip.style.display = dir === 1 ? '' : 'none';
    if(dir === 1 && !inflaChip.classList.contains('active')) inflaChip.innerHTML = `<span class="pm-chip-dot"></span>Inflación del mes`;
  }
  renderPricePreview();
}

function openPriceAdjust(){
  const modal = document.getElementById('priceAdjustModal');
  if(!modal) return;
  priceAdjust.pct = 10; priceAdjust.round = '10'; priceAdjust.scope = '__all__'; priceAdjust.busy = false;
  document.getElementById('pmPct').value = '10';
  document.querySelectorAll('#pmPctChips .pm-chip').forEach(c => c.classList.toggle('active', c.dataset.pct === '10'));
  document.querySelectorAll('#pmRoundChips .pm-chip').forEach(c => c.classList.toggle('active', c.dataset.round === '10'));
  const inflaChip = document.getElementById('pmChipInfla');
  if(inflaChip) inflaChip.innerHTML = `<span class="pm-chip-dot"></span>Inflación del mes`;
  setPriceDir(1);

  const sel = document.getElementById('pmScope');
  const cats = [...new Set(products.filter(p => Number(p.precio_venta) > 0).map(p => (p.categoria || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  sel.innerHTML = `<option value="__all__">Todo el catálogo</option>` + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  sel.value = '__all__';

  const off = document.getElementById('pmOffline');
  const applyBtn = document.getElementById('pmApply');
  const offline = !navigator.onLine;
  off.style.display = offline ? 'block' : 'none';
  applyBtn.disabled = offline;
  applyBtn.style.opacity = offline ? '.5' : '';

  const apply = document.getElementById('pmApply');
  if(apply){ apply.classList.remove('pm-apply-busy'); apply.textContent = 'Aplicar'; }
  renderPricePreview();
  modal.style.display = 'flex';
}

function closePriceAdjust(){
  const modal = document.getElementById('priceAdjustModal');
  if(modal) modal.style.display = 'none';
}

function renderPricePreview(){
  const prev = document.getElementById('pmPreview');
  const count = document.getElementById('pmCount');
  const sub = document.getElementById('pmSubtitle');
  if(!prev) return;
  const mag = Math.abs(Number(String(document.getElementById('pmPct').value).replace(',', '.')) || 0);
  const pct = priceAdjust.dir * mag;   // firmado: + sube, - baja
  priceAdjust.pct = pct;
  const verbo = priceAdjust.dir === 1 ? 'subir' : 'bajar';
  const items = productosEnAlcance();
  if(count) count.textContent = items.length === 1 ? '1 producto' : `${items.length} productos`;
  if(sub) sub.textContent = mag > 0
    ? `Vas a ${verbo} ${items.length} ${items.length === 1 ? 'precio' : 'precios'} un ${pctLabel(mag)}`
    : `Elegí cuánto ${priceAdjust.dir === 1 ? 'aumentar' : 'bajar'}`;
  // Sin porcentaje todavía no hay nada que previsualizar: mostrar precios
  // "cambiados" por el redondeo (que Aplicar después rechaza) confundiría.
  if(mag === 0){
    prev.innerHTML = `<div class="pm-preview-empty">Elegí cuánto ${priceAdjust.dir === 1 ? 'aumentar' : 'bajar'} para ver la vista previa.</div>`;
    return;
  }
  const factor = 1 + pct / 100;
  // Bajar 100% o más dejaría los precios en $0 o negativos: se avisa y no se
  // listan precios inválidos.
  if(factor <= 0){
    if(sub) sub.textContent = 'No podés bajar 100% o más';
    prev.innerHTML = `<div class="pm-preview-empty">Bajar 100% o más dejaría los precios en $0 o menos. Probá con un porcentaje más chico.</div>`;
    return;
  }
  if(items.length === 0){
    prev.innerHTML = `<div class="pm-preview-empty">No hay productos con precio en este grupo.</div>`;
    return;
  }
  prev.innerHTML = items
    .sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'))
    .map(p => {
      const viejo = Number(p.precio_venta);
      const nuevo = roundPrice(viejo * factor, priceAdjust.round, priceAdjust.dir);
      const cero = nuevo <= 0;
      return `<div class="pm-prow">
        <span class="pm-pname">${escapeHtml(p.nombre)}</span>
        <span class="pm-pprice"><span class="pm-pold">${fmtMoney(viejo)}</span><span>→</span><span class="pm-pnew${cero ? ' pm-pnew-bad' : ''}">${cero ? '$0' : fmtMoney(nuevo)}</span></span>
      </div>`;
    }).join('');
}

async function fillInflacionEnAjuste(){
  const chip = document.getElementById('pmChipInfla');
  if(!chip) return;
  const restore = chip.innerHTML;
  chip.innerHTML = `<span class="pm-chip-dot"></span>Buscando…`;
  try{
    const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if(!Array.isArray(data) || data.length === 0) throw new Error('sin datos');
    const ultimo = data[data.length - 1];
    const valor = Number(ultimo.valor);
    if(!(valor > 0)) throw new Error('valor inválido');
    const [y, m] = ultimo.fecha.split('-');
    const mesLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', {month:'short'});
    document.getElementById('pmPct').value = String(valor).replace('.', ',');
    document.querySelectorAll('#pmPctChips .pm-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    chip.innerHTML = `<span class="pm-chip-dot"></span>Inflación ${mesLabel}: ${pctLabel(valor)}`;
    renderPricePreview();
  }catch(err){
    console.error('inflacion ajuste', err);
    chip.innerHTML = `<span class="pm-chip-dot"></span>No se pudo traer`;
    setTimeout(()=>{ chip.innerHTML = restore; }, 1800);
  }
}

async function aplicarAjusteMasivo(){
  if(priceAdjust.busy) return;
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); return; }
  const mag = Math.abs(Number(String(document.getElementById('pmPct').value).replace(',', '.')) || 0);
  if(mag === 0){ showToast(priceAdjust.dir === 1 ? 'Poné un porcentaje para aumentar' : 'Poné un porcentaje para bajar'); return; }
  const pct = priceAdjust.dir * mag;   // firmado: + sube, - baja
  const items = productosEnAlcance();
  if(items.length === 0){ showToast('No hay productos para ajustar'); return; }
  const factor = 1 + pct / 100;
  if(factor <= 0){ showToast('No podés bajar 100% o más'); return; }

  // Guardamos el precio anterior de cada producto antes de tocarlo, para poder
  // deshacer el ajuste completo si el comerciante se equivocó con el %.
  const cambios = items.map(p => ({ id: p.id, anterior: Number(p.precio_venta), nuevo: roundPrice(Number(p.precio_venta) * factor, priceAdjust.round, priceAdjust.dir) }));
  // No escribir precios en $0 o menos (puede pasar con un redondeo grande sobre
  // un precio chico): se avisa y no se toca nada.
  if(cambios.some(c => c.nuevo <= 0)){ showToast('Con ese ajuste algún precio quedaría en $0. Probá con menos % o sin redondear.'); return; }

  const applyBtn = document.getElementById('pmApply');
  priceAdjust.busy = true;
  applyBtn.classList.add('pm-apply-busy');
  applyBtn.textContent = 'Aplicando…';
  const okItems = [];
  let fail = 0;
  await Promise.all(cambios.map(async c => {
    try{
      const { error } = await sb.from('products').update({ precio_venta: c.nuevo }).eq('id', c.id).eq('user_id', currentUserId);
      if(error){ fail++; console.error(error); return; }
      const p = products.find(x => String(x.id) === String(c.id));
      if(p) p.precio_venta = c.nuevo;
      okItems.push({ id: c.id, anterior: c.anterior });
    }catch(e){ fail++; console.error(e); }
  }));
  const ok = okItems.length;

  if(ok > 0) savePriceUndo({ uid: currentUserId, items: okItems, pct, ts: Date.now() });
  priceAdjust.busy = false;
  applyBtn.classList.remove('pm-apply-busy');
  applyBtn.textContent = 'Aplicar';
  renderCatalog();
  if(typeof fillProductSelectOptions === 'function') fillProductSelectOptions();
  closePriceAdjust();
  if(fail === 0) showToast(ok === 1 ? '1 precio actualizado' : `${ok} precios actualizados`);
  else showToast(`${ok} ok, ${fail} fallaron — revisá tu conexión`);
}

// --- Deshacer el último ajuste masivo de precios ---
// Se guarda un único nivel de undo (el último ajuste) por cuenta, con vencimiento
// a las 24 h para no ofrecer revertir algo viejo que ya no tiene sentido.
const PRICE_UNDO_KEY = 'tikera_price_undo';
const PRICE_UNDO_TTL = 24 * 60 * 60 * 1000;
function loadPriceUndo(){
  try{
    const snap = JSON.parse(localStorage.getItem(PRICE_UNDO_KEY) || 'null');
    if(!snap || snap.uid !== currentUserId) return null;
    if(!Array.isArray(snap.items) || snap.items.length === 0) return null;
    if(Date.now() - (snap.ts || 0) > PRICE_UNDO_TTL) return null;
    return snap;
  }catch(e){ return null; }
}
function savePriceUndo(snap){ try{ localStorage.setItem(PRICE_UNDO_KEY, JSON.stringify(snap)); }catch(e){} }
function clearPriceUndo(){ try{ localStorage.removeItem(PRICE_UNDO_KEY); }catch(e){} }

function renderPriceUndoBar(){
  const bar = document.getElementById('priceUndoBar');
  if(!bar) return;
  const snap = loadPriceUndo();
  if(!snap){ bar.style.display = 'none'; return; }
  const txt = document.getElementById('priceUndoText');
  const n = snap.items.length;
  const signo = snap.pct >= 0 ? '+' : '';
  if(txt) txt.textContent = `Ajustaste ${n} ${n === 1 ? 'precio' : 'precios'} (${signo}${pctLabel(snap.pct)}). ¿Te equivocaste?`;
  bar.style.display = 'flex';
}

async function deshacerAjustePrecios(){
  const snap = loadPriceUndo();
  if(!snap) return;
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); return; }
  const btn = document.getElementById('priceUndoBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Deshaciendo…'; }
  let ok = 0, fail = 0;
  const okIds = new Set();
  await Promise.all(snap.items.map(async it => {
    try{
      const { error } = await sb.from('products').update({ precio_venta: it.anterior }).eq('id', it.id).eq('user_id', currentUserId);
      if(error){ fail++; console.error(error); return; }
      const p = products.find(x => String(x.id) === String(it.id));
      if(p) p.precio_venta = it.anterior;
      okIds.add(String(it.id)); ok++;
    }catch(e){ fail++; console.error(e); }
  }));
  if(fail === 0){
    clearPriceUndo();
  }else{
    // Conservar en el undo solo los que NO se pudieron restaurar, así la barra
    // sigue y el comerciante puede reintentar esos sin perder el resto.
    savePriceUndo({ uid: snap.uid, items: snap.items.filter(it => !okIds.has(String(it.id))), pct: snap.pct, ts: snap.ts });
  }
  if(btn){ btn.disabled = false; btn.textContent = 'Deshacer'; }
  renderCatalog();
  if(typeof fillProductSelectOptions === 'function') fillProductSelectOptions();
  showToast(fail === 0 ? 'Ajuste deshecho' : `${ok} restaurados, ${fail} fallaron`);
}

(function wirePriceAdjust(){
  const btn = document.getElementById('priceAdjustBtn');
  if(btn) btn.addEventListener('click', openPriceAdjust);
  const cancel = document.getElementById('pmCancel');
  if(cancel) cancel.addEventListener('click', closePriceAdjust);
  const apply = document.getElementById('pmApply');
  if(apply) apply.addEventListener('click', aplicarAjusteMasivo);
  const overlay = document.getElementById('priceAdjustModal');
  if(overlay) overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closePriceAdjust(); });
  const undoBtn = document.getElementById('priceUndoBtn');
  if(undoBtn) undoBtn.addEventListener('click', deshacerAjustePrecios);
  const undoDismiss = document.getElementById('priceUndoDismiss');
  if(undoDismiss) undoDismiss.addEventListener('click', ()=>{ clearPriceUndo(); renderPriceUndoBar(); });
  const pctInput = document.getElementById('pmPct');
  if(pctInput) pctInput.addEventListener('input', ()=>{
    document.querySelectorAll('#pmPctChips .pm-chip').forEach(c => c.classList.remove('active'));
    renderPricePreview();
  });
  document.querySelectorAll('#pmPctChips .pm-chip[data-pct]').forEach(chip => {
    chip.addEventListener('click', ()=>{
      document.getElementById('pmPct').value = chip.dataset.pct;
      document.querySelectorAll('#pmPctChips .pm-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderPricePreview();
    });
  });
  const inflaChip = document.getElementById('pmChipInfla');
  if(inflaChip) inflaChip.addEventListener('click', fillInflacionEnAjuste);
  document.querySelectorAll('#pmRoundChips .pm-chip').forEach(chip => {
    chip.addEventListener('click', ()=>{
      priceAdjust.round = chip.dataset.round;   // string: '0'|'10'|'50'|'100'|'end90'|'end99'
      document.querySelectorAll('#pmRoundChips .pm-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderPricePreview();
    });
  });
  document.querySelectorAll('#pmDir .pm-dir-btn').forEach(btn => {
    btn.addEventListener('click', ()=> setPriceDir(Number(btn.dataset.dir)));
  });
  const scope = document.getElementById('pmScope');
  if(scope) scope.addEventListener('change', ()=>{ priceAdjust.scope = scope.value; renderPricePreview(); });
})();
