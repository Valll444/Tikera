// ============================================
// Stock y reposición (paso 3 de la modularización gradual)
// Extraído de app.js como script clásico en el mismo scope global: rueda de
// "Estado del stock", badge de faltantes en el nav, predicción de reposición
// por velocidad de venta y la "lista para comprar" (predicción + bajo mínimo)
// con copiar / WhatsApp. Es solo lectura (no escribe en Supabase).
// Usa globals de app.js (products, entries, escapeHtml, fmtFecha, todayStr,
// showToast) sin importarlos; a su vez app.js (render/applyStockDelta) y Tiki
// (calcularReposicion / ventaDiariaDe) lo llaman de vuelta por el scope global.
// No migramos a módulos ES6 a propósito: ver docs y memoria del proyecto.
// ============================================

// Rueda de stock: cuantos productos del catalogo estan en o por debajo del
// minimo configurado, con la lista de cuales son -- vive junto al formulario
// de carga porque ahi es cuando el kiosquero mas se beneficia de verlo (esta
// mirando la pantalla igual, no tiene que ir a buscarlo al Catalogo aparte).
// Badge de faltantes en el ícono de Catálogo del nav: cuenta los productos en
// stock crítico (mínimo configurado y stock actual por debajo), el mismo
// criterio que "Estado del stock". Se ve desde cualquier sección; si no hay
// faltantes, se esconde. Se actualiza cada vez que corre renderStockWheel().
function renderStockNavBadge(){
  const badge = document.getElementById('catalogoNavBadge');
  if(!badge) return;
  const count = products.filter(p =>
    p.stock_minimo !== null && p.stock_minimo !== undefined && p.stock_minimo !== '' &&
    (Number(p.stock_actual) || 0) <= Number(p.stock_minimo)
  ).length;
  const btn = document.getElementById('navBtnCatalogo');
  if(count > 0){
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.hidden = false;
    if(btn) btn.setAttribute('aria-label', `Catálogo — ${count} ${count === 1 ? 'producto en stock crítico' : 'productos en stock crítico'}`);
  }else{
    badge.hidden = true;
    if(btn) btn.setAttribute('aria-label', 'Catálogo');
  }
}

function renderStockWheel(){
  renderStockNavBadge();
  const wrap = document.getElementById('stockWheelBody');
  if(!wrap) return;
  if(products.length === 0){
    wrap.innerHTML = `<div class="stock-wheel-empty">Todavía no cargaste productos en el catálogo.</div>`;
    return;
  }
  const tracked = products.filter(p => p.stock_minimo !== null && p.stock_minimo !== undefined && p.stock_minimo !== '');
  if(tracked.length === 0){
    wrap.innerHTML = `<div class="stock-wheel-empty">Ningún producto tiene un stock mínimo configurado todavía. Agregalo en Catálogo para activar esta alerta.</div>`;
    return;
  }
  const low = tracked
    .filter(p => (Number(p.stock_actual)||0) <= Number(p.stock_minimo))
    .sort((a,b)=>(Number(a.stock_actual)||0)-(Number(b.stock_actual)||0));

  const total = tracked.length;
  const lowCount = low.length;
  const circumference = 2 * Math.PI * 42;
  const arcLen = lowCount === 0 ? circumference : (lowCount/total) * circumference;
  const color = lowCount === 0 ? 'var(--venta)' : 'var(--gasto)';

  const listHtml = lowCount === 0
    ? `<div class="stock-wheel-ok"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Todo tu stock está en buen nivel.</div>`
    : low.slice(0,4).map(p => `
        <div class="stock-wheel-row">
          <span class="stock-wheel-name">${escapeHtml(p.nombre)}</span>
          <span class="stock-wheel-qty">${Number(p.stock_actual)||0} / ${Number(p.stock_minimo)}</span>
        </div>
      `).join('') + (lowCount > 4 ? `<div class="stock-wheel-more">+${lowCount-4} más</div>` : '');

  wrap.innerHTML = `
    <div class="stock-wheel-wrap">
      <div class="stock-wheel-center">
        <svg width="96" height="96" viewBox="0 0 96 96">
          <circle cx="48" cy="48" r="42" fill="none" stroke="var(--line)" stroke-width="11"/>
          <circle cx="48" cy="48" r="42" fill="none" stroke="${color}" stroke-width="11"
            stroke-dasharray="${arcLen} ${circumference}" stroke-linecap="round"
            transform="rotate(-90 48 48)"/>
        </svg>
        <div class="stock-wheel-count">
          <span class="num">${lowCount}</span>
          <span class="cap">${lowCount===1?'producto bajo':'productos bajos'}</span>
        </div>
      </div>
      <div class="stock-wheel-list">${listHtml}</div>
    </div>
  `;
}

