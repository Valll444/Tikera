// ============================================
// Indicadores económicos y feriados (capa de "Noticias")
// Extraído de app.js como primer paso de una modularización gradual sin build
// step: es una capacidad autocontenida (sólo hace fetch a APIs públicas y
// pinta en contenedores propios de la vista Noticias). Sigue siendo un script
// clásico cargado en el mismo scope global que app.js, así que usa sus helpers
// (fmtMoney, fmtFecha, escapeHtml, todayStr, showToast) sin importarlos y los
// onclick inline del HTML siguen funcionando igual. Lo llama switchView() en
// app.js cuando se abre la sección Noticias.
// Fuentes: dolarapi.com (dólar) y api.argentinadatos.com (inflación, feriados).
// ============================================

// Cotizacion del dolar (dolarapi.com, publica y sin API key) como referencia
// para poner precios de mercaderia importada -- si falla (sin internet,
// servicio caido), se muestra un aviso en vez de romper el resto de la vista.
async function fetchDolar(){
  const hero = document.getElementById('dolarBlueHero');
  const content = document.getElementById('dolarContent');
  const updated = document.getElementById('dolarUpdated');
  if(!hero || !content) return;
  try{
    const res = await fetch('https://dolarapi.com/v1/dolares');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const blue = data.find(d => d.casa === 'blue');
    const oficial = data.find(d => d.casa === 'oficial');
    if(!blue) throw new Error('sin datos de blue');

    const brecha = oficial ? ((blue.venta - oficial.venta) / oficial.venta * 100) : null;
    hero.innerHTML = `
      <div class="dolar-blue-value">${fmtMoney(blue.venta)}</div>
      <div class="dolar-blue-sub">Compra ${fmtMoney(blue.compra)} · Venta ${fmtMoney(blue.venta)}</div>
      ${brecha !== null ? `<div class="dolar-blue-brecha">${brecha >= 0 ? '↑' : '↓'} ${Math.abs(brecha).toFixed(1)}% ${brecha >= 0 ? 'más caro' : 'más barato'} que el oficial</div>` : ''}
    `;
    if(updated) updated.textContent = 'Actualizado ' + new Date(blue.fechaActualizacion).toLocaleTimeString('es-AR', {hour:'2-digit', minute:'2-digit'});

    const otrasCasas = ['oficial','mayorista','tarjeta'];
    const filas = otrasCasas.map(c => data.find(d => d.casa === c)).filter(Boolean);
    content.innerHTML = filas.length ? `
      <div class="dolar-grid">
        ${filas.map(d => `
          <div class="dolar-tile">
            <div class="dolar-tile-label">${d.nombre}</div>
            <div class="dolar-tile-value">${fmtMoney(d.venta)}</div>
            <div class="dolar-tile-sub">Compra ${fmtMoney(d.compra)}</div>
          </div>
        `).join('')}
      </div>
      <div style="font-size:11px;color:var(--ink-soft);margin-top:10px;">Fuente: dolarapi.com</div>
    ` : '';
  }catch(err){
    console.error(err);
    hero.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);margin-top:14px;">No se pudo cargar la cotización. Revisá tu conexión.</div>`;
    content.innerHTML = '';
    if(updated) updated.textContent = '';
  }
}

