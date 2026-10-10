// ============================================
// Módulo Equipos (rubro celulares/electrónica): inventario por UNIDAD.
// Cada equipo es una fila con su IMEI/serie, estado, costo, precio y garantía.
// Script clásico en el mismo scope global que app.js: usa sus globals (equipos,
// sb, currentUserId, escapeHtml, fmtMoney, fmtFecha, showToast) sin importarlos.
// switchView('equipos') en app.js llama openEquiposView(). Es solo lectura/escritura
// de la cuenta propia: el aislamiento lo garantiza RLS (ver supabase/018_equipos.sql).
// ============================================
const EQ_ESTADOS = {
  disponible: { label: 'Disponible',    color: 'var(--venta)',       bg: 'var(--venta-bg)' },
  reservado:  { label: 'Reservado',     color: 'var(--gold-dark)',   bg: 'var(--gold-bg)' },
  vendido:    { label: 'Vendido',       color: 'var(--accent-dark)', bg: 'var(--accent-bg)' },
  reparacion: { label: 'En reparación', color: 'var(--gasto)',       bg: 'var(--gasto-bg)' },
};
const EQ_ESTADO_ORDEN = ['disponible', 'reservado', 'reparacion', 'vendido'];
let eqFiltroEstado = 'todos';

function equipoTitulo(e){
  return [e.marca, e.modelo, e.capacidad, e.color].map(x => (x || '').trim()).filter(Boolean).join(' ') || 'Equipo sin nombre';
}
function equipoMargen(e){
  const precio = Number(e.precio) || 0, costo = Number(e.costo) || 0;
  if(!(precio > 0) || !(costo > 0)) return null;
  const monto = precio - costo;
  return { monto, pct: monto / precio * 100 };
}

function openEquiposView(){
  editingEquipoId = null;
  const form = document.getElementById('equipoForm');
  if(form) form.style.display = 'none';
  renderEquiposFiltros();
  renderEquipos();
}

function renderEquiposFiltros(){
  const wrap = document.getElementById('eqFiltros');
  if(!wrap) return;
  const conteo = { todos: equipos.length };
  EQ_ESTADO_ORDEN.forEach(est => conteo[est] = equipos.filter(e => (e.estado || 'disponible') === est).length);
  const chip = (key, label) => `<button type="button" class="eq-chip${eqFiltroEstado === key ? ' active' : ''}" data-estado="${key}">${label} <span class="eq-chip-n">${conteo[key] || 0}</span></button>`;
  wrap.innerHTML = chip('todos', 'Todos') + EQ_ESTADO_ORDEN.map(est => chip(est, EQ_ESTADOS[est].label)).join('');
}