// Reposicion sugerida: a diferencia de "Estado del stock" (que solo mira si
// ya estas por debajo de un minimo que vos configuraste a mano), esto calcula
// la velocidad de venta real de cada producto de los ultimos 14 dias y avisa
// ANTES de que se agote, aunque nunca hayas puesto un stock minimo -- es la
// diferencia entre un umbral fijo y una prediccion basada en la tendencia.
// Matchea por nombre igual que "Productos que mas facturan" (las ventas no
// guardan el id del producto, solo la descripcion) asi que solo cuenta ventas
// hechas eligiendo el producto del catalogo o escaneando su codigo.
// La cuenta vive aparte del render porque Tiki usa exactamente la misma
// (asi la tarjeta y el asistente nunca dicen cosas distintas).
// Ventana = los ultimos 14 dias de calendario, hoy incluido. Antes se
// comparaba new Date(e.fecha) (medianoche UTC = 21 hs del dia anterior en
// Argentina) contra "ahora menos 14 dias", y entraban 13 o 14 dias segun la
// hora en que se mirara, pero siempre se dividia por 14.
const RESTOCK_WINDOW_DAYS = 14;
function fechaHaceDias(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function ventaDiariaDe(p){
  const nameKey = (p.nombre || '').trim().toLowerCase();
  if(!nameKey) return 0;
  const desde = fechaHaceDias(RESTOCK_WINDOW_DAYS - 1);
  const hasta = todayStr();
  const vendido = entries
    .filter(e => e.tipo === 'Venta' && e.fecha && e.fecha >= desde && e.fecha <= hasta && (e.descripcion || '').trim().toLowerCase() === nameKey)
    .reduce((s,e) => s + (Number(e.cantidad) || 0), 0);
  return vendido / RESTOCK_WINDOW_DAYS;
}
function calcularReposicion(){
  return products.map(p => {
    const dailyRate = ventaDiariaDe(p);
    if(dailyRate <= 0) return null;
    const stock = Number(p.stock_actual) || 0;
    const daysLeft = stock / dailyRate;
    if(daysLeft > 10) return null;
    const suggestedQty = Math.max(1, Math.ceil(dailyRate * RESTOCK_WINDOW_DAYS - stock));
    return { nombre: p.nombre, daysLeft, suggestedQty };
  }).filter(Boolean).sort((a,b) => a.daysLeft - b.daysLeft);
}

function renderRestockPrediction(){
  const wrap = document.getElementById('restockBody');
  if(!wrap) return;
  const listBtn = document.getElementById('restockListBtn');
  // El botón de "armar lista para comprar" aparece si hay ALGO que comprar
  // (algo que se agota por venta, o algo bajo el mínimo), aunque la predicción
  // por velocidad esté vacía. La tarjeta en sí sigue mostrando la predicción.
  const toggleListBtn = () => { if(listBtn) listBtn.style.display = calcularListaCompras().length > 0 ? 'flex' : 'none'; };
  if(products.length === 0){
    wrap.innerHTML = `<div class="restock-empty">Todavía no cargaste productos en el catálogo.</div>`;
    if(listBtn) listBtn.style.display = 'none';
    return;
  }
  const predictions = calcularReposicion();

  if(predictions.length === 0){
    wrap.innerHTML = `<div class="restock-empty">Con las ventas de las últimas dos semanas, ningún producto se está por quedar sin stock pronto.</div>`;
    toggleListBtn();
    return;
  }

  wrap.innerHTML = predictions.slice(0,5).map(p => {
    const urgencyClass = p.daysLeft <= 2 ? 'urgent' : 'soon';
    const daysLabel = p.daysLeft < 1 ? 'Se agota hoy' : `~${Math.floor(p.daysLeft)} días`;
    return `
      <div class="restock-row">
        <span class="restock-name">${escapeHtml(p.nombre)}</span>
        <span class="restock-days ${urgencyClass}">${daysLabel}</span>
        <span class="restock-qty">Reponer ${p.suggestedQty}</span>
      </div>
    `;
  }).join('');
  toggleListBtn();
}

// ============================================
// Lista de reposición para el proveedor
// La lista COMPLETA de lo que hay que comprar, accionable (copiar o mandar al
// proveedor por WhatsApp). Combina dos fuentes con el motivo de cada ítem bien
// claro, para que no falte nada ni confunda:
//   - "se agota en ~N días": lo que predice la tarjeta "Reposición sugerida"
//     por velocidad de venta (calcularReposicion).
//   - "bajo el mínimo (X/Y)": productos por debajo del mínimo configurado que
//     no entraron por velocidad (ej. sin ventas recientes) -- antes se perdían.
// ============================================
function calcularListaCompras(){
  const predicciones = calcularReposicion();
  const yaIncluidos = new Set(predicciones.map(p => (p.nombre || '').trim().toLowerCase()));
  const items = predicciones.map(p => ({ nombre: p.nombre, suggestedQty: p.suggestedQty, motivo: 'prediccion', daysLeft: p.daysLeft }));
  products.forEach(p => {
    const tieneMin = p.stock_minimo !== null && p.stock_minimo !== undefined && p.stock_minimo !== '';
    if(!tieneMin) return;
    const actual = Number(p.stock_actual) || 0;
    const min = Number(p.stock_minimo);
    if(actual > min) return;
    const key = (p.nombre || '').trim().toLowerCase();
    if(!key || yaIncluidos.has(key)) return;
    items.push({ nombre: p.nombre, suggestedQty: Math.max(1, Math.ceil(min - actual)), motivo: 'bajo-minimo', stockActual: actual, stockMinimo: min });
  });
  return items;
}

function textoFilaReposicion(item){
  let why;
  if(item.motivo === 'bajo-minimo'){
    why = `bajo el mínimo (${item.stockActual}/${item.stockMinimo})`;
  }else{
    why = item.daysLeft < 1 ? 'se agota hoy' : `se agota en ~${Math.floor(item.daysLeft)} ${Math.floor(item.daysLeft) === 1 ? 'día' : 'días'}`;
  }
  return { reponer: item.suggestedQty, why };
}

function buildRestockListText(items){
  const nombreNegocio = (document.getElementById('bizName') && document.getElementById('bizName').value.trim()) || 'Mi negocio';
  const lineas = items.map(p => `• ${p.nombre} — reponer ${p.suggestedQty}`);
  return `Lista de reposición — ${nombreNegocio} (${fmtFecha(todayStr())})\n\n${lineas.join('\n')}`;
}

function openRestockList(){
  const modal = document.getElementById('restockListModal');
  if(!modal) return;
  const items = calcularListaCompras();
  if(items.length === 0){ showToast('No hay nada para reponer por ahora'); return; }
  const sub = document.getElementById('rlSub');
  const nombreNegocio = (document.getElementById('bizName') && document.getElementById('bizName').value.trim()) || 'Mi negocio';
  if(sub) sub.textContent = `${nombreNegocio} · ${fmtFecha(todayStr())} · ${items.length} ${items.length === 1 ? 'producto' : 'productos'}`;
  const list = document.getElementById('rlList');
  if(list){
    list.innerHTML = items.map(item => {
      const f = textoFilaReposicion(item);
      return `<div class="rl-row">
        <span class="rl-rleft"><div class="rl-rname">${escapeHtml(item.nombre)}</div><div class="rl-rwhy">${f.why}</div></span>
        <span class="rl-rqty">Reponer ${f.reponer}</span>
      </div>`;
    }).join('');
  }
  modal.dataset.text = buildRestockListText(items);
  modal.style.display = 'flex';
}

function closeRestockList(){
  const modal = document.getElementById('restockListModal');
  if(modal) modal.style.display = 'none';
}

async function copyRestockList(){
  const modal = document.getElementById('restockListModal');
  const text = modal ? (modal.dataset.text || '') : '';
  if(!text) return;
  try{
    await navigator.clipboard.writeText(text);
    showToast('Lista copiada');
  }catch(e){
    // Fallback para navegadores/contextos sin clipboard API
    try{
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Lista copiada');
    }catch(err){ console.error(err); showToast('No se pudo copiar'); }
  }
}

function shareRestockWhatsApp(){
  const modal = document.getElementById('restockListModal');
  const text = modal ? (modal.dataset.text || '') : '';
  if(!text) return;
  window.open('https://api.whatsapp.com/send?text=' + encodeURIComponent(text), '_blank');
}

(function wireRestockList(){
  const btn = document.getElementById('restockListBtn');
  if(btn) btn.addEventListener('click', openRestockList);
  const close = document.getElementById('rlClose');
  if(close) close.addEventListener('click', closeRestockList);
  const copy = document.getElementById('rlCopy');
  if(copy) copy.addEventListener('click', copyRestockList);
  const wa = document.getElementById('rlWhatsapp');
  if(wa) wa.addEventListener('click', shareRestockWhatsApp);
  const overlay = document.getElementById('restockListModal');
  if(overlay) overlay.addEventListener('click', (e)=>{ if(e.target === overlay) closeRestockList(); });
})();
