// ============================================
// Módulo Variantes (rubro ropa/calzado): talle/color con stock por combinación.
// Desacoplado del form de producto para no tocar el flujo del catálogo: cada
// producto tiene un botón "Variantes" (solo si el módulo está activo) que abre
// este modal. Script clásico en el scope global de app.js: usa sus globals
// (productoVariantes, products, sb, currentUserId, escapeHtml, showToast,
// renderCatalog). RLS garantiza el aislamiento (ver supabase/019).
// ============================================
let varProductoId = null;

function variantesDeProducto(productId){
  return productoVariantes.filter(v => String(v.product_id) === String(productId));
}
function stockVariantes(productId){
  return variantesDeProducto(productId).reduce((s, v) => s + (Number(v.stock_actual) || 0), 0);
}
function varianteLabel(v){
  const partes = [v.talle, v.color].map(x => (x || '').trim()).filter(Boolean);
  return partes.join(' · ') || 'Variante';
}

function openVariantes(productId){
  const modal = document.getElementById('variantesModal');
  if(!modal) return;
  varProductoId = productId;
  const p = products.find(x => String(x.id) === String(productId));
  const titulo = document.getElementById('varTitulo');
  const sub = document.getElementById('varSub');
  if(titulo) titulo.textContent = 'Variantes';
  if(sub) sub.textContent = p ? p.nombre : '';
  ['varTalle', 'varColor', 'varStock'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  renderVariantesModal();
  modal.style.display = 'flex';
}
function closeVariantes(){
  const modal = document.getElementById('variantesModal');
  if(modal) modal.style.display = 'none';
  varProductoId = null;
  renderCatalog(); // refrescar el stock total en la lista
}

function renderVariantesModal(){
  const list = document.getElementById('varList');
  if(!list) return;
  const vars = variantesDeProducto(varProductoId).sort((a, b) => varianteLabel(a).localeCompare(varianteLabel(b), 'es'));
  if(vars.length === 0){
    list.innerHTML = `<div class="var-empty">Todavía no cargaste talles/colores. Agregá el primero abajo.</div>`;
    return;
  }
  const total = stockVariantes(varProductoId);
  list.innerHTML = vars.map(v => `
    <div class="var-row">
      <span class="var-name">${escapeHtml(varianteLabel(v))}</span>
      <input type="text" class="var-stock-input" data-id="${v.id}" value="${Number(v.stock_actual) || 0}" inputmode="numeric" aria-label="Stock de ${escapeHtml(varianteLabel(v))}">
      <button type="button" class="ti-del var-del" data-id="${v.id}" aria-label="Borrar variante">&times;</button>
    </div>`).join('') + `<div class="var-total">Stock total: <b>${total}</b></div>`;
}

async function addVariante(){
  if(!varProductoId) return;
  const talle = document.getElementById('varTalle').value.trim();
  const color = document.getElementById('varColor').value.trim();
  const stock = parseFloat(document.getElementById('varStock').value) || 0;
  if(!talle && !color){ showToast('Poné al menos el talle o el color'); return; }
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); return; }
  try{
    const row = { user_id: currentUserId, product_id: varProductoId, talle: talle || null, color: color || null, stock_actual: stock };
    const { data, error } = await sb.from('producto_variantes').insert(row).select().single();
    if(error){ console.error(error); showToast('No se pudo agregar la variante'); return; }
    if(data) productoVariantes.push(data);
    ['varTalle', 'varColor', 'varStock'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('varTalle').focus();
    renderVariantesModal();
  }catch(e){ console.error(e); showToast('No se pudo agregar la variante'); }
}

async function updateVarianteStock(id, stock){
  const v = productoVariantes.find(x => String(x.id) === String(id));
  if(!v) return;
  const nuevo = parseFloat(stock);
  if(isNaN(nuevo) || nuevo < 0){ renderVariantesModal(); return; }
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); renderVariantesModal(); return; }
  try{
    const { error } = await sb.from('producto_variantes').update({ stock_actual: nuevo }).eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo guardar el stock'); renderVariantesModal(); return; }
    v.stock_actual = nuevo;
    renderVariantesModal();
  }catch(e){ console.error(e); showToast('No se pudo guardar el stock'); }
}

async function deleteVariante(id){
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); return; }
  try{
    const { error } = await sb.from('producto_variantes').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo borrar'); return; }
    productoVariantes = productoVariantes.filter(x => String(x.id) !== String(id));
    renderVariantesModal();
  }catch(e){ console.error(e); showToast('No se pudo borrar'); }
}

(function wireVariantes(){
  const add = document.getElementById('varAddBtn'); if(add) add.addEventListener('click', addVariante);
  const close = document.getElementById('varClose'); if(close) close.addEventListener('click', closeVariantes);
  const overlay = document.getElementById('variantesModal'); if(overlay) overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeVariantes(); });
  const list = document.getElementById('varList');
  if(list){
    list.addEventListener('change', (e)=>{ const inp = e.target.closest('.var-stock-input'); if(inp) updateVarianteStock(inp.dataset.id, inp.value); });
    list.addEventListener('click', (e)=>{ const del = e.target.closest('.var-del'); if(del) deleteVariante(del.dataset.id); });
  }
  const stockInp = document.getElementById('varStock');
  if(stockInp) stockInp.addEventListener('keydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addVariante(); } });
})();