function renderEquipos(){
  const list = document.getElementById('equiposList');
  const empty = document.getElementById('equiposEmpty');
  if(!list) return;
  if(equipos.length === 0){
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  const items = equipos.filter(e => eqFiltroEstado === 'todos' || (e.estado || 'disponible') === eqFiltroEstado);
  if(items.length === 0){
    list.innerHTML = `<div class="restock-empty">No tenés equipos en ese estado.</div>`;
    return;
  }
  list.innerHTML = items.map(e => {
    const est = EQ_ESTADOS[e.estado] || EQ_ESTADOS.disponible;
    const m = equipoMargen(e);
    const sub = [];
    if(e.imei) sub.push(`IMEI ${escapeHtml(String(e.imei))}`);
    if(e.garantia_hasta) sub.push(`Garantía ${fmtFecha(e.garantia_hasta)}`);
    if(e.cliente && (e.estado === 'reservado' || e.estado === 'vendido')) sub.push(escapeHtml(e.cliente));
    const precioTxt = Number(e.precio) > 0 ? fmtMoney(e.precio) : 'sin precio';
    const margenTxt = m ? ` · <span style="color:var(--venta);">margen ${fmtMoney(m.monto)} (${Math.round(m.pct)}%)</span>` : '';
    const opciones = EQ_ESTADO_ORDEN.map(s => `<option value="${s}"${(e.estado || 'disponible') === s ? ' selected' : ''}>${EQ_ESTADOS[s].label}</option>`).join('');
    return `
      <div class="ticket-item eq-item">
        <div class="ti-left">
          <div class="ti-desc"><span class="eq-badge" style="color:${est.color};background:${est.bg};">${est.label}</span>${escapeHtml(equipoTitulo(e))}</div>
          <div class="ti-meta">${precioTxt}${margenTxt}${sub.length ? ' · ' + sub.join(' · ') : ''}</div>
        </div>
        <div class="ti-right eq-right">
          <select class="eq-estado-quick" data-id="${e.id}" aria-label="Cambiar estado">${opciones}</select>
          <button class="ti-del" aria-label="Editar" onclick="editEquipo('${e.id}')">&#9998;</button>
          <button class="ti-del" aria-label="Eliminar" onclick="deleteEquipo('${e.id}')">&times;</button>
        </div>
      </div>`;
  }).join('');
}

function newEquipo(){
  editingEquipoId = null;
  ['eqMarca','eqModelo','eqCapacidad','eqColor','eqImei','eqCosto','eqPrecio','eqGarantia','eqAccesorios','eqCliente','eqNotas'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  document.getElementById('eqEstado').value = 'disponible';
  document.getElementById('eqErrorMsg').textContent = '';
  document.getElementById('eqMasWrap').style.display = 'none';
  document.getElementById('eqSubmitBtn').textContent = 'Guardar equipo';
  document.getElementById('equipoForm').style.display = 'block';
  document.getElementById('eqMarca').focus();
}

function editEquipo(id){
  const e = equipos.find(x => String(x.id) === String(id));
  if(!e) return;
  editingEquipoId = e.id;
  document.getElementById('eqMarca').value = e.marca || '';
  document.getElementById('eqModelo').value = e.modelo || '';
  document.getElementById('eqCapacidad').value = e.capacidad || '';
  document.getElementById('eqColor').value = e.color || '';
  document.getElementById('eqImei').value = e.imei || '';
  document.getElementById('eqEstado').value = e.estado || 'disponible';
  document.getElementById('eqCosto').value = e.costo ?? '';
  document.getElementById('eqPrecio').value = e.precio ?? '';
  document.getElementById('eqGarantia').value = e.garantia_hasta || '';
  document.getElementById('eqAccesorios').value = e.accesorios || '';
  document.getElementById('eqCliente').value = e.cliente || '';
  document.getElementById('eqNotas').value = e.notas || '';
  const hayExtra = e.garantia_hasta || e.accesorios || e.cliente || e.notas;
  document.getElementById('eqMasWrap').style.display = hayExtra ? 'block' : 'none';
  document.getElementById('eqErrorMsg').textContent = '';
  document.getElementById('eqSubmitBtn').textContent = 'Guardar cambios';
  document.getElementById('equipoForm').style.display = 'block';
  document.getElementById('equipoForm').scrollIntoView({ block: 'nearest' });
}

function cancelEquipo(){
  document.getElementById('equipoForm').style.display = 'none';
  editingEquipoId = null;
}

function equipoDesdeForm(){
  const num = (id) => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
  const txt = (id) => { const v = document.getElementById(id).value.trim(); return v || null; };
  return {
    marca: txt('eqMarca'), modelo: txt('eqModelo'), capacidad: txt('eqCapacidad'), color: txt('eqColor'),
    imei: txt('eqImei'), estado: document.getElementById('eqEstado').value,
    costo: num('eqCosto'), precio: num('eqPrecio'),
    garantia_hasta: document.getElementById('eqGarantia').value || null,
    accesorios: txt('eqAccesorios'), cliente: txt('eqCliente'), notas: txt('eqNotas'),
  };
}

async function saveEquipo(){
  const msg = document.getElementById('eqErrorMsg');
  const fields = equipoDesdeForm();
  if(!fields.marca && !fields.modelo){ msg.textContent = 'Poné al menos la marca o el modelo.'; return; }
  if(!navigator.onLine){ msg.textContent = 'Sin conexión — probá cuando tengas señal.'; return; }
  const btn = document.getElementById('eqSubmitBtn');
  btn.disabled = true;
  try{
    if(editingEquipoId){
      fields.updated_at = new Date().toISOString();
      if(fields.estado === 'vendido'){ const e = equipos.find(x => String(x.id) === String(editingEquipoId)); if(e && e.estado !== 'vendido') fields.vendido_at = new Date().toISOString(); }
      const { data, error } = await sb.from('equipos').update(fields).eq('id', editingEquipoId).eq('user_id', currentUserId).select().single();
      if(error){ console.error(error); msg.textContent = 'No se pudo guardar.'; btn.disabled = false; return; }
      const idx = equipos.findIndex(x => String(x.id) === String(editingEquipoId));
      if(idx !== -1 && data) equipos[idx] = data;
      showToast('Equipo actualizado');
    }else{
      const row = { user_id: currentUserId, ...fields };
      if(fields.estado === 'vendido') row.vendido_at = new Date().toISOString();
      const { data, error } = await sb.from('equipos').insert(row).select().single();
      if(error){ console.error(error); msg.textContent = 'No se pudo guardar.'; btn.disabled = false; return; }
      if(data) equipos.unshift(data);
      showToast('Equipo agregado');
    }
  }catch(e){ console.error(e); msg.textContent = 'No se pudo guardar — revisá tu conexión.'; btn.disabled = false; return; }
  btn.disabled = false;
  editingEquipoId = null;
  document.getElementById('equipoForm').style.display = 'none';
  renderEquiposFiltros();
  renderEquipos();
}

async function deleteEquipo(id){
  const e = equipos.find(x => String(x.id) === String(id));
  if(!e) return;
  if(!confirm(`¿Borrar "${equipoTitulo(e)}" del inventario? No se puede recuperar.`)) return;
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); return; }
  try{
    const { error } = await sb.from('equipos').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo borrar'); return; }
    equipos = equipos.filter(x => String(x.id) !== String(id));
    renderEquiposFiltros();
    renderEquipos();
    showToast('Equipo borrado');
  }catch(err){ console.error(err); showToast('No se pudo borrar'); }
}