// Ultimo dato de inflacion mensual publicado por el INDEC (ArgentinaDatos,
// API publica sin key). Le importa a un comerciante porque le dice si le
// conviene ajustar precios pronto, no solo mirar el dolar.
// Tres indicadores en una sola grilla (inflacion, riesgo pais, tasa
// promedio de plazo fijo) en vez de una tarjeta por dato -- cada fuente se
// pide por separado y si una falla, las otras dos igual se muestran.
async function fetchInflacion(){
  const content = document.getElementById('inflacionContent');
  if(!content) return;

  async function tileInflacion(){
    const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/inflacion');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if(!Array.isArray(data) || data.length === 0) throw new Error('sin datos');
    const ultimo = data[data.length - 1];
    const anterior = data[data.length - 2];
    const [y, m] = ultimo.fecha.split('-');
    const mesLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString('es-AR', {month:'short', year:'numeric'});
    const dif = anterior ? (ultimo.valor - anterior.valor) : null;
    return {
      label: `Inflación · ${mesLabel}`,
      value: ultimo.valor.toFixed(1).replace('.', ',') + '%',
      sub: dif !== null ? `${dif >= 0 ? '↑' : '↓'} ${Math.abs(dif).toFixed(1)} pts vs. mes anterior` : ''
    };
  }

  async function tileRiesgoPais(){
    const res = await fetch('https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if(!Array.isArray(data) || data.length === 0) throw new Error('sin datos');
    const ultimo = data[data.length - 1];
    return { label: 'Riesgo país', value: Math.round(ultimo.valor) + ' pb', sub: fmtFecha(ultimo.fecha) };
  }

  async function tilePlazoFijo(){
    const res = await fetch('https://api.argentinadatos.com/v1/finanzas/tasas/plazoFijo');
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if(!Array.isArray(data) || data.length === 0) throw new Error('sin datos');
    const tasas = data.map(b => Number(b.tnaClientes)).filter(t => t > 0);
    if(tasas.length === 0) throw new Error('sin tasas');
    const promedio = tasas.reduce((s, t) => s + t, 0) / tasas.length;
    return { label: 'Plazo fijo (TNA prom.)', value: (promedio * 100).toFixed(1).replace('.', ',') + '%', sub: `${tasas.length} bancos` };
  }

  const resultados = await Promise.allSettled([tileInflacion(), tileRiesgoPais(), tilePlazoFijo()]);
  const errores = ['Inflación', 'Riesgo país', 'Plazo fijo'];
  const tiles = resultados.map((r, i) => {
    if(r.status === 'fulfilled') return r.value;
    console.error(errores[i], r.reason);
    return { label: errores[i], value: '—', sub: 'No se pudo cargar' };
  });

  content.innerHTML = `
    <div class="dolar-grid">
      ${tiles.map(t => `
        <div class="dolar-tile">
          <div class="dolar-tile-label">${t.label}</div>
          <div class="dolar-tile-value" style="font-size:19px;">${t.value}</div>
          ${t.sub ? `<div class="dolar-tile-sub">${t.sub}</div>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

// Proximo feriado (nacional o puente) desde hoy -- si ya paso el ultimo
// del año en curso, busca el primero del año siguiente.
async function fetchFeriados(){
  const content = document.getElementById('feriadoContent');
  if(!content) return;
  try{
    const hoy = todayStr();
    const anio = Number(hoy.slice(0, 4));
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${anio}`);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if(!Array.isArray(data)) throw new Error('sin datos');
    let proximo = data.find(f => f.fecha >= hoy);
    if(!proximo){
      const resNext = await fetch(`https://api.argentinadatos.com/v1/feriados/${anio + 1}`);
      const dataNext = resNext.ok ? await resNext.json() : [];
      proximo = Array.isArray(dataNext) && dataNext.length ? dataNext[0] : null;
    }
    if(!proximo) throw new Error('sin feriados');
    const dias = Math.round((new Date(proximo.fecha) - new Date(hoy)) / 86400000);
    const diasLabel = dias === 0 ? 'es hoy' : dias === 1 ? 'falta 1 día' : `faltan ${dias} días`;
    content.innerHTML = `
      <div class="dolar-blue-value" style="font-size:24px;color:var(--ink);margin:2px 0 3px;">${escapeHtml(proximo.nombre)}</div>
      <div class="dolar-blue-sub">${fmtFecha(proximo.fecha)} · ${diasLabel}</div>
    `;
  }catch(err){
    console.error(err);
    content.innerHTML = `<div style="font-size:12.5px;color:var(--ink-soft);">No se pudo cargar el calendario de feriados.</div>`;
  }
}