async function cambiarEstadoEquipo(id, estado){
  const e = equipos.find(x => String(x.id) === String(id));
  if(!e || e.estado === estado) return;
  if(!navigator.onLine){ showToast('Sin conexión — probá cuando tengas señal'); renderEquipos(); return; }
  const payload = { estado, updated_at: new Date().toISOString() };
  if(estado === 'vendido' && !e.vendido_at) payload.vendido_at = new Date().toISOString();
  try{
    const { data, error } = await sb.from('equipos').update(payload).eq('id', id).eq('user_id', currentUserId).select().single();
    if(error){ console.error(error); showToast('No se pudo cambiar el estado'); renderEquipos(); return; }
    const idx = equipos.findIndex(x => String(x.id) === String(id));
    if(idx !== -1 && data) equipos[idx] = data;
    renderEquiposFiltros();
    renderEquipos();
    showToast(`Marcado como ${(EQ_ESTADOS[estado] || {}).label || estado}`);
  }catch(err){ console.error(err); showToast('No se pudo cambiar el estado'); renderEquipos(); }
}

(function wireEquipos(){
  const nuevo = document.getElementById('newEquipoBtn'); if(nuevo) nuevo.addEventListener('click', newEquipo);
  const cancel = document.getElementById('eqCancelBtn'); if(cancel) cancel.addEventListener('click', cancelEquipo);
  const submit = document.getElementById('eqSubmitBtn'); if(submit) submit.addEventListener('click', saveEquipo);
  const mas = document.getElementById('eqMasBtn'); if(mas) mas.addEventListener('click', ()=>{ const w = document.getElementById('eqMasWrap'); w.style.display = w.style.display === 'none' ? 'block' : 'none'; });
  const filtros = document.getElementById('eqFiltros'); if(filtros) filtros.addEventListener('click', (ev)=>{ const c = ev.target.closest('.eq-chip'); if(!c) return; eqFiltroEstado = c.dataset.estado; renderEquiposFiltros(); renderEquipos(); });
  const list = document.getElementById('equiposList'); if(list) list.addEventListener('change', (ev)=>{ const sel = ev.target.closest('.eq-estado-quick'); if(sel) cambiarEstadoEquipo(sel.dataset.id, sel.value); });
})();
