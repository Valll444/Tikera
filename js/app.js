(function(){
  var KEY = 'tikera_cookie_consent';
  var banner = document.getElementById('cookieBanner');
  if(!banner) return;
  var saved;
  try{ saved = localStorage.getItem(KEY); }catch(e){ saved = null; }
  if(saved === 'accepted' || saved === 'rejected') return;
  banner.classList.add('show');
  function decide(value){
    try{ localStorage.setItem(KEY, value); }catch(e){}
    banner.classList.remove('show');
  }
  document.getElementById('cookieAccept').addEventListener('click', function(){ decide('accepted'); });
  document.getElementById('cookieReject').addEventListener('click', function(){ decide('rejected'); });
})();

let entries = [];
let currentTipo = 'Venta';
let editingId = null;
let editingHora = null;
let frequentProducts = [];
let frequentExpenses = [];
let summaryScope = 'hoy';
let products = [];
let editingProductId = null;
let selectedProductId = null;
let proveedores = [];
let pedidosProveedor = [];
let equipos = [];            // módulo Equipos (celulares): inventario por unidad
let editingEquipoId = null;
let productoVariantes = [];  // módulo Variantes (ropa): talle/color/stock por producto
let editingProveedorId = null;
let openProveedorId = null;
let catalogoTab = 'productos';
let cierresCaja = [];
// Config del comercio (rubro + módulos habilitados). Arranca vacía = "config
// legacy" => todos los módulos opcionales se muestran (así los usuarios que ya
// usaban Tikera no pierden nada hasta que elijan su rubro). Ver RUBROS/MODULOS
// y moduloActivo() más abajo, y supabase/017_perfil_rubro_modulos.sql.
let comercioConfig = { rubros: [], modulos: {}, onboardingAt: null };
// Perfil del comercio que arma el onboarding (antigüedad, volumen de ventas,
// forma de cobro habitual). Vive en profiles.perfil (jsonb, migración 021);
// tolerante a que la migración no esté corrida (queda {}).
let perfilNegocio = {};
let facturacionConfig = null;
// La tabla facturacion_config revoca el SELECT * y otorga lectura columna por
// columna solo de las no-secretas (ver supabase/013_facturacion_arca.sql): el
// certificado, la clave privada y el ticket de WSAA nunca tienen que llegar al
// navegador. Por eso el cliente pide esta lista explícita y NO '*', que da 403
// (permission denied) al tocar las columnas prohibidas.
const FACTURACION_CONFIG_COLS = 'user_id, cuit, razon_social, punto_venta, tipo_comprobante_default, ambiente, activado, verificado_at, created_at, updated_at';
let facturas = [];
let selectedCategoria = null;

// ============================================
// Rubros y módulos (Tikera modular por rubro — Fase 0)
// Los módulos CORE van siempre (cargar venta/gasto, inicio, historial, Tiki,
// cuenta, ajustes). Los OPCIONALES se muestran según la config del comercio;
// cada rubro trae un set recomendado que el onboarding deja activado, y el
// usuario los prende/apaga después desde Ajustes. Es personalización de UX:
// el aislamiento entre cuentas lo sigue garantizando RLS.
// ============================================
const MODULOS_OPCIONALES = ['caja', 'catalogo', 'variantes', 'equipos', 'noticias', 'facturacion'];
// Metadata de cada módulo opcional: etiqueta y una línea de para qué sirve
// (se usa en Ajustes y en el onboarding). navBtn/view son los ids del nav y la
// vista que se muestran/ocultan.
const MODULOS = {
  caja:        { label: 'Cierre de caja',      desc: 'Arqueo diario: contás la caja y comparás con lo que registraste.', navBtn: 'navBtnCaja',        view: 'caja' },
  catalogo:    { label: 'Catálogo y stock',    desc: 'Cargá productos, precios y stock, con alertas de reposición.',     navBtn: 'navBtnCatalogo',    view: 'catalogo' },
  variantes:   { label: 'Variantes de talle/color', desc: 'Para ropa y calzado: cada producto puede tener talles y colores con su propio stock.', subDe: 'catalogo' },
  equipos:     { label: 'Equipos (por unidad)',desc: 'Inventario unidad por unidad: IMEI, estado, garantía y margen de cada equipo.', navBtn: 'navBtnEquipos', view: 'equipos' },
  noticias:    { label: 'Indicadores',         desc: 'Dólar, inflación y feriados, para ponerle contexto a tus precios.', navBtn: 'navBtnNoticias',    view: 'noticias' },
  facturacion: { label: 'Facturación',         desc: 'Emití comprobantes electrónicos AFIP/ARCA desde la venta.',        navBtn: 'navBtnFacturacion', view: 'facturacion' },
};
// Rubros ofrecidos (sin mayoristas/logística/supermercados a pedido del usuario)
// y el set de módulos opcionales que se recomienda a cada uno.
const RUBROS = {
  kiosco:      { label: 'Kiosco o almacén',            modulos: ['caja', 'catalogo', 'noticias'] },
  minorista:   { label: 'Comercio minorista',          modulos: ['caja', 'catalogo'] },
  celulares:   { label: 'Celulares y electrónica',     modulos: ['equipos'] },
  ropa:        { label: 'Ropa y calzado',              modulos: ['catalogo', 'variantes'] },
  ecommerce:   { label: 'Ecommerce / marketplaces',    modulos: ['catalogo'] },
  gastronomia: { label: 'Gastronomía',                 modulos: ['caja', 'catalogo'] },
  servicios:   { label: 'Negocio de servicios',        modulos: ['caja'] },
  otros:       { label: 'Otro rubro',                  modulos: ['caja', 'catalogo', 'noticias', 'facturacion'] },
};

// ¿Está activo un módulo para este comercio? Los core siempre; los opcionales
// según la config. Config vacía (usuarios previos al onboarding) = todo activo,
// para no sacarle funciones a nadie sin que lo pida.
function moduloActivo(key){
  if(!MODULOS_OPCIONALES.includes(key)) return true;
  const m = (comercioConfig && comercioConfig.modulos) || {};
  if(Object.keys(m).length === 0) return true; // legacy / sin configurar
  return m[key] === true;
}
// Lista de módulos opcionales recomendados para un conjunto de rubros (unión).
function modulosRecomendados(rubros){
  const set = new Set();
  (rubros || []).forEach(r => (RUBROS[r] ? RUBROS[r].modulos : []).forEach(m => set.add(m)));
  return [...set];
}
function rubroLabel(key){ return RUBROS[key] ? RUBROS[key].label : key; }
function onboardingPendiente(){ return !(comercioConfig && comercioConfig.onboardingAt); }

// El asistente de configuración (rubro + módulos) es SOLO para cuentas nuevas:
// aparece una vez, al crear la cuenta, y nunca más. No interrumpe a quien ya
// venía usando Tikera (tiene ventas/productos/equipos cargados) ni reaparece en
// cada login. Siempre se puede reconfigurar desde Ajustes → "Rubro y módulos".
function cuentaReciencreada(){
  const sinVentas = !(typeof entries !== 'undefined' && entries && entries.length);
  const sinProductos = !(typeof products !== 'undefined' && products && products.length);
  const sinEquipos = !(typeof equipos !== 'undefined' && equipos && equipos.length);
  return sinVentas && sinProductos && sinEquipos;
}
function onboardingDeviceKey(){ return 'tikera:onboarding-visto:' + (currentUserId || 'anon'); }
function onboardingVistoEnDispositivo(){ try{ return localStorage.getItem(onboardingDeviceKey()) === '1'; }catch(e){ return false; } }
function marcarOnboardingVistoEnDispositivo(){ try{ localStorage.setItem(onboardingDeviceKey(), '1'); }catch(e){} }

// --- Onboarding en pasos (asistente a pantalla completa) ---
// Arma el perfil del comercio la primera vez: nombre, rubro, módulos,
// antigüedad, volumen de ventas y forma de cobro, y cierra con una pantalla de
// valor. Absorbe el viejo flujo de 2 pasos. Se guarda en profiles
// (business_name + rubros/modulos/onboarding_at + perfil jsonb), tolerante a
// que falte la migración 021. Reeditable desde Ajustes.

// Íconos de línea de los pasos (badge de color, nunca emoji).
const WICO_VOL_1 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11h16V9"/><path d="M9 20v-6h6v6"/></svg>';
const WICO_VOL_2 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>';
const WICO_VOL_3 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M8 17v-5M13 17V8M18 17v-9"/></svg>';
const WICO_VOL_4 = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2c1 4 4 6 4 10a4 4 0 0 1-8 0c0-1 .5-2 1-2.5C9 11 9 13 10 14c.5-3 2-4 2-7z"/><path d="M8.5 22h7"/></svg>';
const WICO_CAJA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>';
const WICO_TIKI = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9.5v1M15 9.5v1"/><path d="M9.5 13.5c1.4.9 3.6.9 5 0"/></svg>';
const WICO_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/><path d="M12 15v2"/></svg>';

const ONB_ANTIGUEDAD = [
  { v: 'nuevo', label: 'Recién arranco',   desc: 'Estoy empezando con el negocio.' },
  { v: '<1',    label: 'Menos de 1 año',   desc: 'Hace poco que abrí.' },
  { v: '1-3',   label: 'Entre 1 y 3 años', desc: 'Ya tengo rodaje.' },
  { v: '+3',    label: 'Más de 3 años',    desc: 'Negocio establecido.' },
];
const ONB_VOLUMEN = [
  { v: '<20',    label: 'Hasta 20 por día', desc: 'Arrancando o local chico.', icon: WICO_VOL_1 },
  { v: '20-50',  label: 'Entre 20 y 50',    desc: 'Movimiento constante.',      icon: WICO_VOL_2 },
  { v: '50-150', label: 'Entre 50 y 150',   desc: 'Buen flujo todos los días.', icon: WICO_VOL_3 },
  { v: '+150',   label: 'Más de 150',       desc: 'Alto volumen.',              icon: WICO_VOL_4 },
];
const ONB_COBRO = [
  { v: 'efectivo', label: 'Casi todo efectivo',      desc: 'La mayoría me paga en mano.' },
  { v: 'digital',  label: 'Tarjeta o transferencia', desc: 'Casi todo es digital.' },
  { v: 'mixto',    label: 'Mitad y mitad',           desc: 'Un poco de cada uno.' },
];
// Orden de los pasos. Los 6 primeros son preguntas; 'final' es el cierre.
const ONB_PASOS = ['negocio', 'rubro', 'modulos', 'antiguedad', 'volumen', 'cobro', 'final'];
const ONB_PREGUNTAS = ONB_PASOS.length - 1;

const wizState = { i: 0, negocio: '', rubros: new Set(), modulos: {}, antiguedad: '', volumen: '', cobro: '' };

// Decide si el asistente debe abrirse solo. Se separa de maybeShowOnboarding
// para poder testear la decisión sin tocar el DOM.
function debeMostrarOnboarding(){
  if(!onboardingPendiente()) return false;         // ya quedó configurado (guardado en el perfil)
  if(onboardingVistoEnDispositivo()) return false; // ya se vio/omitió en este dispositivo
  return cuentaReciencreada();                      // solo cuentas nuevas, no las que ya tienen datos
}
function maybeShowOnboarding(){ if(debeMostrarOnboarding()) openOnboarding(); }

function openOnboarding(){
  const ov = document.getElementById('onboardingOverlay');
  if(!ov) return;
  const bn = document.getElementById('bizName');
  wizState.i = 0;
  wizState.negocio = (bn && bn.value && bn.value.trim() && bn.value.trim() !== 'Mi negocio') ? bn.value.trim() : '';
  wizState.rubros = new Set(comercioConfig.rubros || []);
  wizState.modulos = Object.assign({}, comercioConfig.modulos || {});
  const p = (typeof perfilNegocio !== 'undefined' && perfilNegocio) || {};
  wizState.antiguedad = p.antiguedad || '';
  wizState.volumen = p.volumen || '';
  wizState.cobro = p.cobro || '';
  ov.style.display = 'flex';
  document.body.classList.add('wiz-open');
  wizRender();
}
function closeOnboarding(){
  const ov = document.getElementById('onboardingOverlay');
  if(ov) ov.style.display = 'none';
  document.body.classList.remove('wiz-open');
}

function wizPuedeSeguir(){
  const paso = ONB_PASOS[wizState.i];
  if(paso === 'negocio') return (wizState.negocio || '').trim().length > 0;
  if(paso === 'rubro') return wizState.rubros.size > 0;
  return true; // módulos y los datos opcionales no bloquean el avance
}
function wizRefreshNext(){ const b = document.getElementById('wizNext'); if(b) b.disabled = !wizPuedeSeguir(); }

function wizRender(){
  const paso = ONB_PASOS[wizState.i];
  const stepper = document.getElementById('wizStepper');
  if(stepper) stepper.innerHTML = ONB_PASOS.map((_, idx) =>
    `<span class="wiz-seg${idx < wizState.i ? ' done' : ''}${idx === wizState.i ? ' now' : ''}"></span>`).join('');
  const lbl = document.getElementById('wizStepLabel');
  if(lbl) lbl.textContent = paso === 'final' ? '¡Listo!' : `Paso ${wizState.i + 1} de ${ONB_PREGUNTAS}`;
  const body = document.getElementById('wizBody');
  if(body) body.innerHTML = wizPasoHtml(paso);
  const back = document.getElementById('wizBack');
  if(back) back.style.visibility = wizState.i === 0 ? 'hidden' : 'visible';
  const next = document.getElementById('wizNext');
  if(next){ next.textContent = paso === 'final' ? 'Entrar a Tikera' : 'Continuar'; next.disabled = !wizPuedeSeguir(); }
  const main = document.querySelector('#onboardingOverlay .wiz-main');
  if(main) main.scrollTop = 0;
  if(paso === 'negocio'){ const inp = document.getElementById('wizNegocio'); if(inp) setTimeout(() => inp.focus(), 60); }
}

function wizHead(titulo, sub){
  return `<div class="wiz-head"><h2 class="wiz-title">${titulo}</h2>${sub ? `<p class="wiz-sub">${sub}</p>` : ''}</div>`;
}
function wizOpcionesHtml(campo, opts, conIcono){
  const sel = wizState[campo];
  return `<div class="wiz-opts">${opts.map(o => `
    <button type="button" class="wiz-opt${sel === o.v ? ' sel' : ''}" data-campo="${campo}" data-val="${o.v}">
      ${conIcono && o.icon ? `<span class="wiz-opt-ic">${o.icon}</span>` : '<span class="wiz-radio"></span>'}
      <span class="wiz-opt-txt"><strong>${escapeHtml(o.label)}</strong>${o.desc ? `<small>${escapeHtml(o.desc)}</small>` : ''}</span>
    </button>`).join('')}</div>`;
}
function wizPasoHtml(paso){
  const nombre = escapeHtml((wizState.negocio || '').trim());
  if(paso === 'negocio'){
    return wizHead('¿Cómo se llama tu negocio?', 'Así te saluda Tikera y aparece en tus tickets.')
      + `<div class="wiz-field"><label for="wizNegocio">Nombre del negocio</label>
         <input type="text" id="wizNegocio" class="wiz-input" maxlength="60" autocomplete="off" placeholder="Ej: Kiosco La Esquina" value="${escapeHtml(wizState.negocio || '')}"></div>`;
  }
  if(paso === 'rubro'){
    return wizHead(nombre ? `${nombre}, ¿qué vendés?` : '¿Qué vendés?', 'Elegí uno o más. Tikera se adapta a tu rubro — lo cambiás cuando quieras.')
      + `<div class="wiz-grid">${Object.keys(RUBROS).map(k => `
          <button type="button" class="wiz-chip${wizState.rubros.has(k) ? ' sel' : ''}" data-rubro="${k}">
            <span class="wiz-chk"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></span>
            <span>${escapeHtml(RUBROS[k].label)}</span>
          </button>`).join('')}</div>`;
  }
  if(paso === 'modulos'){
    const rec = modulosRecomendados([...wizState.rubros]);
    MODULOS_OPCIONALES.forEach(k => { if(wizState.modulos[k] === undefined) wizState.modulos[k] = rec.includes(k); });
    return wizHead('¿Qué querés que Tikera haga por vos?', 'Marcamos lo recomendado para tu rubro. Prendé o apagá lo que quieras.')
      + `<div class="wiz-mods">${MODULOS_OPCIONALES.map(k => {
          const on = wizState.modulos[k] === true;
          return `<div class="wiz-mod${on ? ' on' : ''}" data-mod="${k}">
            <span class="wiz-mod-txt"><strong>${escapeHtml(MODULOS[k].label)}</strong><small>${escapeHtml(MODULOS[k].desc)}</small></span>
            <span class="wiz-switch"></span></div>`;
        }).join('')}</div>`;
  }
  if(paso === 'antiguedad'){
    return wizHead(nombre ? `${nombre}, ¿hace cuánto arrancaste?` : '¿Hace cuánto tenés el negocio?', 'Para darte los consejos justos para tu momento.')
      + wizOpcionesHtml('antiguedad', ONB_ANTIGUEDAD, false);
  }
  if(paso === 'volumen'){
    return wizHead('¿Cuántas ventas hacés por día?', 'Más o menos — así calculamos bien tus metas y proyecciones.')
      + wizOpcionesHtml('volumen', ONB_VOLUMEN, true);
  }
  if(paso === 'cobro'){
    return wizHead('¿Cómo cobrás casi siempre?', 'Así Tikera te deja listo el método de pago al cargar una venta.')
      + wizOpcionesHtml('cobro', ONB_COBRO, false);
  }
  if(paso === 'final'){
    return `<div class="wiz-final">
      <span class="wiz-badge">Lo que te da Tikera</span>
      <h2 class="wiz-title wiz-title-xl">${nombre ? `Listo, ${nombre}.` : 'Todo listo.'} Así te cambia el día.</h2>
      <p class="wiz-sub">Menos cuentas en la cabeza. Más tiempo para vender.</p>
      <div class="wiz-cards">
        <div class="wiz-card">
          <div class="wiz-card-ic">${WICO_CAJA}</div>
          <div class="wiz-card-h">Cierre de caja</div>
          <div class="wiz-card-k">1 min</div>
          <p>Contás la plata y Tikera te dice al toque si cuadra o cuánto falta.</p>
        </div>
        <div class="wiz-card wiz-card-hi">
          <div class="wiz-card-ic">${WICO_TIKI}</div>
          <div class="wiz-card-h">Tu mano derecha</div>
          <div class="wiz-card-k">Tiki</div>
          <p>Te avisa qué reponer, cómo venís y qué conviene, en castellano claro.</p>
        </div>
        <div class="wiz-card">
          <div class="wiz-card-ic">${WICO_LOCK}</div>
          <div class="wiz-card-h">Tus datos</div>
          <div class="wiz-card-k">Solo tuyos</div>
          <p>Cada cuenta está aislada. Nadie más ve lo que vendés.</p>
        </div>
      </div>
      <p class="wiz-foot-note">Lo configurás a tu gusto y lo cambiás cuando quieras desde Ajustes.</p>
    </div>`;
  }
  return '';
}

function wizSiguiente(){
  if(!wizPuedeSeguir()) return;
  if(ONB_PASOS[wizState.i] === 'final'){ wizFinish(); return; }
  if(wizState.i < ONB_PASOS.length - 1){ wizState.i += 1; wizRender(); }
}
function wizAtras(){ if(wizState.i > 0){ wizState.i -= 1; wizRender(); } }
function wizFinish(){
  const modulos = {};
  MODULOS_OPCIONALES.forEach(k => modulos[k] = wizState.modulos[k] === true);
  const perfil = { antiguedad: wizState.antiguedad, volumen: wizState.volumen, cobro: wizState.cobro };
  guardarOnboarding([...wizState.rubros], modulos, { negocio: (wizState.negocio || '').trim(), perfil });
}
// Omitir: marca el onboarding como hecho con config legacy (todo activo), sin
// forzar nada ni sacarle funciones a nadie.
function wizOmitir(){ guardarOnboarding([], {}, null); }

async function guardarOnboarding(rubros, modulos, extras){
  const nombre = extras && extras.negocio ? extras.negocio : null;
  const perfil = extras && extras.perfil ? extras.perfil : null;
  const payload = { rubros, modulos, onboarding_at: new Date().toISOString() };
  if(nombre) payload.business_name = nombre;
  if(perfil) payload.perfil = perfil;
  comercioConfig = { rubros, modulos, onboardingAt: payload.onboarding_at };
  if(perfil) perfilNegocio = perfil;
  if(nombre){ const bn = document.getElementById('bizName'); if(bn) bn.value = nombre; }
  marcarOnboardingVistoEnDispositivo(); // no volver a mostrarlo en este dispositivo, aunque falle el sync
  aplicarModulosAlNav();
  closeOnboarding();
  switchView('inicio');
  try{
    let { error } = await sb.from('profiles').update(payload).eq('id', currentUserId);
    // Si falla por la columna perfil (migración 021 sin correr todavía),
    // reintenta sin ella para no perder el resto de la config.
    if(error && perfil && /perfil/i.test(error.message || '')){
      const sinPerfil = Object.assign({}, payload); delete sinPerfil.perfil;
      ({ error } = await sb.from('profiles').update(sinPerfil).eq('id', currentUserId));
    }
    if(error){ console.error(error); showToast('Guardado acá — no se pudo sincronizar'); return; }
    showToast('¡Listo! Tikera quedó configurada');
  }catch(e){ console.error(e); showToast('Guardado acá — revisá tu conexión'); }
}

(function wireOnboarding(){
  const ov = document.getElementById('onboardingOverlay');
  if(!ov) return;
  const body = document.getElementById('wizBody');
  if(body){
    body.addEventListener('click', (e) => {
      const chip = e.target.closest('.wiz-chip');
      if(chip){ const k = chip.dataset.rubro; if(wizState.rubros.has(k)) wizState.rubros.delete(k); else wizState.rubros.add(k); chip.classList.toggle('sel'); wizRefreshNext(); return; }
      const mod = e.target.closest('.wiz-mod');
      if(mod){ const k = mod.dataset.mod; wizState.modulos[k] = !(wizState.modulos[k] === true); mod.classList.toggle('on', wizState.modulos[k]); return; }
      const opt = e.target.closest('.wiz-opt');
      if(opt){ const campo = opt.dataset.campo; wizState[campo] = opt.dataset.val; body.querySelectorAll(`.wiz-opt[data-campo="${campo}"]`).forEach(o => o.classList.toggle('sel', o === opt)); return; }
    });
    body.addEventListener('input', (e) => { const inp = e.target.closest('#wizNegocio'); if(inp){ wizState.negocio = inp.value; wizRefreshNext(); } });
    body.addEventListener('keydown', (e) => { if(e.key === 'Enter' && e.target.closest('#wizNegocio')){ e.preventDefault(); wizSiguiente(); } });
  }
  const back = document.getElementById('wizBack'); if(back) back.addEventListener('click', wizAtras);
  const next = document.getElementById('wizNext'); if(next) next.addEventListener('click', wizSiguiente);
  const skip = document.getElementById('wizSkip'); if(skip) skip.addEventListener('click', wizOmitir);
})();

// Categorias fijas de gasto -- a proposito una lista chica y cerrada (no un
// campo libre ni una pantalla de "administrar categorias"): lo que importa
// aca es no perder velocidad de carga, no armar un sistema de categorias
// configurable.
const GASTO_CATEGORIAS = ['Mercadería', 'Alquiler', 'Servicios', 'Sueldos', 'Impuestos', 'Otro'];

// ============================================
// Plan y prueba gratuita.
// currentPlan: 'trial' | 'pago' | 'cortesia' -- viene de profiles.plan.
// Mientras no tengamos el link de pago real conectado, dejamos
// PAYMENT_LINK_URL vacio y la pantalla de bloqueo muestra el email
// de contacto en su lugar; el dia que exista el link, va solo acá.
// ============================================
const PAYMENT_LINK_URL = '';
let currentPlan = 'trial';
let currentTrialStartedAt = null;
const TRIAL_DAYS = 14;

function trialDiasRestantes(){
  if(!currentTrialStartedAt) return TRIAL_DAYS;
  const transcurridos = Math.floor((Date.now() - currentTrialStartedAt.getTime()) / 86400000);
  return TRIAL_DAYS - transcurridos;
}
function isTrialExpired(){
  if(currentPlan === 'pago' || currentPlan === 'cortesia') return false;
  return trialDiasRestantes() <= 0;
}

// ============================================
// Apariencia: color de acento, elegible desde Cuenta > Apariencia.
// Se persiste en localStorage y se aplica pisando las variables CSS
// del root -- no toca los colores semanticos (venta/gasto/dorado/turquesa).
// ============================================
const ACCENT_PRESETS = [
  { id: 'pizarra', label: 'Pizarra (por defecto)', accent: '#3E5670', dark: '#547096', bg: 'rgba(62,86,112,0.16)' },
  { id: 'acero',   label: 'Azul acero',            accent: '#5B7FA6', dark: '#7398BC', bg: 'rgba(91,127,166,0.16)' },
  { id: 'turquesa',label: 'Turquesa',              accent: '#3D8683', dark: '#4FA3A0', bg: 'rgba(79,163,160,0.16)' },
  { id: 'dorado',  label: 'Dorado',                accent: '#C08A3E', dark: '#D9A251', bg: 'rgba(217,162,81,0.16)' },
  { id: 'violeta', label: 'Violeta',                accent: '#6E63A6', dark: '#8B7EC8', bg: 'rgba(139,126,200,0.16)' },
  { id: 'coral',   label: 'Coral',                  accent: '#A66358', dark: '#C67E6E', bg: 'rgba(198,126,110,0.16)' },
  { id: 'oliva',   label: 'Oliva',                  accent: '#5C7A42', dark: '#7C9A68', bg: 'rgba(124,154,104,0.16)' }
];
const ACCENT_KEY = 'tikera_accent_color';
function applyAccentColor(id){
  const preset = ACCENT_PRESETS.find(p => p.id === id) || ACCENT_PRESETS[0];
  const root = document.documentElement.style;
  root.setProperty('--accent', preset.accent);
  root.setProperty('--accent-dark', preset.dark);
  root.setProperty('--accent-bg', preset.bg);
}
function getSavedAccentId(){
  try{ return localStorage.getItem(ACCENT_KEY) || 'pizarra'; }catch(e){ return 'pizarra'; }
}
applyAccentColor(getSavedAccentId());

// ============================================
// Tipografia del cuerpo (Cuenta > Apariencia). Los titulos (Space
// Grotesk) y los numeros (IBM Plex Mono) no cambian -- son parte de la
// identidad de Tikera, no algo que el usuario deberia poder romper.
// El color del texto siempre sale de --ink/--ink-soft, nunca de la
// tipografia, asi que cualquiera de estas opciones queda legible tanto
// en oscuro como en claro.
// ============================================
const FONT_PRESETS = [
  { id: 'inter', label: 'Inter (por defecto)', value: "'Inter',sans-serif" },
  { id: 'manrope', label: 'Manrope', value: "'Manrope',sans-serif" },
  { id: 'sistema', label: 'La del sistema', value: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif" }
];
const FONT_KEY = 'tikera_font_body';
function applyFontBody(id){
  const preset = FONT_PRESETS.find(p => p.id === id) || FONT_PRESETS[0];
  document.documentElement.style.setProperty('--font-body', preset.value);
}
function getSavedFontId(){
  try{ return localStorage.getItem(FONT_KEY) || 'inter'; }catch(e){ return 'inter'; }
}
applyFontBody(getSavedFontId());

// ============================================
// Tema oscuro/claro/sistema. "Oscuro" es como Tikera se ve siempre por
// defecto; "claro" pisa las mismas variables via [data-theme="light"]
// en <html> (ver el bloque de variables mas arriba); "sistema" resuelve
// contra prefers-color-scheme del SO y se actualiza solo si el usuario
// cambia el tema de Windows/Mac mientras la app sigue abierta.
const THEME_KEY = 'tikera_theme';
function getSavedThemePref(){
  try{ return localStorage.getItem(THEME_KEY) || 'oscuro'; }catch(e){ return 'oscuro'; }
}
function resolveTheme(pref){
  if(pref === 'claro') return 'light';
  if(pref === 'oscuro') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyThemePref(pref){
  const resolved = resolveTheme(pref);
  if(resolved === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
}
applyThemePref(getSavedThemePref());
try{
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', ()=>{
    if(getSavedThemePref() === 'sistema') applyThemePref('sistema');
  });
}catch(e){}

const todayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
};

function fmtMoney(n){
  return '$' + Number(n).toLocaleString('es-AR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

// Un color fijo por método de pago para que se distingan de un vistazo
// en el ticket, el historial y el desglose — no tiene significado más allá de eso.
function metodoColor(m){
  if(m === 'Efectivo') return 'var(--venta)';
  if(m === 'Tarjeta') return 'var(--accent-dark)';
  if(m === 'Transferencia') return 'var(--teal)';
  return 'var(--gold)';
}
function metodoDot(m){
  return `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${metodoColor(m)};margin-right:5px;flex-shrink:0;"></span>`;
}

function fmtFecha(iso){
  if(!iso || iso.length < 10) return iso || '';
  const [y,m,d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

let toastTimer = null;
// El punto se colorea segun el contenido del mensaje en vez de pedirle a
// cada uno de los ~25 lugares que llaman showToast() que declare un tipo:
// mas simple y a prueba de que alguien agregue un mensaje de error nuevo
// y se olvide de marcarlo.
function showToast(msg){
  const t = document.getElementById('toast');
  let dotColor = 'var(--venta)';
  if(/no se pud|no encontramos/i.test(msg)) dotColor = 'var(--gasto)';
  else if(/^sin conexión/i.test(msg)) dotColor = 'var(--gold)';
  t.innerHTML = `<span class="dot" style="background:${dotColor}"></span>${msg}`;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 1800);
}

// ============================================
// Conexión a Supabase
// ============================================
const SUPABASE_URL = 'https://pkayskmfmmvvowwfdmsp.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Wlvy5Nf8srhmhXqoePTpEg_8CQgMUkA';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let gateMode = 'login'; // 'login' | 'signup'

function setGateMode(mode){
  gateMode = mode;
  document.getElementById('btnModeLogin').className = 'type-btn' + (mode==='login' ? ' active-accent' : '');
  document.getElementById('btnModeSignup').className = 'type-btn' + (mode==='signup' ? ' active-accent' : '');
  document.getElementById('signupNameField').style.display = mode==='signup' ? 'block' : 'none';
  document.getElementById('gateTitle').textContent = mode==='login' ? 'Iniciá sesión' : 'Creá tu cuenta';
  document.getElementById('gateDesc').textContent = mode==='login' ? 'Entrá con tu cuenta para ver tus movimientos.' : 'Registrá tu comercio para empezar a usar Tikera.';
  document.getElementById('gateBtnText').textContent = mode==='login' ? 'Ingresar' : 'Crear cuenta';
  document.getElementById('loginSub').style.display = mode==='login' ? 'none' : 'block';
  document.getElementById('gateError').textContent = '';
  // new-password ayuda a que el gestor de contraseñas sugiera una fuerte al crear cuenta
  document.getElementById('gateCode').setAttribute('autocomplete', mode==='signup' ? 'new-password' : 'current-password');
}
document.getElementById('btnModeLogin').addEventListener('click', ()=>setGateMode('login'));
document.getElementById('btnModeSignup').addEventListener('click', ()=>setGateMode('signup'));

// ============================================
// Recuperar contraseña (link por email)
// ============================================
function showForgotForm(){
  document.getElementById('gateModeToggle').style.display = 'none';
  document.getElementById('gateForm').style.display = 'none';
  document.getElementById('resetForm').style.display = 'none';
  document.getElementById('forgotForm').style.display = 'block';
  document.getElementById('gateTitle').textContent = 'Recuperar contraseña';
  document.getElementById('gateDesc').textContent = 'Te mandamos un link a tu email para que puedas poner una contraseña nueva.';
  document.getElementById('gateNote').style.display = 'none';
  document.getElementById('forgotEmail').value = document.getElementById('gateEmail').value;
  document.getElementById('forgotError').textContent = '';
  document.getElementById('forgotEmail').focus();
}

function showLoginForm(){
  document.getElementById('gateModeToggle').style.display = 'flex';
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('resetForm').style.display = 'none';
  document.getElementById('gateForm').style.display = 'block';
  document.getElementById('gateNote').style.display = 'block';
  setGateMode('login');
}

document.getElementById('forgotPassLink').addEventListener('click', (e)=>{ e.preventDefault(); showForgotForm(); });
document.getElementById('backToLoginLink').addEventListener('click', (e)=>{ e.preventDefault(); showLoginForm(); });

let forgotSubmitting = false;
document.getElementById('forgotBtn').addEventListener('click', async ()=>{
  if(forgotSubmitting) return;
  const email = document.getElementById('forgotEmail').value.trim();
  const errEl = document.getElementById('forgotError');
  if(!email || !email.includes('@')){
    errEl.textContent = 'Ingresá un email válido.';
    return;
  }
  forgotSubmitting = true;
  errEl.textContent = '';
  document.getElementById('forgotBtnText').textContent = 'Enviando...';
  document.getElementById('forgotSpinner').style.display = 'inline-block';
  document.getElementById('forgotBtn').disabled = true;

  try{
    const redirectTo = window.location.href.split('#')[0].split('?')[0];
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) throw error;
    document.getElementById('forgotForm').innerHTML = `
      <div style="text-align:center;padding:12px 0;">
        <p style="font-size:14px;color:var(--ink);margin-bottom:4px;">Listo, revisá tu email 📩</p>
        <p style="font-size:12.5px;color:var(--ink-soft);">Te mandamos un link a <strong>${escapeHtml(email)}</strong> para que pongas una contraseña nueva. Si no lo ves, revisá spam.</p>
      </div>
      <p style="text-align:center;margin-top:14px;">
        <a href="#" id="backToLoginLink2" style="font-size:12.5px;color:var(--ink-soft);">Volver a iniciar sesión</a>
      </p>
    `;
    document.getElementById('backToLoginLink2').addEventListener('click', (e)=>{ e.preventDefault(); showLoginForm(); location.reload(); });
  }catch(err){
    errEl.textContent = 'No se pudo enviar el link. Verificá el email e intentá de nuevo.';
    forgotSubmitting = false;
    document.getElementById('forgotBtnText').textContent = 'Enviar link de recuperación';
    document.getElementById('forgotSpinner').style.display = 'none';
    document.getElementById('forgotBtn').disabled = false;
  }
});

// Cuando alguien vuelve del link del email, Supabase dispara este evento
sb.auth.onAuthStateChange((event, session)=>{
  if(event === 'PASSWORD_RECOVERY'){
    document.getElementById('gate').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('gateModeToggle').style.display = 'none';
    document.getElementById('gateForm').style.display = 'none';
    document.getElementById('forgotForm').style.display = 'none';
    document.getElementById('resetForm').style.display = 'block';
    document.getElementById('gateTitle').textContent = 'Poné tu contraseña nueva';
    document.getElementById('gateDesc').textContent = 'Ya verificamos tu email, ahora elegí una contraseña nueva.';
    document.getElementById('gateNote').style.display = 'none';
  }
});

let resetSubmitting = false;
document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(resetSubmitting) return;
  const p1 = document.getElementById('resetPass1').value;
  const p2 = document.getElementById('resetPass2').value;
  const errEl = document.getElementById('resetError');

  if(!p1 || p1.length < 8){
    errEl.textContent = 'La contraseña tiene que tener al menos 8 caracteres.';
    return;
  }
  if(p1 !== p2){
    errEl.textContent = 'Las dos contraseñas no coinciden.';
    return;
  }

  resetSubmitting = true;
  errEl.textContent = '';
  document.getElementById('resetBtnText').textContent = 'Guardando...';
  document.getElementById('resetSpinner').style.display = 'inline-block';
  document.getElementById('resetBtn').disabled = true;

  try{
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    showToast('Contraseña actualizada');
    await loadData();
    document.getElementById('gateNote').style.display = 'block';
    revealApp();
  }catch(err){
    errEl.textContent = traducirErrorAuth(err.message);
    resetSubmitting = false;
    document.getElementById('resetBtnText').textContent = 'Guardar contraseña nueva';
    document.getElementById('resetSpinner').style.display = 'none';
    document.getElementById('resetBtn').disabled = false;
  }
});

// mostrar / ocultar contraseña
document.getElementById('toggleCodeBtn').addEventListener('click', ()=>{
  const input = document.getElementById('gateCode');
  const btn = document.getElementById('toggleCodeBtn');
  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
  btn.innerHTML = showing
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C5 20 1 12 1 12a21.3 21.3 0 0 1 5.06-6.06M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 8 11 8a21.3 21.3 0 0 1-3.22 4.35M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
});

let gateSubmitting = false;

document.getElementById('gateBtn').addEventListener('click', handleAuthSubmit);
['gateEmail','gateCode','gateBizName'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); handleAuthSubmit(); }
  });
});

async function handleAuthSubmit(){
  if(gateSubmitting) return;

  const email = document.getElementById('gateEmail').value.trim();
  const password = document.getElementById('gateCode').value;
  const bizName = document.getElementById('gateBizName').value.trim();
  const gateError = document.getElementById('gateError');
  const gateCard = document.getElementById('gateCard');

  function showError(msg){
    gateError.textContent = msg;
    gateCard.classList.remove('shake');
    void gateCard.offsetWidth;
    gateCard.classList.add('shake');
  }

  if(!email || !email.includes('@')){
    showError('Ingresá un email válido.');
    return;
  }
  if(!password || password.length < 8){
    showError('La contraseña tiene que tener al menos 8 caracteres.');
    return;
  }
  if(gateMode === 'signup' && !bizName){
    showError('Ingresá el nombre de tu comercio.');
    return;
  }

  gateSubmitting = true;
  gateError.textContent = '';
  document.getElementById('gateBtnText').textContent = gateMode==='login' ? 'Ingresando...' : 'Creando cuenta...';
  document.getElementById('gateSpinner').style.display = 'inline-block';
  document.getElementById('gateBtn').disabled = true;

  try{
    let skipReveal = false;
    if(gateMode === 'signup'){
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { business_name: bizName } }
      });
      if(error) throw error;
      // Si el proyecto de Supabase exige confirmar el email, signUp no devuelve sesión:
      // no hay que "entrar" a la app todavía, hay que avisarle al usuario.
      if(!data.session){
        showToast('Te enviamos un email para confirmar tu cuenta');
        setGateMode('login');
        document.getElementById('gateEmail').value = email;
        document.getElementById('gateCode').value = '';
        skipReveal = true;
      }
    }else{
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if(error) throw error;
    }
    if(!skipReveal){
      await loadData();
      revealApp();
    }
  }catch(err){
    showError(traducirErrorAuth(err.message));
  }finally{
    gateSubmitting = false;
    document.getElementById('gateBtnText').textContent = gateMode==='login' ? 'Ingresar' : 'Crear cuenta';
    document.getElementById('gateSpinner').style.display = 'none';
    document.getElementById('gateBtn').disabled = false;
  }
}

function traducirErrorAuth(msg){
  if(!msg) return 'Ocurrió un error. Probá de nuevo.';
  if(msg.includes('Invalid login credentials')) return 'Email o contraseña incorrectos.';
  if(msg.includes('User already registered')) return 'Ese email ya tiene una cuenta — probá iniciar sesión.';
  if(msg.includes('Password should be at least')) return 'La contraseña es muy corta (mínimo 8 caracteres).';
  if(msg.includes('Unable to validate email')) return 'Ese email no es válido.';
  return msg;
}

// Muestra u oculta los botones del nav de los módulos OPCIONALES según la config
// del comercio. Los core no se tocan (siempre visibles).
function aplicarModulosAlNav(){
  MODULOS_OPCIONALES.forEach(key => {
    if(!MODULOS[key].navBtn) return; // módulos sin sección propia (ej. variantes, sub-feature del catálogo)
    const btn = document.getElementById(MODULOS[key].navBtn);
    if(btn) btn.style.display = moduloActivo(key) ? '' : 'none';
  });
  aplicarModulosAlDashboard();
}

// Adapta el dashboard (Inicio y pantalla de carga) al rubro: las tarjetas de
// productos genéricos (estado del stock, reposición, productos que más facturan)
// son de catálogo — si el comercio no usa catálogo (ej. un vendedor de celulares
// que trabaja por unidad), no se muestran. En su lugar, si usa Equipos, aparece
// el resumen de equipos.
function aplicarModulosAlDashboard(){
  const catOn = moduloActivo('catalogo');
  ['cardEstadoStock', 'cardReposicion', 'cardTopProductos'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.style.display = catOn ? '' : 'none';
  });
  const eqCard = document.getElementById('cardEquiposResumen');
  if(eqCard){
    const eqOn = moduloActivo('equipos');
    eqCard.style.display = eqOn ? '' : 'none';
    if(eqOn && typeof renderEquiposResumen === 'function') renderEquiposResumen();
  }
  renderNotificaciones();
}

// --- Notificaciones de nav: un puntito en una sección cuando hay algo nuevo
// que revisar desde la última vez que entraste. Se limpia al entrar (guarda la
// "firma" del estado visto en localStorage, por cuenta). ---
const NOTIF_SIGNATURE = {
  // Equipos: avisa si hay reservados o en reparación (pendientes de seguir).
  equipos: () => {
    if(typeof equipos === 'undefined' || !Array.isArray(equipos)) return '';
    const res = equipos.filter(e => e.estado === 'reservado').length;
    const rep = equipos.filter(e => e.estado === 'reparacion').length;
    return (res + rep) > 0 ? `r${res}x${rep}` : '';
  },
};
const NOTIF_DOT = { equipos: 'equiposNavDot' };
function notifSeenKey(section){ return `tikera_notif_${section}_${currentUserId || 'anon'}`; }
function renderNotificaciones(){
  Object.keys(NOTIF_SIGNATURE).forEach(section => {
    const dot = document.getElementById(NOTIF_DOT[section]);
    if(!dot) return;
    const sig = NOTIF_SIGNATURE[section]();
    let seen = ''; try{ seen = localStorage.getItem(notifSeenKey(section)) || ''; }catch(e){}
    // Mostrar si el módulo está activo, hay pendientes, y cambió desde la última visita.
    dot.hidden = !(moduloActivo(section) && sig !== '' && sig !== seen);
  });
}
function marcarNotifVisto(section){
  if(!NOTIF_SIGNATURE[section]) return;
  try{ localStorage.setItem(notifSeenKey(section), NOTIF_SIGNATURE[section]()); }catch(e){}
  const dot = document.getElementById(NOTIF_DOT[section]);
  if(dot) dot.hidden = true;
}

function switchView(view){
  // Si la vista es de un módulo opcional apagado, no entrar: caer a Inicio.
  // Es defensa de UX (igual cada uno solo accede a sus propios datos por RLS).
  const modKey = Object.keys(MODULOS).find(k => MODULOS[k].view === view);
  if(modKey && !moduloActivo(modKey)) view = 'inicio';
  document.getElementById('viewCargar').style.display = view==='cargar' ? 'block' : 'none';
  document.getElementById('viewInicio').style.display = view==='inicio' ? 'block' : 'none';
  document.getElementById('viewTiki').style.display = view==='tiki' ? 'block' : 'none';
  document.getElementById('viewHistorial').style.display = view==='historial' ? 'block' : 'none';
  document.getElementById('viewCatalogo').style.display = view==='catalogo' ? 'block' : 'none';
  document.getElementById('viewEquipos').style.display = view==='equipos' ? 'block' : 'none';
  document.getElementById('viewCaja').style.display = view==='caja' ? 'block' : 'none';
  document.getElementById('viewNoticias').style.display = view==='noticias' ? 'block' : 'none';
  document.getElementById('viewFacturacion').style.display = view==='facturacion' ? 'block' : 'none';
  document.getElementById('viewCuenta').style.display = view==='cuenta' ? 'block' : 'none';
  document.getElementById('viewAjustes').style.display = view==='ajustes' ? 'block' : 'none';
  document.getElementById('navBtnCargar').classList.toggle('active', view==='cargar');
  document.getElementById('navBtnInicio').classList.toggle('active', view==='inicio');
  document.getElementById('navBtnTiki').classList.toggle('active', view==='tiki');
  document.getElementById('navBtnHistorial').classList.toggle('active', view==='historial');
  document.getElementById('navBtnCatalogo').classList.toggle('active', view==='catalogo');
  document.getElementById('navBtnEquipos').classList.toggle('active', view==='equipos');
  document.getElementById('navBtnCaja').classList.toggle('active', view==='caja');
  document.getElementById('navBtnNoticias').classList.toggle('active', view==='noticias');
  document.getElementById('navBtnFacturacion').classList.toggle('active', view==='facturacion');
  document.getElementById('navBtnCuenta').classList.toggle('active', view==='cuenta');
  document.getElementById('navBtnConfig').classList.toggle('active', view==='ajustes');
  if(view==='catalogo'){ renderCatalog(); if(catalogoTab === 'proveedores') renderProveedores(); }
  if(view==='equipos'){ openEquiposView(); marcarNotifVisto('equipos'); }
  if(view==='inicio' && typeof renderEquiposResumen === 'function' && moduloActivo('equipos')) renderEquiposResumen();
  if(view==='caja') openCajaView();
  if(view==='tiki') openTikiView();
  if(view==='noticias'){ fetchDolar(); fetchInflacion(); fetchFeriados(); }
  if(view==='facturacion') openFacturacionView();
  if(view==='cuenta') loadPerfilView();
  if(view==='ajustes') loadAjustesView();
  window.scrollTo({top:0, behavior:'instant'});

  const viewIds = {cargar:'viewCargar', inicio:'viewInicio', tiki:'viewTiki', historial:'viewHistorial', catalogo:'viewCatalogo', equipos:'viewEquipos', caja:'viewCaja', noticias:'viewNoticias', facturacion:'viewFacturacion', cuenta:'viewCuenta', ajustes:'viewAjustes'};
  const activeEl = document.getElementById(viewIds[view]);
  if(activeEl){
    activeEl.classList.remove('view-fade-in');
    void activeEl.offsetWidth;
    activeEl.classList.add('view-fade-in');
  }
}

function showTrialBlocked(){
  const gate = document.getElementById('gate');
  const blocked = document.getElementById('trialBlocked');
  gate.classList.add('leaving');
  setTimeout(()=>{
    gate.style.display = 'none';
    gate.classList.remove('leaving');
    if(PAYMENT_LINK_URL){
      document.getElementById('trialBlockedPayBtn').href = PAYMENT_LINK_URL;
      document.getElementById('trialBlockedPayBtn').style.display = 'block';
      document.getElementById('trialBlockedContact').style.display = 'none';
    }else{
      document.getElementById('trialBlockedPayBtn').style.display = 'none';
      document.getElementById('trialBlockedContact').style.display = 'block';
    }
    blocked.classList.add('show');
  }, 180);
}
document.getElementById('trialBlockedRefresh').addEventListener('click', async (e)=>{
  e.preventDefault();
  await loadData();
  if(isTrialExpired()){
    showToast('Todavía no se activó el pago.');
  }else{
    document.getElementById('trialBlocked').classList.remove('show');
    revealApp();
  }
});
document.getElementById('trialBlockedLogout').addEventListener('click', ()=>{
  document.getElementById('switchBizBtn').click();
});

function revealApp(){
  if(isTrialExpired()){ showTrialBlocked(); return; }
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  gate.classList.add('leaving');
  setTimeout(()=>{
    gate.style.display = 'none';
    gate.classList.remove('leaving');
    app.style.display = 'block';
    app.classList.add('entering');
    document.body.classList.add('app-active');
    setTimeout(()=> app.classList.remove('entering'), 350);
    document.getElementById('bottomNav').style.display = 'flex';
    switchView('inicio');
    maybeShowOnboarding();
  }, 180);
}

document.getElementById('switchBizBtn').addEventListener('click', async ()=>{
  const app = document.getElementById('app');
  const gate = document.getElementById('gate');
  app.classList.add('leaving-app');
  await sb.auth.signOut();
  setTimeout(()=>{
    clearUserState();
    closeProveedorModal();
    document.getElementById('gateError').textContent = '';
    document.getElementById('gateCode').value = '';
    document.getElementById('gateEmail').value = '';
    app.style.display = 'none';
    app.classList.remove('leaving-app');
    document.getElementById('trialBlocked').classList.remove('show');
    document.body.classList.remove('app-active');
    document.getElementById('bottomNav').style.display = 'none';
    gate.style.display = 'flex';
    gate.classList.add('entering');
    setTimeout(()=> gate.classList.remove('entering'), 350);
    setGateMode('login');
    document.getElementById('gateEmail').focus();
  }, 180);
});

// ============================================
// Vista Cuenta: perfil, email, contraseña, apariencia, plan, zona avanzada.
// Perfil/email/contraseña pegan de verdad contra Supabase Auth (ya esta
// conectado, no hace falta mockear nada ahi). El plan todavia es
// informativo -- se arma con la fecha real de alta de la cuenta mas la
// regla de 14 dias, pero no hay cobro conectado, asi que se aclara.
// ============================================
function renderColorSwatches(){
  const wrap = document.getElementById('colorSwatches');
  const current = getSavedAccentId();
  wrap.innerHTML = ACCENT_PRESETS.map(p => `
    <button type="button" class="color-swatch${p.id===current ? ' active' : ''}" style="background:${p.accent};" data-color="${p.id}" aria-label="${p.label}" title="${p.label}"></button>
  `).join('');
  wrap.querySelectorAll('.color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.color;
      applyAccentColor(id);
      try{ localStorage.setItem(ACCENT_KEY, id); }catch(e){}
      renderColorSwatches();
      showToast('Color actualizado');
    });
  });
}

function renderThemeToggle(){
  const current = getSavedThemePref();
  document.querySelectorAll('#themeToggle .type-btn').forEach(btn => {
    btn.classList.toggle('active-accent', btn.dataset.themeOpt === current);
  });
}
document.querySelectorAll('#themeToggle .type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const pref = btn.dataset.themeOpt;
    try{ localStorage.setItem(THEME_KEY, pref); }catch(e){}
    applyThemePref(pref);
    renderThemeToggle();
    showToast('Tema actualizado');
  });
});

function renderFontToggle(){
  const wrap = document.getElementById('fontToggle');
  const current = getSavedFontId();
  wrap.innerHTML = FONT_PRESETS.map(p => `
    <button type="button" class="type-btn${p.id===current ? ' active-accent' : ''}" style="font-family:${p.value};" data-font-opt="${p.id}">${p.label}</button>
  `).join('');
  wrap.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.fontOpt;
      applyFontBody(id);
      try{ localStorage.setItem(FONT_KEY, id); }catch(e){}
      renderFontToggle();
      showToast('Tipografía actualizada');
    });
  });
}

// Perfil = quién sos vos: correo, contraseña, plan, cerrar/eliminar cuenta.
async function loadPerfilView(){
  document.getElementById('settEmailMsg').textContent = '';
  document.getElementById('settPassMsg').textContent = '';
  document.getElementById('settEmailNuevo').value = '';
  document.getElementById('settPass1').value = '';
  document.getElementById('settPass2').value = '';

  const planCard = document.getElementById('planCard');
  planCard.innerHTML = 'Cargando...';
  try{
    const { data } = await sb.auth.getUser();
    const user = data && data.user;
    document.getElementById('settEmailActual').value = user ? user.email : '';
    renderPlanCard();
  }catch(err){
    console.error(err);
    planCard.innerHTML = '<div class="settings-msg err">No pudimos cargar tu plan. Probá de nuevo.</div>';
  }
}

// Ajustes = cómo funciona tu negocio y tu Tikera: nombre del comercio y apariencia.
function loadAjustesView(){
  renderColorSwatches();
  renderFontToggle();
  renderThemeToggle();
  document.getElementById('settNegocio').value = document.getElementById('bizName').value;
  document.getElementById('settPerfilMsg').textContent = '';
  renderRubroAjustes();
  renderFacturacionAjustesForm();
}

// Muestra el rubro actual y qué módulos están activos en Ajustes (el botón
// reabre el onboarding para cambiarlos).
function renderRubroAjustes(){
  const el = document.getElementById('settRubroActual');
  if(!el) return;
  const rubros = (comercioConfig.rubros || []).map(rubroLabel);
  const activos = MODULOS_OPCIONALES.filter(moduloActivo).map(k => MODULOS[k].label);
  if(rubros.length === 0 && onboardingPendiente()){
    el.innerHTML = 'Todavía no elegiste tu rubro — están todos los módulos activos.';
    return;
  }
  const rubroTxt = rubros.length ? `<b>Rubro:</b> ${escapeHtml(rubros.join(', '))}` : '<b>Rubro:</b> sin especificar';
  const modTxt = activos.length ? `<b>Módulos activos:</b> ${escapeHtml(activos.join(', '))}` : 'Sin módulos opcionales activos';
  el.innerHTML = `${rubroTxt}<br>${modTxt}`;
}

function renderPlanCard(){
  const planCard = document.getElementById('planCard');

  let badge, note;
  if(currentPlan === 'cortesia'){
    badge = '<span class="plan-badge cortesia"><span class="dot"></span>Cortesía</span>';
    note = 'Tenés acceso completo a Tikera sin costo. Gracias por ser de las primeras cuentas.';
  }else if(currentPlan === 'pago'){
    badge = '<span class="plan-badge trial"><span class="dot"></span>Activo</span>';
    note = 'Tu plan está activo. Todavía no hay portal de facturación conectado -- para cualquier cambio, escribinos a contacto.tikera@gmail.com.';
  }else{
    const diasRestantes = Math.max(0, trialDiasRestantes());
    const vencida = isTrialExpired();
    badge = vencida
      ? '<span class="plan-badge expired"><span class="dot"></span>Prueba vencida</span>'
      : `<span class="plan-badge trial"><span class="dot"></span>Prueba — ${diasRestantes} día${diasRestantes===1?'':'s'}</span>`;
    note = vencida
      ? 'Tu prueba de 14 días ya terminó. Escribinos a contacto.tikera@gmail.com para seguir usando Tikera mientras activamos el cobro automático.'
      : 'Cuando termine la prueba vas a poder pagar y esta sección va a mostrar tu estado real.';
  }

  planCard.innerHTML = `
    <div class="plan-card-top">
      <div>
        <div class="plan-name">Tikera</div>
        <div class="plan-price">$9.500/mes despues de la prueba</div>
      </div>
      ${badge}
    </div>
    <ul class="plan-features">
      <li>Control de caja diario</li>
      <li>Ganancia real</li>
      <li>Catálogo con stock</li>
      <li>Funciona sin internet</li>
      <li>Reportes y exportación</li>
      <li>Uso desde celular y compu</li>
    </ul>
    <div class="plan-note">${note}</div>
  `;
}

(function(){ const b = document.getElementById('settRubroBtn'); if(b) b.addEventListener('click', openOnboarding); })();

document.getElementById('settPerfilBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('settPerfilMsg');
  const val = document.getElementById('settNegocio').value.trim();
  if(!val){ msg.className = 'settings-msg err'; msg.textContent = 'Ingresá un nombre.'; return; }
  msg.className = 'settings-msg'; msg.textContent = '';
  try{
    const { error } = await sb.from('profiles').update({ business_name: val }).eq('id', currentUserId);
    if(error) throw error;
    document.getElementById('bizName').value = val;
    msg.className = 'settings-msg ok'; msg.textContent = 'Guardado.';
    showToast('Perfil actualizado');
  }catch(err){
    console.error(err);
    msg.className = 'settings-msg err'; msg.textContent = 'No se pudo guardar. Probá de nuevo.';
  }
});

// ============================================
// Facturación electrónica (ARCA): configuración en Ajustes, vista propia
// en el nav, y el botón "Facturar" del ticket. arca-config/arca-facturar
// son Edge Functions (ver supabase/functions/README.md) -- acá solo se las
// llama y se muestra el resultado.
// ============================================
let facTipoSeleccionado = 'C';
let facAmbienteSeleccionado = 'homologacion';

function renderFacturacionAjustesForm(){
  document.getElementById('facCuit').value = (facturacionConfig && facturacionConfig.cuit) || '';
  document.getElementById('facRazonSocial').value = (facturacionConfig && facturacionConfig.razon_social) || '';
  document.getElementById('facPuntoVenta').value = (facturacionConfig && facturacionConfig.punto_venta) || '';
  facTipoSeleccionado = (facturacionConfig && facturacionConfig.tipo_comprobante_default) || 'C';
  facAmbienteSeleccionado = (facturacionConfig && facturacionConfig.ambiente) || 'homologacion';
  document.querySelectorAll('#facTipoToggle .type-btn').forEach(b => b.classList.toggle('active-accent', b.dataset.tipo === facTipoSeleccionado));
  document.querySelectorAll('#facAmbienteToggle .type-btn').forEach(b => b.classList.toggle('active-accent', b.dataset.ambiente === facAmbienteSeleccionado));
  ['facCertificado','facClavePrivada'].forEach(id => {
    const input = document.getElementById(id);
    input.value = '';
    syncFilePick(input);
  });
  document.getElementById('facConfigMsg').className = 'settings-msg';
  document.getElementById('facConfigMsg').textContent = '';
}

// El label .file-pick (hermano siguiente del input oculto) muestra el
// nombre del archivo elegido, o el placeholder si no hay ninguno.
function syncFilePick(input){
  const pick = input.nextElementSibling;
  if(!pick || !pick.classList.contains('file-pick')) return;
  const file = input.files && input.files[0];
  pick.classList.toggle('has-file', !!file);
  pick.querySelector('.file-pick-name').textContent = file ? file.name : pick.dataset.placeholder;
}
['facCertificado','facClavePrivada'].forEach(id => {
  const input = document.getElementById(id);
  input.addEventListener('change', () => syncFilePick(input));
});

document.querySelectorAll('#facTipoToggle .type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if(btn.disabled) return;
    facTipoSeleccionado = btn.dataset.tipo;
    document.querySelectorAll('#facTipoToggle .type-btn').forEach(b => b.classList.toggle('active-accent', b === btn));
  });
});
document.querySelectorAll('#facAmbienteToggle .type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    facAmbienteSeleccionado = btn.dataset.ambiente;
    document.querySelectorAll('#facAmbienteToggle .type-btn').forEach(b => b.classList.toggle('active-accent', b === btn));
  });
});

function readFileAsText(fileInput){
  const file = fileInput.files[0];
  if(!file) return Promise.resolve('');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// Helper comun para las tres llamadas a Edge Functions de facturacion
// (guardar config, probar conexion, facturar una venta) -- mismo patron de
// auth que usaba el chat de ai-agent (ver supabase/functions/README.md).
async function llamarArca(funcionNombre, body){
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData && sessionData.session && sessionData.session.access_token;
  if(!token) throw new Error('Sin sesión activa.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${funcionNombre}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const result = await res.json().catch(()=>({}));
  if(!res.ok || result.error || result.ok === false) throw new Error(result.error || 'No se pudo completar la operación.');
  return result;
}

async function recargarFacturacionConfig(){
  const { data } = await sb.from('facturacion_config').select(FACTURACION_CONFIG_COLS).eq('user_id', currentUserId).maybeSingle();
  facturacionConfig = data || null;
}

document.getElementById('facGuardarBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('facConfigMsg');
  const btn = document.getElementById('facGuardarBtn');
  const cuit = document.getElementById('facCuit').value.trim();
  const puntoVenta = document.getElementById('facPuntoVenta').value;
  if(!cuit || !puntoVenta){ msg.className = 'settings-msg err'; msg.textContent = 'Completá CUIT y punto de venta.'; return; }

  btn.disabled = true; msg.className = 'settings-msg'; msg.textContent = 'Guardando...';
  try{
    const certificado_pem = await readFileAsText(document.getElementById('facCertificado'));
    const clave_privada_pem = await readFileAsText(document.getElementById('facClavePrivada'));
    await llamarArca('arca-config', {
      accion: 'guardar',
      cuit, punto_venta: puntoVenta,
      razon_social: document.getElementById('facRazonSocial').value.trim(),
      tipo_comprobante_default: facTipoSeleccionado,
      ambiente: facAmbienteSeleccionado,
      certificado_pem, clave_privada_pem,
    });
    await recargarFacturacionConfig();
    renderFacturacionAjustesForm();
    msg.className = 'settings-msg ok'; msg.textContent = 'Guardado.';
    showToast('Configuración de facturación guardada');
  }catch(err){
    console.error(err);
    msg.className = 'settings-msg err'; msg.textContent = err.message || 'No se pudo guardar.';
  }
  btn.disabled = false;
});

document.getElementById('facProbarBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('facConfigMsg');
  const btn = document.getElementById('facProbarBtn');
  btn.disabled = true; msg.className = 'settings-msg'; msg.textContent = 'Probando conexión con ARCA...';
  try{
    await llamarArca('arca-config', { accion: 'probar_conexion' });
    await recargarFacturacionConfig();
    msg.className = 'settings-msg ok'; msg.textContent = 'Conexión exitosa. Ya podés facturar ventas.';
    showToast('Conexión con ARCA verificada');
  }catch(err){
    console.error(err);
    msg.className = 'settings-msg err'; msg.textContent = err.message || 'No se pudo conectar.';
  }
  btn.disabled = false;
});

// --- Vista "Facturación" del nav ---
function openFacturacionView(){
  renderFacturacionStatusCard();
  renderFacturacionList();
}

function renderFacturacionStatusCard(){
  const card = document.getElementById('facturacionStatusCard');
  if(!facturacionConfig || !facturacionConfig.cuit){
    card.innerHTML = `
      <div style="font-size:14px;color:var(--ink);margin-bottom:10px;">Todavía no configuraste la facturación electrónica.</div>
      <button type="button" class="settings-btn primary" onclick="switchView('ajustes')">Configurar en Ajustes</button>
    `;
    return;
  }
  const ambienteBadge = facturacionConfig.ambiente === 'produccion'
    ? '<span class="plan-badge pagado"><span class="dot"></span>Producción</span>'
    : '<span class="plan-badge cortesia"><span class="dot"></span>Homologación (pruebas)</span>';
  const estadoBadge = facturacionConfig.activado
    ? '<span class="plan-badge pagado"><span class="dot"></span>Conectado</span>'
    : '<span class="plan-badge expired"><span class="dot"></span>Sin probar conexión</span>';

  card.innerHTML = `
    <div class="plan-card-top">
      <div>
        <div class="plan-name">CUIT ${escapeHtml(facturacionConfig.cuit)}</div>
        <div class="plan-price">${facturacionConfig.razon_social ? escapeHtml(facturacionConfig.razon_social) + ' · ' : ''}Punto de venta ${facturacionConfig.punto_venta || '—'} · Factura ${facturacionConfig.tipo_comprobante_default}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;">${ambienteBadge}${estadoBadge}</div>
    </div>
    <button type="button" class="settings-btn" id="facStatusProbarBtn" style="margin-top:10px;">Probar conexión</button>
    <button type="button" class="settings-btn" onclick="switchView('ajustes')" style="margin-top:8px;">Editar configuración</button>
  `;
  document.getElementById('facStatusProbarBtn').addEventListener('click', async (e)=>{
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = 'Probando...';
    try{
      await llamarArca('arca-config', { accion: 'probar_conexion' });
      await recargarFacturacionConfig();
      showToast('Conexión con ARCA verificada');
    }catch(err){
      console.error(err);
      showToast(err.message || 'No se pudo conectar con ARCA');
    }
    renderFacturacionStatusCard();
  });
}

function renderFacturacionList(){
  const list = document.getElementById('facturacionList');
  const empty = document.getElementById('facturacionListEmpty');
  if(facturas.length === 0){
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  const ordenadas = [...facturas].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  list.innerHTML = ordenadas.map(f => {
    const estadoBadge = f.estado === 'emitida'
      ? '<span class="plan-badge pagado"><span class="dot"></span>Emitida</span>'
      : f.estado === 'error'
        ? '<span class="plan-badge expired"><span class="dot"></span>Error</span>'
        : '<span class="plan-badge trial"><span class="dot"></span>Pendiente</span>';
    const numeroTxt = f.numero ? `Factura ${f.tipo_comprobante} ${String(f.punto_venta).padStart(4,'0')}-${String(f.numero).padStart(8,'0')}` : `Factura ${f.tipo_comprobante}`;
    return `
      <div class="ticket-item">
        <div class="ti-left">
          <div class="ti-desc">${escapeHtml(numeroTxt)}</div>
          <div class="ti-meta">${fmtMoney(f.monto)}${f.ambiente === 'homologacion' ? ' · homologación' : ''}${f.estado === 'error' && f.error_mensaje ? ' · ' + escapeHtml(f.error_mensaje) : ''}</div>
        </div>
        <div class="ti-right">${estadoBadge}</div>
      </div>
    `;
  }).join('');
}

// --- Botón "Facturar" en el ticket (ver verTicket() más abajo) ---
function facturaDeMovimiento(movementId){
  return facturas.find(f => String(f.movement_id) === String(movementId));
}

// Arma la URL del QR que exige la RG 4892/2020 -- se construye 100% del
// lado del cliente con datos que ya tenemos, sin otro viaje al servidor.
function armarQrArca(factura){
  const payload = {
    ver: 1,
    fecha: factura.fechaEmision ? factura.fechaEmision.slice(0,10) : todayStr(),
    cuit: Number(facturacionConfig.cuit),
    ptoVta: factura.puntoVenta,
    tipoCmp: { C: 11, B: 6, A: 1 }[factura.tipoComprobante] || 11,
    nroCmp: factura.numero,
    importe: Number(factura.monto || 0),
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: 99,
    nroDocRec: 0,
    tipoCodAut: 'E',
    codAut: Number(factura.cae),
  };
  const b64 = btoa(JSON.stringify(payload));
  return `https://www.afip.gob.ar/fe/qr/?p=${b64}`;
}

function renderFacturarActions(movement){
  const wrap = document.getElementById('facturarActions');
  if(!wrap) return;
  if(movement.pending){
    wrap.innerHTML = `<div style="font-size:12px;color:var(--ink-soft);margin-top:10px;text-align:center;">Facturá esta venta una vez que se sincronice.</div>`;
    return;
  }
  const factura = facturaDeMovimiento(movement.id);
  if(factura && factura.estado === 'emitida') { wrap.innerHTML = ''; return; } // el CAE ya se muestra en el ticket

  if(!facturacionConfig || !facturacionConfig.activado){
    wrap.innerHTML = `<button type="button" class="settings-btn" style="width:100%;margin-top:10px;" onclick="switchView('ajustes');document.getElementById('ticketModal').style.display='none';">Activar facturación electrónica</button>`;
    return;
  }

  const errorPrevio = factura && factura.estado === 'error' ? factura.error_mensaje : null;
  wrap.innerHTML = `
    ${errorPrevio ? `<div style="font-size:12px;color:var(--gasto);margin:10px 0 2px;">${escapeHtml(errorPrevio)}</div>` : ''}
    <button type="button" class="settings-btn primary" id="facturarBtn" style="width:100%;margin-top:${errorPrevio?'4px':'10px'};">${errorPrevio ? 'Reintentar' : 'Facturar'}</button>
  `;
  document.getElementById('facturarBtn').addEventListener('click', () => facturarVenta(movement.id));
}

async function facturarVenta(movementId){
  const btn = document.getElementById('facturarBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Facturando...'; }
  try{
    const result = await llamarArca('arca-facturar', { movement_id: movementId });
    const idx = facturas.findIndex(f => String(f.movement_id) === String(movementId));
    const nueva = {
      movement_id: movementId, user_id: currentUserId, monto: result.factura.monto,
      tipo_comprobante: result.factura.tipoComprobante, punto_venta: result.factura.puntoVenta,
      numero: result.factura.numero, cae: result.factura.cae, cae_vencimiento: result.factura.caeVencimiento,
      estado: result.factura.estado, fecha_emision: result.factura.fechaEmision, ambiente: result.factura.ambiente,
      error_mensaje: result.factura.errorMensaje, created_at: new Date().toISOString(),
    };
    if(idx === -1) facturas.unshift(nueva); else facturas[idx] = { ...facturas[idx], ...nueva };
    showToast('Factura emitida');
    verTicket(movementId);
  }catch(err){
    console.error(err);
    showToast(err.message || 'No se pudo facturar');
    const idx = facturas.findIndex(f => String(f.movement_id) === String(movementId));
    const errorMensaje = err.message || 'No se pudo facturar';
    if(idx === -1) facturas.unshift({ movement_id: movementId, user_id: currentUserId, monto: 0, estado: 'error', error_mensaje: errorMensaje, created_at: new Date().toISOString() });
    else facturas[idx] = { ...facturas[idx], estado: 'error', error_mensaje: errorMensaje };
    const movement = entries.find(e => String(e.id) === String(movementId));
    if(movement) renderFacturarActions(movement);
  }
}

document.getElementById('settEmailBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('settEmailMsg');
  const nuevo = document.getElementById('settEmailNuevo').value.trim();
  if(!nuevo || !nuevo.includes('@')){ msg.className = 'settings-msg err'; msg.textContent = 'Ingresá un email válido.'; return; }
  msg.className = 'settings-msg'; msg.textContent = 'Actualizando...';
  document.getElementById('settEmailBtn').disabled = true;
  try{
    const { error } = await sb.auth.updateUser({ email: nuevo });
    if(error) throw error;
    msg.className = 'settings-msg ok';
    msg.textContent = 'Te enviamos un email de confirmación a la dirección nueva (y un aviso a la vieja). El cambio se aplica cuando lo confirmes desde tu correo.';
    document.getElementById('settEmailNuevo').value = '';
  }catch(err){
    msg.className = 'settings-msg err'; msg.textContent = traducirErrorAuth(err.message);
  }finally{
    document.getElementById('settEmailBtn').disabled = false;
  }
});

document.getElementById('settPassBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('settPassMsg');
  const p1 = document.getElementById('settPass1').value;
  const p2 = document.getElementById('settPass2').value;
  if(!p1 || p1.length < 8){ msg.className = 'settings-msg err'; msg.textContent = 'La contraseña tiene que tener al menos 8 caracteres.'; return; }
  if(p1 !== p2){ msg.className = 'settings-msg err'; msg.textContent = 'Las dos contraseñas no coinciden.'; return; }
  msg.className = 'settings-msg'; msg.textContent = 'Actualizando...';
  document.getElementById('settPassBtn').disabled = true;
  try{
    const { error } = await sb.auth.updateUser({ password: p1 });
    if(error) throw error;
    msg.className = 'settings-msg ok'; msg.textContent = 'Contraseña actualizada.';
    document.getElementById('settPass1').value = '';
    document.getElementById('settPass2').value = '';
    showToast('Contraseña actualizada');
  }catch(err){
    msg.className = 'settings-msg err'; msg.textContent = traducirErrorAuth(err.message);
  }finally{
    document.getElementById('settPassBtn').disabled = false;
  }
});

document.getElementById('settLogoutBtn').addEventListener('click', ()=>{
  document.getElementById('switchBizBtn').click();
});

document.getElementById('settDeleteBtn').addEventListener('click', async ()=>{
  const msg = document.getElementById('settDeleteMsg');
  const sure = confirm('¿Seguro que querés eliminar tu cuenta?\n\nSe van a borrar tu perfil, tus ventas y gastos, tu catálogo, tus proveedores, tus cierres de caja y lo que le pediste a Tiki que recuerde. Esta acción no se puede deshacer.');
  if(!sure) return;

  const btn = document.getElementById('settDeleteBtn');
  btn.disabled = true;
  msg.className = 'settings-msg';
  msg.textContent = 'Eliminando tu cuenta...';
  try{
    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData && sessionData.session && sessionData.session.access_token;
    if(!token) throw new Error('Sin sesión activa.');
    const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await res.json().catch(()=>({}));
    if(!res.ok || result.error) throw new Error(result.error || 'No se pudo eliminar la cuenta.');
    // Las ventas sin conexion de esta cuenta que no llegaron a subirse viven
    // en este dispositivo: tambien se borran (las de otras cuentas que usen
    // el mismo navegador se dejan).
    savePendingQueue(loadPendingQueue().filter(item => !esPendienteDeLaCuenta(item)));
    await sb.auth.signOut();
    window.location.reload();
  }catch(err){
    console.error(err);
    msg.className = 'settings-msg err';
    msg.textContent = 'No se pudo eliminar la cuenta. Probá de nuevo o escribinos a contacto.tikera@gmail.com.';
    btn.disabled = false;
  }
});

// Si ya había una sesión abierta en este navegador, entrar directo sin pedir nada
(async function checkExistingSession(){
  // Si el link trae un token de recuperación, dejar que el evento PASSWORD_RECOVERY
  // se encargue de mostrar el formulario de contraseña nueva — no entrar directo.
  if(window.location.href.includes('type=recovery')){
    return;
  }
  try{
    const { data } = await sb.auth.getSession();
    if(data && data.session){
      await loadData();
      document.getElementById('gate').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.body.classList.add('app-active');
      document.getElementById('bottomNav').style.display = 'flex';
      switchView('inicio');
      maybeShowOnboarding();
    }
  }catch(e){ console.error(e); }
})();

let currentUserId = null;

function mapRowToEntry(row){
  return {
    id: row.id,
    fecha: row.fecha,
    hora: row.hora || '',
    tipo: row.tipo,
    descripcion: row.descripcion,
    cantidad: row.cantidad ?? '',
    precioUnitario: row.precio_unitario ?? '',
    costoUnitario: row.costo_unitario ?? '',
    costoTotal: row.costo_total ?? '',
    ganancia: row.ganancia ?? '',
    monto: row.monto,
    metodoPago: row.metodo_pago || '',
    nota: row.nota || '',
    categoria: row.categoria || '',
    proveedorId: row.proveedor_id || null,
    esFijo: !!row.es_fijo,
    timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

function mapFieldsToRow(fields){
  return {
    user_id: currentUserId,
    fecha: fields.fecha,
    hora: fields.hora !== undefined ? fields.hora : new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
    tipo: fields.tipo,
    descripcion: fields.descripcion,
    cantidad: fields.cantidad === '' ? null : fields.cantidad,
    precio_unitario: fields.precioUnitario === '' ? null : fields.precioUnitario,
    costo_unitario: fields.costoUnitario === '' ? null : fields.costoUnitario,
    costo_total: fields.costoTotal === '' ? null : fields.costoTotal,
    ganancia: fields.ganancia === '' ? null : fields.ganancia,
    monto: fields.monto,
    metodo_pago: fields.metodoPago,
    nota: fields.nota,
    categoria: fields.categoria || null,
    proveedor_id: fields.proveedorId || null,
    es_fijo: !!fields.esFijo
  };
}

// ============================================
// Cola offline: si se corta internet a mitad de una venta, no se pierde.
// Se guarda en localStorage y se sube sola apenas vuelve la conexión.
// ============================================
const PENDING_KEY = 'tikera_pending_movements';

function loadPendingQueue(){
  try{ return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); }
  catch(e){ return []; }
}
function savePendingQueue(queue){
  try{ localStorage.setItem(PENDING_KEY, JSON.stringify(queue)); }
  catch(e){ console.error(e); }
}
function isPendingId(id){
  return typeof id === 'string' && id.startsWith('local_');
}
function pendingFieldsToEntry(fields, localId){
  return {
    id: localId,
    fecha: fields.fecha,
    hora: fields.hora !== undefined ? fields.hora : new Date().toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'}),
    tipo: fields.tipo,
    descripcion: fields.descripcion,
    cantidad: fields.cantidad,
    precioUnitario: fields.precioUnitario,
    costoUnitario: fields.costoUnitario,
    costoTotal: fields.costoTotal,
    ganancia: fields.ganancia,
    monto: fields.monto,
    metodoPago: fields.metodoPago,
    nota: fields.nota,
    timestamp: Date.now(),
    pending: true
  };
}
// Un error de red (offline, DNS caído, request que nunca llega) se trata distinto
// de un error real del servidor (validación, RLS): solo el primero se encola.
function looksLikeNetworkError(error){
  if(!navigator.onLine) return true;
  const msg = (error && error.message ? error.message : String(error || '')).toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') ||
    msg.includes('load failed') || msg.includes('err_internet') || msg.includes('err_connection');
}
function queueMovementOffline(fields, row){
  const localId = 'local_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
  const queue = loadPendingQueue();
  queue.push({ localId, fields, row });
  savePendingQueue(queue);
  const entry = pendingFieldsToEntry(fields, localId);
  entries.push(entry);
  // Ajuste optimista solo para que el catálogo se vea al día mientras está offline;
  // lo que persiste de verdad en la base pasa por applyStockDelta al sincronizar.
  if(fields.productoId) adjustLocalProductStock(fields.productoId, -(Number(fields.cantidadVenta) || 0));
  return entry;
}
function adjustLocalProductStock(productId, delta){
  const p = products.find(x => String(x.id) === String(productId));
  if(!p) return;
  p.stock_actual = (Number(p.stock_actual) || 0) + delta;
  if(document.getElementById('viewCatalogo').style.display !== 'none') renderCatalog();
}

// La cola vive en localStorage, que es del navegador y no de la cuenta: en
// un celular compartido puede haber movimientos pendientes de otra cuenta.
// Cada uno guarda su user_id (lo pone mapFieldsToRow), y solo se muestra y
// se sube lo de la cuenta logueada -- lo ajeno queda esperando a su dueño.
// Subirlo igual lo rechazaria RLS, pero mostrarlo ya mezclaba datos de dos
// cuentas en Inicio, Caja (efectivo esperado) y Tiki.
function esPendienteDeLaCuenta(item){
  return !!(currentUserId && item && item.row && item.row.user_id === currentUserId);
}

let syncingPending = false;
async function syncPendingMovements(){
  if(syncingPending) return;
  const mios = loadPendingQueue().filter(esPendienteDeLaCuenta);
  if(mios.length === 0 || !navigator.onLine){ refreshConnStatus(); return; }
  syncingPending = true;
  setConnStatus('syncing', mios.length === 1 ? 'Sincronizando 1…' : `Sincronizando ${mios.length}…`);
  const subidos = new Set();
  for(const item of mios){
    try{
      const { data, error } = await sb.from('movements').insert(item.row).select().single();
      if(error){
        if(!looksLikeNetworkError(error)) console.error(error);
        continue;
      }
      // Ya esta en la base: sale de la cola pase lo que pase despues (si
      // fallaba el ajuste de stock y quedaba en la cola, se volvia a subir
      // y la venta aparecia duplicada).
      subidos.add(item.localId);
      const idx = entries.findIndex(e => e.id === item.localId);
      const synced = mapRowToEntry(data);
      if(idx !== -1) entries[idx] = synced; else entries.push(synced);
      if(item.fields.productoId){
        try{ await applyStockDelta(item.fields.productoId, item.fields.cantidadVenta); }
        catch(err){ console.error(err); }
      }
    }catch(err){
      if(!looksLikeNetworkError(err)) console.error(err);
    }
  }
  // Se relee la cola en vez de pisarla con una copia vieja: lo que se haya
  // encolado mientras se subia (otra venta sin conexion) no se pierde.
  savePendingQueue(loadPendingQueue().filter(item => !subidos.has(item.localId)));
  syncingPending = false;
  if(subidos.size > 0){
    showToast(subidos.size === 1 ? 'Se sincronizó 1 movimiento pendiente' : `Se sincronizaron ${subidos.size} movimientos pendientes`);
    render();
    setConnStatus('synced', 'Sincronizado ✓');
    setTimeout(refreshConnStatus, 2600);
  }else{
    refreshConnStatus();
  }
}

// ============================================
// Estado de conexión visible (pill en el header)
// Solo habla cuando hay algo que decir: sin señal, sincronizando o recién
// sincronizado. En línea y sin nada pendiente, se esconde.
// ============================================
function setConnStatus(state, text){
  const el = document.getElementById('connStatus');
  if(!el) return;
  el.className = 'conn-status conn-' + state;
  const t = document.getElementById('connText');
  if(t) t.textContent = text;
  el.hidden = false;
}
function hideConnStatus(){
  const el = document.getElementById('connStatus');
  if(el) el.hidden = true;
}
function pendingCount(){
  try{ return loadPendingQueue().filter(esPendienteDeLaCuenta).length; }catch(e){ return 0; }
}
function refreshConnStatus(){
  if(!navigator.onLine){ setConnStatus('offline', 'Sin conexión · guardando acá'); return; }
  const n = pendingCount();
  if(n > 0){ setConnStatus('pending', n === 1 ? '1 venta sin subir' : `${n} ventas sin subir`); return; }
  hideConnStatus();
}
window.addEventListener('offline', ()=> setConnStatus('offline', 'Sin conexión · guardando acá'));

// ============================================
// Instalar Tikera como app (PWA)
// Chrome/Android disparan beforeinstallprompt y mostramos el banner con el
// botón nativo. iOS no lo soporta, así que ahí mostramos cómo hacerlo a mano
// (Compartir → Agregar a inicio). Si ya está instalada, no molesta.
// ============================================
let deferredInstallPrompt = null;
const INSTALL_DISMISS_KEY = 'tikera_install_dismissed';

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function showInstallBanner(mode){
  const banner = document.getElementById('installBanner');
  if(!banner) return;
  if(isStandalone()) return;
  try{ if(localStorage.getItem(INSTALL_DISMISS_KEY) === '1') return; }catch(e){}
  const sub = document.getElementById('installSub');
  const btn = document.getElementById('installBtn');
  if(mode === 'ios'){
    if(sub) sub.textContent = 'Tocá Compartir y después "Agregar a inicio".';
    if(btn) btn.style.display = 'none';
  }else{
    if(sub) sub.textContent = 'Entrá en un toque, incluso sin internet.';
    if(btn) btn.style.display = '';
  }
  banner.hidden = false;
}
function hideInstallBanner(){
  const banner = document.getElementById('installBanner');
  if(banner) banner.hidden = true;
}
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBanner('prompt');
});
window.addEventListener('appinstalled', ()=>{
  hideInstallBanner();
  deferredInstallPrompt = null;
  showToast('¡Tikera quedó instalada!');
});
(function wireInstall(){
  const btn = document.getElementById('installBtn');
  if(btn) btn.addEventListener('click', async ()=>{
    if(!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try{
      const { outcome } = await deferredInstallPrompt.userChoice;
      if(outcome === 'accepted') showToast('¡Instalando Tikera!');
    }catch(e){ console.error(e); }
    deferredInstallPrompt = null;
    hideInstallBanner();
  });
  const dismiss = document.getElementById('installDismiss');
  if(dismiss) dismiss.addEventListener('click', ()=>{
    hideInstallBanner();
    try{ localStorage.setItem(INSTALL_DISMISS_KEY, '1'); }catch(e){}
  });
  // iOS no dispara beforeinstallprompt: si es iPhone/iPad y no está instalada,
  // mostramos las instrucciones manuales.
  if(isIOS() && !isStandalone()) showInstallBanner('ios');
})();
function hydratePendingIntoEntries(){
  const queue = loadPendingQueue().filter(esPendienteDeLaCuenta);
  queue.forEach(item => {
    if(!entries.some(e => e.id === item.localId)){
      entries.push(pendingFieldsToEntry(item.fields, item.localId));
    }
  });
}
window.addEventListener('online', syncPendingMovements);

// Todo lo que pertenece a la cuenta logueada. Se limpia al cerrar sesion,
// al entrar otra cuenta y si falla la carga: antes solo se vaciaban algunas
// listas, y en un celular compartido la cuenta B podia ver en Catalogo, Caja
// o Tiki los productos y cierres que habian quedado en memoria de la A.
function clearUserState(){
  currentUserId = null;
  entries = [];
  frequentProducts = [];
  frequentExpenses = [];
  products = [];
  proveedores = [];
  pedidosProveedor = [];
  equipos = [];
  productoVariantes = [];
  cierresCaja = [];
  facturacionConfig = null;
  facturas = [];
  editingId = null;
  editingHora = null;
  editingProductId = null;
  selectedProductId = null;
  editingProveedorId = null;
  openProveedorId = null;
  cierreCajaFechaActiva = null;
  if(typeof resetTiki === 'function') resetTiki();
}

// Supabase corta cada respuesta en "Max rows" (1000 por default en API
// settings). Sin paginar, un kiosco con mas de 1000 movimientos recibia
// solo los 1000 MAS VIEJOS (el orden es ascendente): Inicio, Historial, el
// efectivo esperado del cierre de caja y Tiki trabajaban sin las ventas
// recientes. Avanza por la cantidad realmente recibida (sirve con cualquier
// valor de Max rows) y descarta repetidos por si entra una fila nueva entre
// pagina y pagina.
const PAGE_SIZE = 1000;
async function fetchAllRows(buildQuery){
  const rows = [];
  const vistos = new Set();
  let total = null;
  for(let pagina = 0; pagina < 500; pagina++){
    const desde = rows.length;
    const { data, error, count } = await buildQuery(total === null ? { count: 'exact' } : undefined).range(desde, desde + PAGE_SIZE - 1);
    if(error) return { data: null, error };
    if(total === null && typeof count === 'number') total = count;
    if(!data || data.length === 0) break;
    let nuevos = 0;
    data.forEach(r => { if(!vistos.has(r.id)){ vistos.add(r.id); rows.push(r); nuevos++; } });
    if(nuevos === 0 || (total !== null && rows.length >= total)) break;
  }
  return { data: rows, error: null };
}

async function loadData(){
  try{
    const { data: userData } = await sb.auth.getUser();
    const user = userData && userData.user;
    if(!user){ clearUserState(); return; }
    if(currentUserId !== user.id) clearUserState();
    currentUserId = user.id;

    const { data: profile } = await sb.from('profiles').select('business_name, plan, trial_started_at').eq('id', user.id).single();
    document.getElementById('bizName').value = (profile && profile.business_name) || 'Mi negocio';
    currentPlan = (profile && profile.plan) || 'trial';
    currentTrialStartedAt = profile && profile.trial_started_at ? new Date(profile.trial_started_at) : null;

    // Config del comercio (rubro/módulos). Tolerante a que la migración 017 no
    // esté aplicada todavía: si las columnas no existen, queda la config legacy
    // (todos los módulos activos), así la app funciona igual antes y después de
    // correr la migración.
    try{
      const { data: cfg, error: cfgErr } = await sb.from('profiles').select('rubros, modulos, onboarding_at').eq('id', user.id).single();
      comercioConfig = (!cfgErr && cfg)
        ? { rubros: cfg.rubros || [], modulos: cfg.modulos || {}, onboardingAt: cfg.onboarding_at || null }
        : { rubros: [], modulos: {}, onboardingAt: null };
    }catch(e){ comercioConfig = { rubros: [], modulos: {}, onboardingAt: null }; }

    // Perfil del comercio (antigüedad/volumen/cobro) — se pide aparte para que,
    // si la columna no existe (falta 021), no voltee la carga de rubros/módulos.
    try{
      const { data: pf, error: pfErr } = await sb.from('profiles').select('perfil').eq('id', user.id).single();
      perfilNegocio = (!pfErr && pf && pf.perfil) ? pf.perfil : {};
    }catch(e){ perfilNegocio = {}; }

    const { data: movRows, error: movErr } = await fetchAllRows(opts => sb.from('movements').select('*', opts).eq('user_id', user.id).order('created_at', {ascending:true}).order('id', {ascending:true}));
    entries = movErr ? [] : (movRows || []).map(mapRowToEntry);
    if(movErr){ console.error(movErr); showToast('No se pudieron cargar los movimientos'); }

    const { data: freqRows } = await sb.from('frequent_items').select('*').eq('user_id', user.id).order('created_at', {ascending:true});
    frequentProducts = (freqRows||[]).filter(r=>r.tipo==='Venta').map(r=>({id:r.id, nombre:r.nombre}));
    frequentExpenses = (freqRows||[]).filter(r=>r.tipo==='Gasto').map(r=>({id:r.id, nombre:r.nombre}));

    // Si la tabla "products" todavía no existe (falta correr supabase/products.sql),
    // el catálogo queda vacío en vez de romper el resto de la app.
    const { data: productRows, error: prodErr } = await fetchAllRows(opts => sb.from('products').select('*', opts).eq('user_id', user.id).order('nombre', {ascending:true}).order('id', {ascending:true}));
    products = prodErr ? [] : (productRows || []);
    if(prodErr) console.error(prodErr);

    // Igual que "products": si todavía no corriste 008_proveedores.sql,
    // esta sección queda vacía en vez de romper el resto de la app.
    const { data: provRows, error: provErr } = await fetchAllRows(opts => sb.from('proveedores').select('*', opts).eq('user_id', user.id).order('nombre', {ascending:true}).order('id', {ascending:true}));
    proveedores = provErr ? [] : (provRows || []);
    if(provErr) console.error(provErr);

    // Equipos (celulares): solo si el módulo está activo. Tolerante a que la
    // migración 018 todavía no esté aplicada (si la tabla no existe, queda []).
    if(moduloActivo('equipos')){
      try{
        const { data: eqRows, error: eqErr } = await fetchAllRows(opts => sb.from('equipos').select('*', opts).eq('user_id', user.id).order('created_at', {ascending:false}).order('id', {ascending:false}));
        equipos = eqErr ? [] : (eqRows || []);
        if(eqErr && !looksLikeNetworkError(eqErr)) console.error(eqErr);
      }catch(e){ equipos = []; console.error(e); }
    }else{ equipos = []; }

    // Variantes de producto (ropa): solo si el módulo está activo. Tolerante a
    // que la migración 019 todavía no esté aplicada.
    if(moduloActivo('variantes')){
      try{
        const { data: varRows, error: varErr } = await fetchAllRows(opts => sb.from('producto_variantes').select('*', opts).eq('user_id', user.id).order('id', {ascending:true}));
        productoVariantes = varErr ? [] : (varRows || []);
        if(varErr && !looksLikeNetworkError(varErr)) console.error(varErr);
      }catch(e){ productoVariantes = []; console.error(e); }
    }else{ productoVariantes = []; }

    const { data: pedidoRows, error: pedidoErr } = await fetchAllRows(opts => sb.from('pedidos_proveedor').select('*', opts).eq('user_id', user.id).order('fecha', {ascending:false}).order('id', {ascending:false}));
    pedidosProveedor = pedidoErr ? [] : (pedidoRows || []);
    if(pedidoErr) console.error(pedidoErr);

    // Igual que "products"/"proveedores": si todavía no corriste 009_cierres_caja.sql,
    // esta sección queda vacía en vez de romper el resto de la app.
    const { data: cierreRows, error: cierreErr } = await fetchAllRows(opts => sb.from('cierres_caja').select('*', opts).eq('user_id', user.id).order('fecha', {ascending:false}).order('id', {ascending:false}));
    cierresCaja = cierreErr ? [] : (cierreRows || []);
    if(cierreErr) console.error(cierreErr);

    // Igual que las anteriores: si todavía no corriste 013_facturacion_arca.sql,
    // esta sección queda vacía/sin configurar en vez de romper el resto de la app.
    // No tener fila en facturacion_config es un estado normal (nunca se configuró
    // todavía), por eso maybeSingle() en vez de single().
    const { data: facturacionRow, error: facturacionErr } = await sb.from('facturacion_config').select(FACTURACION_CONFIG_COLS).eq('user_id', user.id).maybeSingle();
    facturacionConfig = facturacionErr ? null : facturacionRow;
    if(facturacionErr) console.error(facturacionErr);

    const { data: facturaRows, error: facturaErr } = await sb.from('facturas').select('*').eq('user_id', user.id).order('created_at', {ascending:false});
    facturas = facturaErr ? [] : (facturaRows || []);
    if(facturaErr) console.error(facturaErr);

    hydratePendingIntoEntries();
  }catch(e){
    console.error(e);
    showToast('No se pudieron cargar tus datos');
    // Falla cerrada: mejor pantallas vacias que datos a medio cargar (o de
    // la sesion anterior). La sesion sigue siendo la misma, por eso se
    // conserva el id.
    const uid = currentUserId;
    clearUserState();
    currentUserId = uid;
  }
  renderFreqChips();
  fillProductSelectOptions();
  fillGastoProveedorOptions();
  aplicarModulosAlNav();
  render();
  syncPendingMovements();
}

function currentFreqList(){
  return currentTipo === 'Venta' ? frequentProducts : frequentExpenses;
}

function renderFreqChips(){
  const wrap = document.getElementById('freqChips');
  const list = currentFreqList();
  document.getElementById('freqLabel').textContent = currentTipo === 'Venta' ? 'Productos frecuentes' : 'Gastos frecuentes';
  document.getElementById('newFreqName').placeholder = currentTipo === 'Venta' ? 'Agregar producto frecuente' : 'Agregar gasto frecuente';
  wrap.innerHTML = list.map(item => `
    <button type="button" class="type-btn" style="flex:none;padding:6px 12px;font-size:12.5px;display:inline-flex;align-items:center;gap:6px;" onclick="useFrequent('${item.id}')">
      ${escapeHtml(item.nombre)}
      <span onclick="event.stopPropagation();removeFrequent('${item.id}')" style="color:var(--ink-soft);">&times;</span>
    </button>
  `).join('') || `<span style="font-size:12px;color:var(--ink-soft);">${currentTipo === 'Venta' ? 'Agregá los productos que más vendés para cargarlos en un toque.' : 'Agregá los gastos habituales del negocio para cargarlos en un toque.'}</span>`;
}

function useFrequent(id){
  const item = currentFreqList().find(x => String(x.id) === String(id));
  if(!item) return;
  document.getElementById('descripcion').value = item.nombre;
  if(currentTipo === 'Venta'){
    document.getElementById('cantidad').focus();
  }else{
    document.getElementById('monto').focus();
  }
}

async function removeFrequent(id){
  try{
    const { error } = await sb.from('frequent_items').delete().eq('id', id).eq('user_id', currentUserId);
    if(error) throw error;
  }catch(e){
    console.error(e);
    showToast('No se pudo eliminar');
    return;
  }
  if(currentTipo === 'Venta'){
    frequentProducts = frequentProducts.filter(x => x.id !== id);
  }else{
    frequentExpenses = frequentExpenses.filter(x => x.id !== id);
  }
  renderFreqChips();
}

document.getElementById('addFreqBtn').addEventListener('click', addFrequent);
document.getElementById('newFreqName').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); addFrequent(); }
});
async function addFrequent(){
  const input = document.getElementById('newFreqName');
  const val = input.value.trim();
  if(!val) return;
  try{
    const { data, error } = await sb.from('frequent_items').insert({
      user_id: currentUserId, tipo: currentTipo, nombre: val
    }).select().single();
    if(error) throw error;
    currentFreqList().push({ id: data.id, nombre: data.nombre });
    renderFreqChips();
    input.value = '';
  }catch(e){
    console.error(e);
    showToast('No se pudo agregar');
  }
}

// ============================================
// Catálogo de productos con stock
// ============================================
function renderCatalog(){
  const list = document.getElementById('catalogList');
  const empty = document.getElementById('catalogEmpty');
  if(products.length === 0){
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';

  const SIN_CATEGORIA = 'Sin categoría';
  const groups = {};
  products.forEach(p => {
    const cat = (p.categoria || '').trim() || SIN_CATEGORIA;
    if(!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });
  const catNames = Object.keys(groups).sort((a,b) => {
    if(a === SIN_CATEGORIA) return 1;
    if(b === SIN_CATEGORIA) return -1;
    return a.localeCompare(b,'es');
  });

  list.innerHTML = catNames.map(cat => {
    const items = groups[cat].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
    const conVariantes = moduloActivo('variantes');
    const rows = items.map(p => {
      const stock = Number(p.stock_actual) || 0;
      const low = p.stock_minimo !== null && p.stock_minimo !== undefined && p.stock_minimo !== '' && stock <= Number(p.stock_minimo);
      // Con el módulo de variantes: si el producto tiene variantes, el stock que
      // vale es el de las variantes (suma), y se ofrece gestionarlas.
      const vars = conVariantes ? variantesDeProducto(p.id) : [];
      const stockTxt = (conVariantes && vars.length)
        ? `Stock (variantes): ${stockVariantes(p.id)} · ${vars.length} ${vars.length === 1 ? 'variante' : 'variantes'}`
        : `Stock: <span class="${low ? 'stock-low' : ''}">${stock}${low ? ' — repone ya' : ''}</span>`;
      const btnVariantes = conVariantes
        ? `<button class="ti-del eq-varbtn" aria-label="Variantes" title="Talles y colores" onclick="openVariantes('${p.id}')"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg></button>`
        : '';
      return `
        <div class="ticket-item">
          <div class="ti-left">
            <div class="ti-desc">${escapeHtml(p.nombre)}</div>
            <div class="ti-meta">${p.precio_venta ? fmtMoney(p.precio_venta) : 'sin precio'} · ${stockTxt}</div>
          </div>
          <div class="ti-right">
            ${btnVariantes}
            <button class="ti-del" aria-label="Editar" onclick="editProduct('${p.id}')">&#9998;</button>
            <button class="ti-del" aria-label="Eliminar" onclick="deleteProduct('${p.id}')">&times;</button>
          </div>
        </div>
      `;
    }).join('');
    return `
      <div class="catalog-group">
        <div class="catalog-group-title">${escapeHtml(cat)} <span class="catalog-group-count">${items.length}</span></div>
        ${rows}
      </div>
    `;
  }).join('');

  const catList = document.getElementById('prodCategoriaList');
  if(catList){
    const usedCats = [...new Set(products.map(p => (p.categoria || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
    catList.innerHTML = usedCats.map(c => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  // Botón de ajuste masivo de precios: solo tiene sentido si hay al menos un
  // producto con precio cargado (si no, no hay nada que ajustar).
  const priceBar = document.getElementById('priceToolBar');
  if(priceBar){
    const conPrecio = products.filter(p => Number(p.precio_venta) > 0).length;
    priceBar.style.display = conPrecio > 0 ? 'block' : 'none';
    const sub = document.getElementById('priceToolSub');
    if(sub) sub.textContent = conPrecio === 1
      ? 'Aumentá el precio de 1 producto de una'
      : `Aumentá los ${conPrecio} precios de tu catálogo de una`;
  }
  renderPriceUndoBar();
}

function fillProductSelectOptions(){
  const sel = document.getElementById('productoSelect');
  if(!sel) return;
  const current = sel.value;
  const sorted = [...products].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  sel.innerHTML = '<option value="">— Elegir del catálogo (opcional) —</option>' +
    sorted.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)} · stock ${Number(p.stock_actual)||0}</option>`).join('');
  sel.value = sorted.some(p => String(p.id) === current) ? current : '';

  const list = document.getElementById('productoSelectList');
  if(list){
    list.innerHTML = '<div class="custom-select-option placeholder" role="option" data-value="">— Elegir del catálogo (opcional) —</div>' +
      sorted.map(p => `<div class="custom-select-option" role="option" data-value="${p.id}">${escapeHtml(p.nombre)} · stock ${Number(p.stock_actual)||0}</div>`).join('');
  }
  updateProductoSelectLabel();
  const showCatalogo = currentTipo === 'Venta' && products.length > 0;
  document.getElementById('productoSelectWrap').style.display = showCatalogo ? 'block' : 'none';
  document.getElementById('catalogoDivider').style.display = showCatalogo ? 'block' : 'none';
  renderStockWheel();
  renderRestockPrediction();
}

// Mantiene el texto visible del desplegable propio en sincronia con el
// <select> real (que sigue siendo la unica fuente de verdad del valor).
function updateProductoSelectLabel(){
  const sel = document.getElementById('productoSelect');
  const label = document.getElementById('productoSelectLabel');
  if(!sel || !label) return;
  const opt = sel.options[sel.selectedIndex];
  const text = (opt && sel.value) ? opt.textContent : '— Elegir del catálogo (opcional) —';
  label.textContent = text;
  label.classList.toggle('placeholder', !sel.value);
  document.querySelectorAll('#productoSelectList .custom-select-option').forEach(el=>{
    el.classList.toggle('active', el.dataset.value === sel.value);
  });
}

function closeProductoSelect(){
  document.getElementById('productoSelectCustom').classList.remove('open');
  document.getElementById('productoSelectTrigger').setAttribute('aria-expanded', 'false');
}

document.getElementById('productoSelectTrigger').addEventListener('click', ()=>{
  const wrap = document.getElementById('productoSelectCustom');
  const opening = !wrap.classList.contains('open');
  wrap.classList.toggle('open', opening);
  document.getElementById('productoSelectTrigger').setAttribute('aria-expanded', String(opening));
});
document.getElementById('productoSelectList').addEventListener('click', (e)=>{
  const opt = e.target.closest('.custom-select-option');
  if(!opt) return;
  const sel = document.getElementById('productoSelect');
  sel.value = opt.dataset.value;
  sel.dispatchEvent(new Event('change'));
  updateProductoSelectLabel();
  closeProductoSelect();
});
document.addEventListener('click', (e)=>{
  const wrap = document.getElementById('productoSelectCustom');
  if(wrap && !wrap.contains(e.target)) closeProductoSelect();
});
document.getElementById('productoSelectTrigger').addEventListener('keydown', (e)=>{
  if(e.key === 'Escape') closeProductoSelect();
});

function setCatalogoTab(tab){
  catalogoTab = tab;
  document.getElementById('catalogoProductosPanel').style.display = tab === 'productos' ? 'block' : 'none';
  document.getElementById('catalogoProveedoresPanel').style.display = tab === 'proveedores' ? 'block' : 'none';
  document.getElementById('newProductBtn').style.display = tab === 'productos' ? '' : 'none';
  document.getElementById('newProveedorBtn').style.display = tab === 'proveedores' ? '' : 'none';
  document.getElementById('btnCatalogoProductos').className = 'type-btn' + (tab==='productos' ? ' active-accent' : '');
  document.getElementById('btnCatalogoProveedores').className = 'type-btn' + (tab==='proveedores' ? ' active-accent' : '');
  if(tab === 'proveedores') renderProveedores();
}
document.getElementById('btnCatalogoProductos').addEventListener('click', ()=>setCatalogoTab('productos'));
document.getElementById('btnCatalogoProveedores').addEventListener('click', ()=>setCatalogoTab('proveedores'));

function resetProductForm(){
  editingProductId = null;
  document.getElementById('prodNombre').value = '';
  document.getElementById('prodCategoria').value = '';
  document.getElementById('prodPrecio').value = '';
  document.getElementById('prodCosto').value = '';
  document.getElementById('prodStock').value = '';
  document.getElementById('prodStockMin').value = '';
  document.getElementById('prodErrorMsg').textContent = '';
  document.getElementById('prodSubmitBtn').textContent = 'Guardar producto';
}

document.getElementById('newProductBtn').addEventListener('click', ()=>{
  const form = document.getElementById('productForm');
  const opening = form.style.display === 'none';
  if(opening) resetProductForm();
  form.style.display = opening ? 'block' : 'none';
});
document.getElementById('prodCancelBtn').addEventListener('click', ()=>{
  document.getElementById('productForm').style.display = 'none';
  resetProductForm();
});

document.getElementById('prodSubmitBtn').addEventListener('click', async ()=>{
  const nombre = document.getElementById('prodNombre').value.trim();
  const errEl = document.getElementById('prodErrorMsg');
  if(!nombre){ errEl.textContent = 'Ingresá un nombre.'; return; }
  errEl.textContent = '';

  const fields = {
    nombre,
    categoria: document.getElementById('prodCategoria').value.trim() || null,
    precio_venta: parseFloat(document.getElementById('prodPrecio').value) || null,
    costo_unitario: parseFloat(document.getElementById('prodCosto').value) || null,
    stock_actual: parseFloat(document.getElementById('prodStock').value) || 0,
    stock_minimo: document.getElementById('prodStockMin').value === '' ? null : parseFloat(document.getElementById('prodStockMin').value)
  };

  document.getElementById('prodSubmitBtn').disabled = true;
  const ok = editingProductId ? await updateProduct(editingProductId, fields) : await addProduct(fields);
  document.getElementById('prodSubmitBtn').disabled = false;
  if(ok){
    showToast(editingProductId ? 'Producto actualizado' : 'Producto agregado');
    document.getElementById('productForm').style.display = 'none';
    resetProductForm();
    renderCatalog();
    fillProductSelectOptions();
  }
});

// El unique index de la base es la fuente de verdad contra duplicados
// (el chequeo del form es solo para feedback inmediato); 23505 es el
// codigo de Postgres para "violacion de restriccion unica".
async function addProduct(fields){
  try{
    const { data, error } = await sb.from('products').insert({ user_id: currentUserId, ...fields }).select().single();
    if(error){
      console.error(error);
      showToast(error.code === '23505' ? 'Ese código de barras ya está en uso' : 'No se pudo guardar el producto');
      return null;
    }
    products.push(data);
    return data;
  }catch(err){ console.error(err); showToast('No se pudo guardar el producto'); return null; }
}

async function updateProduct(id, fields){
  try{
    const { data, error } = await sb.from('products').update(fields).eq('id', id).eq('user_id', currentUserId).select().single();
    if(error){
      console.error(error);
      showToast(error.code === '23505' ? 'Ese código de barras ya está en uso' : 'No se pudo actualizar el producto');
      return null;
    }
    const idx = products.findIndex(p => String(p.id) === String(id));
    if(idx !== -1) products[idx] = data;
    return data;
  }catch(err){ console.error(err); showToast('No se pudo actualizar el producto'); return null; }
}

function editProduct(id){
  const p = products.find(x => String(x.id) === String(id));
  if(!p) return;
  editingProductId = id;
  document.getElementById('prodNombre').value = p.nombre;
  document.getElementById('prodCategoria').value = p.categoria || '';
  document.getElementById('prodPrecio').value = p.precio_venta ?? '';
  document.getElementById('prodCosto').value = p.costo_unitario ?? '';
  document.getElementById('prodStock').value = p.stock_actual ?? '';
  document.getElementById('prodStockMin').value = p.stock_minimo ?? '';
  document.getElementById('prodSubmitBtn').textContent = 'Guardar cambios';
  document.getElementById('productForm').style.display = 'block';
  document.getElementById('prodNombre').scrollIntoView({behavior:'smooth', block:'center'});
}

async function deleteProduct(id){
  const p = products.find(x => String(x.id) === String(id));
  const label = p ? `"${p.nombre}"` : 'este producto';
  if(!confirm(`¿Seguro que querés borrar ${label} del catálogo? El stock no se puede recuperar después.`)) return;
  try{
    const { error } = await sb.from('products').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo eliminar'); return; }
    products = products.filter(p => String(p.id) !== String(id));
    renderCatalog();
    fillProductSelectOptions();
    showToast('Producto eliminado');
  }catch(err){ console.error(err); showToast('No se pudo eliminar'); }
}

// ============================================
// Proveedores: a quién le comprás y qué le debés.
// ============================================
function pedidosDeProveedor(provId){
  return pedidosProveedor.filter(x => String(x.proveedor_id) === String(provId));
}
function totalPendienteProveedor(provId){
  return pedidosDeProveedor(provId).filter(x => !x.pagado).reduce((s,x) => s + (Number(x.monto) || 0), 0);
}

function renderProveedores(){
  fillGastoProveedorOptions();
  const list = document.getElementById('proveedoresList');
  const empty = document.getElementById('proveedoresEmpty');
  if(proveedores.length === 0){
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  const sorted = [...proveedores].sort((a,b) => a.nombre.localeCompare(b.nombre,'es'));
  list.innerHTML = sorted.map(p => {
    const pendiente = totalPendienteProveedor(p.id);
    return `
      <div class="ticket-item" style="cursor:pointer;" onclick="openProveedorModal('${p.id}')">
        <div class="ti-left">
          <div class="ti-desc">${escapeHtml(p.nombre)}</div>
          <div class="ti-meta">${p.contacto ? escapeHtml(p.contacto) : 'sin contacto'} · ${pendiente > 0 ? `<span class="stock-low">Debés ${fmtMoney(pendiente)}</span>` : `<span style="color:var(--venta);">Al día</span>`}</div>
        </div>
        <div class="ti-right">
          <button class="ti-del" aria-label="Editar" onclick="event.stopPropagation();editProveedor('${p.id}')">&#9998;</button>
          <button class="ti-del" aria-label="Eliminar" onclick="event.stopPropagation();deleteProveedor('${p.id}')">&times;</button>
        </div>
      </div>
    `;
  }).join('');
}

function resetProveedorForm(){
  editingProveedorId = null;
  document.getElementById('provNombre').value = '';
  document.getElementById('provContacto').value = '';
  document.getElementById('provNotas').value = '';
  document.getElementById('provErrorMsg').textContent = '';
  document.getElementById('provSubmitBtn').textContent = 'Guardar proveedor';
}

document.getElementById('newProveedorBtn').addEventListener('click', ()=>{
  const form = document.getElementById('proveedorForm');
  const opening = form.style.display === 'none';
  if(opening) resetProveedorForm();
  form.style.display = opening ? 'block' : 'none';
});
document.getElementById('provCancelBtn').addEventListener('click', ()=>{
  document.getElementById('proveedorForm').style.display = 'none';
  resetProveedorForm();
});

document.getElementById('provSubmitBtn').addEventListener('click', async ()=>{
  const nombre = document.getElementById('provNombre').value.trim();
  const errEl = document.getElementById('provErrorMsg');
  if(!nombre){ errEl.textContent = 'Ingresá un nombre.'; return; }
  errEl.textContent = '';

  const fields = {
    nombre,
    contacto: document.getElementById('provContacto').value.trim() || null,
    notas: document.getElementById('provNotas').value.trim() || null
  };

  document.getElementById('provSubmitBtn').disabled = true;
  const ok = editingProveedorId ? await updateProveedor(editingProveedorId, fields) : await addProveedor(fields);
  document.getElementById('provSubmitBtn').disabled = false;
  if(ok){
    showToast(editingProveedorId ? 'Proveedor actualizado' : 'Proveedor agregado');
    document.getElementById('proveedorForm').style.display = 'none';
    resetProveedorForm();
    renderProveedores();
  }
});

async function addProveedor(fields){
  try{
    const { data, error } = await sb.from('proveedores').insert({ user_id: currentUserId, ...fields }).select().single();
    if(error){ console.error(error); showToast('No se pudo guardar el proveedor'); return null; }
    proveedores.push(data);
    return data;
  }catch(err){ console.error(err); showToast('No se pudo guardar el proveedor'); return null; }
}

async function updateProveedor(id, fields){
  try{
    const { data, error } = await sb.from('proveedores').update(fields).eq('id', id).eq('user_id', currentUserId).select().single();
    if(error){ console.error(error); showToast('No se pudo actualizar el proveedor'); return null; }
    const idx = proveedores.findIndex(p => String(p.id) === String(id));
    if(idx !== -1) proveedores[idx] = data;
    return data;
  }catch(err){ console.error(err); showToast('No se pudo actualizar el proveedor'); return null; }
}

function editProveedor(id){
  const p = proveedores.find(x => String(x.id) === String(id));
  if(!p) return;
  editingProveedorId = id;
  document.getElementById('provNombre').value = p.nombre;
  document.getElementById('provContacto').value = p.contacto || '';
  document.getElementById('provNotas').value = p.notas || '';
  document.getElementById('provSubmitBtn').textContent = 'Guardar cambios';
  document.getElementById('proveedorForm').style.display = 'block';
  document.getElementById('provNombre').scrollIntoView({behavior:'smooth', block:'center'});
}

async function deleteProveedor(id){
  const p = proveedores.find(x => String(x.id) === String(id));
  const label = p ? `"${p.nombre}"` : 'este proveedor';
  if(!confirm(`¿Seguro que querés borrar ${label}? También se van a borrar todos sus pedidos anotados. Esta acción no se puede deshacer.`)) return;
  try{
    const { error } = await sb.from('proveedores').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo eliminar'); return; }
    proveedores = proveedores.filter(p => String(p.id) !== String(id));
    if(String(editingProveedorId) === String(id)){
      document.getElementById('proveedorForm').style.display = 'none';
      resetProveedorForm();
    }
    pedidosProveedor = pedidosProveedor.filter(x => String(x.proveedor_id) !== String(id));
    renderProveedores();
    showToast('Proveedor eliminado');
  }catch(err){ console.error(err); showToast('No se pudo eliminar'); }
}

function renderProveedorModalHeader(p){
  if(!p) return;
  const pendiente = totalPendienteProveedor(p.id);
  document.getElementById('proveedorModalHeader').innerHTML = `
    <h2 style="margin:0 0 4px;font-family:'Space Grotesk',sans-serif;font-size:17px;">${escapeHtml(p.nombre)}</h2>
    ${p.contacto ? `<div style="font-size:12.5px;color:var(--ink-soft);">${escapeHtml(p.contacto)}</div>` : ''}
    ${p.notas ? `<div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px;">${escapeHtml(p.notas)}</div>` : ''}
    <div class="plan-badge ${pendiente > 0 ? 'expired' : 'pagado'}" style="margin-top:10px;">
      <span class="dot"></span>${pendiente > 0 ? `Debés ${fmtMoney(pendiente)}` : 'Al día'}
    </div>
  `;
}

function renderProveedorModalPedidos(provId){
  const wrap = document.getElementById('proveedorModalPedidos');
  const pedidos = [...pedidosDeProveedor(provId)].sort((a,b) => b.fecha.localeCompare(a.fecha));
  if(pedidos.length === 0){
    wrap.innerHTML = `<div style="padding:16px 0;text-align:center;color:var(--ink-soft);font-size:13px;">Todavía no anotaste pedidos de este proveedor.</div>`;
    return;
  }
  wrap.innerHTML = pedidos.map(x => `
    <div class="ticket-item" data-pedido-id="${x.id}">
      <div class="ti-left">
        <div class="ti-desc">${escapeHtml(x.descripcion)}</div>
        <div class="ti-meta">${fmtFecha(x.fecha)}${x.cantidad ? ' · ' + x.cantidad + ' u.' : ''} · ${fmtMoney(x.monto)}</div>
      </div>
      <div class="ti-right">
        <button type="button" class="plan-badge ${x.pagado ? 'pagado' : 'expired'} pedido-toggle-pagado"><span class="dot"></span>${x.pagado ? 'Pagado' : 'Pendiente'}</button>
        <button class="ti-del pedido-del" aria-label="Eliminar pedido">&times;</button>
      </div>
    </div>
  `).join('');
}

document.getElementById('proveedorModalPedidos').addEventListener('click', (e)=>{
  const row = e.target.closest('[data-pedido-id]');
  if(!row) return;
  const id = row.dataset.pedidoId;
  if(e.target.closest('.pedido-toggle-pagado')) togglePedidoPagado(id);
  else if(e.target.closest('.pedido-del')) deletePedido(id);
});

async function addPedido(fields){
  try{
    const { data, error } = await sb.from('pedidos_proveedor').insert({ user_id: currentUserId, ...fields }).select().single();
    if(error){ console.error(error); showToast('No se pudo guardar el pedido'); return null; }
    pedidosProveedor.push(data);
    return data;
  }catch(err){ console.error(err); showToast('No se pudo guardar el pedido'); return null; }
}

async function togglePedidoPagado(id){
  const x = pedidosProveedor.find(p => String(p.id) === String(id));
  if(!x) return;
  const nuevoPagado = !x.pagado;
  try{
    const { error } = await sb.from('pedidos_proveedor').update({ pagado: nuevoPagado }).eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo actualizar'); return; }
    x.pagado = nuevoPagado;
    renderProveedorModalPedidos(x.proveedor_id);
    renderProveedorModalHeader(proveedores.find(p => String(p.id) === String(x.proveedor_id)));
    renderProveedores();
  }catch(err){ console.error(err); showToast('No se pudo actualizar'); }
}

async function deletePedido(id){
  const x = pedidosProveedor.find(p => String(p.id) === String(id));
  if(!x) return;
  if(!confirm('¿Seguro que querés borrar este pedido? Esta acción no se puede deshacer.')) return;
  try{
    const { error } = await sb.from('pedidos_proveedor').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo eliminar'); return; }
    pedidosProveedor = pedidosProveedor.filter(p => String(p.id) !== String(id));
    renderProveedorModalPedidos(x.proveedor_id);
    renderProveedorModalHeader(proveedores.find(p => String(p.id) === String(x.proveedor_id)));
    renderProveedores();
    showToast('Pedido eliminado');
  }catch(err){ console.error(err); showToast('No se pudo eliminar'); }
}

function openProveedorModal(id){
  const p = proveedores.find(x => String(x.id) === String(id));
  if(!p) return;
  openProveedorId = id;
  renderProveedorModalHeader(p);
  renderProveedorModalPedidos(id);
  document.getElementById('pedidoFecha').value = todayStr();
  document.getElementById('pedidoDescripcion').value = '';
  document.getElementById('pedidoCantidad').value = '';
  document.getElementById('pedidoMonto').value = '';
  document.getElementById('pedidoErrorMsg').textContent = '';
  document.getElementById('proveedorModal').style.display = 'flex';
}
function closeProveedorModal(){
  openProveedorId = null;
  document.getElementById('proveedorModal').style.display = 'none';
}
document.getElementById('proveedorModalCloseBtn').addEventListener('click', closeProveedorModal);
document.getElementById('proveedorModal').addEventListener('click', (e)=>{
  if(e.target.id === 'proveedorModal') closeProveedorModal();
});

document.getElementById('pedidoSubmitBtn').addEventListener('click', async ()=>{
  const errEl = document.getElementById('pedidoErrorMsg');
  const fecha = document.getElementById('pedidoFecha').value;
  const descripcion = document.getElementById('pedidoDescripcion').value.trim();
  const monto = parseFloat(document.getElementById('pedidoMonto').value);
  if(!fecha || !descripcion || !monto || monto <= 0){ errEl.textContent = 'Completá fecha, descripción y monto.'; return; }
  if(!openProveedorId) return;
  errEl.textContent = '';

  const fields = {
    proveedor_id: openProveedorId,
    fecha,
    descripcion,
    cantidad: parseFloat(document.getElementById('pedidoCantidad').value) || null,
    monto,
    pagado: false
  };

  document.getElementById('pedidoSubmitBtn').disabled = true;
  const ok = await addPedido(fields);
  document.getElementById('pedidoSubmitBtn').disabled = false;
  if(ok){
    showToast('Pedido agregado');
    document.getElementById('pedidoDescripcion').value = '';
    document.getElementById('pedidoCantidad').value = '';
    document.getElementById('pedidoMonto').value = '';
    renderProveedorModalPedidos(openProveedorId);
    renderProveedorModalHeader(proveedores.find(p => String(p.id) === String(openProveedorId)));
    renderProveedores();
  }
});

// Descuenta stock cuando se confirma una venta ligada a un producto del catálogo.
// Relee el stock desde la base antes de restar para no perder cambios hechos desde
// otro dispositivo; por eso solo se llama una vez que la venta ya está sincronizada.
async function applyStockDelta(productId, cantidadVendida){
  if(!productId || !cantidadVendida) return;
  try{
    const { data, error } = await sb.from('products').select('stock_actual').eq('id', productId).eq('user_id', currentUserId).single();
    if(error || !data) return;
    const nuevoStock = (Number(data.stock_actual) || 0) - Number(cantidadVendida);
    const { error: updErr } = await sb.from('products').update({ stock_actual: nuevoStock }).eq('id', productId).eq('user_id', currentUserId);
    if(updErr){ console.error(updErr); return; }
    const p = products.find(x => String(x.id) === String(productId));
    if(p) p.stock_actual = nuevoStock;
    if(document.getElementById('viewCatalogo').style.display !== 'none') renderCatalog();
    renderStockWheel();
    renderRestockPrediction();
  }catch(err){ console.error(err); }
}

async function addMovement(fields){
  const row = mapFieldsToRow(fields);
  if(!navigator.onLine) return queueMovementOffline(fields, row);
  try{
    const { data, error } = await sb.from('movements').insert(row).select().single();
    if(error){
      if(looksLikeNetworkError(error)) return queueMovementOffline(fields, row);
      console.error(error); showToast('No se pudo guardar el movimiento'); return null;
    }
    const entry = mapRowToEntry(data);
    entries.push(entry);
    if(fields.productoId) applyStockDelta(fields.productoId, fields.cantidadVenta);
    return entry;
  }catch(err){
    if(looksLikeNetworkError(err)) return queueMovementOffline(fields, row);
    console.error(err); showToast('No se pudo guardar el movimiento'); return null;
  }
}

// Editar/eliminar un movimiento que todavía no se sincronizó se resuelve
// local (contra la cola), sin tocar Supabase — todavía no existe ahí.
async function updateMovement(id, fields){
  if(isPendingId(id)){
    const queue = loadPendingQueue();
    const item = queue.find(q => q.localId === id);
    if(!item) return null;
    item.fields = fields;
    item.row = mapFieldsToRow(fields);
    savePendingQueue(queue);
    const idx = entries.findIndex(e => e.id === id);
    const updated = pendingFieldsToEntry(fields, id);
    if(idx !== -1) entries[idx] = updated;
    return updated;
  }
  const row = mapFieldsToRow(fields);
  try{
    const { data, error } = await sb.from('movements').update(row).eq('id', id).eq('user_id', currentUserId).select().single();
    if(error){
      if(looksLikeNetworkError(error)){ showToast('Sin conexión: no se pudo actualizar. Probá de nuevo cuando vuelva internet.'); return null; }
      console.error(error); showToast('No se pudo actualizar'); return null;
    }
    const idx = entries.findIndex(e => e.id === id);
    if(idx !== -1) entries[idx] = mapRowToEntry(data);
    return data;
  }catch(err){
    if(looksLikeNetworkError(err)){ showToast('Sin conexión: no se pudo actualizar. Probá de nuevo cuando vuelva internet.'); return null; }
    console.error(err); showToast('No se pudo actualizar'); return null;
  }
}

async function deleteMovement(id){
  if(isPendingId(id)){
    savePendingQueue(loadPendingQueue().filter(q => q.localId !== id));
    entries = entries.filter(e => e.id !== id);
    return true;
  }
  try{
    const { error } = await sb.from('movements').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){
      if(looksLikeNetworkError(error)){ showToast('Sin conexión: no se pudo eliminar. Probá de nuevo cuando vuelva internet.'); return false; }
      console.error(error); showToast('No se pudo eliminar'); return false;
    }
    entries = entries.filter(e => e.id !== id);
    return true;
  }catch(err){
    if(looksLikeNetworkError(err)){ showToast('Sin conexión: no se pudo eliminar. Probá de nuevo cuando vuelva internet.'); return false; }
    console.error(err); showToast('No se pudo eliminar'); return false;
  }
}

document.getElementById('fecha').value = todayStr();
document.getElementById('todayLabel').textContent = new Date().toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long'});

function setTipo(t){
  currentTipo = t;
  document.getElementById('btnVenta').className = 'type-btn' + (t==='Venta' ? ' active-venta' : '');
  document.getElementById('btnGasto').className = 'type-btn' + (t==='Gasto' ? ' active-gasto' : '');
  const card = document.getElementById('entryCard');
  card.classList.remove('mode-venta','mode-gasto');
  card.classList.add(t==='Venta' ? 'mode-venta' : 'mode-gasto');
  document.getElementById('entryCardTitle').textContent = t==='Venta' ? 'Nueva venta' : 'Nuevo gasto';
  document.getElementById('submitBtn').textContent = editingId ? 'Guardar cambios' : (t==='Venta' ? 'Registrar venta' : 'Registrar gasto');
  document.getElementById('descripcion').placeholder = t==='Venta' ? 'Ej: 2 gaseosas, cigarrillos...' : 'Ej: alquiler, luz, mercadería...';

  const rowCantPrecio = document.getElementById('rowCantPrecio');
  const productoWrap = document.getElementById('productoSelectWrap');
  const catalogoDivider = document.getElementById('catalogoDivider');
  const categoriaWrap = document.getElementById('categoriaWrap');
  const gastoProveedorWrap = document.getElementById('gastoProveedorWrap');
  const esFijoWrap = document.getElementById('esFijoWrap');
  const costoToggleBtn = document.getElementById('costoToggleBtn');
  if(t === 'Gasto'){
    rowCantPrecio.style.display = 'none';
    productoWrap.style.display = 'none';
    catalogoDivider.style.display = 'none';
    costoToggleBtn.style.display = 'none';
    categoriaWrap.style.display = 'block';
    gastoProveedorWrap.style.display = 'block';
    esFijoWrap.style.display = 'flex';
    document.getElementById('cantidad').value = 1;
    document.getElementById('precioUnit').value = '';
    document.getElementById('costoUnit').value = '';
    document.getElementById('gananciaPreview').textContent = '';
    document.getElementById('productoSelect').value = '';
    updateProductoSelectLabel();
    selectedProductId = null;
    renderCategoriaChips();
  }else{
    rowCantPrecio.style.display = 'grid';
    productoWrap.style.display = products.length ? 'block' : 'none';
    catalogoDivider.style.display = products.length ? 'block' : 'none';
    costoToggleBtn.style.display = 'inline-block';
    categoriaWrap.style.display = 'none';
    gastoProveedorWrap.style.display = 'none';
    esFijoWrap.style.display = 'none';
    selectedCategoria = null;
    document.getElementById('gastoProveedor').value = '';
    document.getElementById('esFijo').checked = false;
  }
  collapseField('rowCosto', 'costoToggleBtn');
  collapseField('notaWrap', 'notaToggleBtn');
  collapseField('freqAddWrap', 'freqAddToggleBtn');

  if(typeof renderFreqChips === 'function' && document.getElementById('freqChips')){
    renderFreqChips();
  }
}
document.getElementById('btnVenta').addEventListener('click', ()=>setTipo('Venta'));
document.getElementById('btnGasto').addEventListener('click', ()=>setTipo('Gasto'));

// Campos que casi nunca hace falta tocar en una carga rapida (costo, nota,
// agregar un frecuente nuevo): arrancan colapsados detras de un boton chico
// y se muestran recien si el usuario los pide, o si ya tienen un valor
// cargado (por ejemplo al editar un movimiento que si tenia nota).
function collapseField(wrapId, toggleBtnId){
  document.getElementById(wrapId).style.display = 'none';
  const btn = document.getElementById(toggleBtnId);
  if(btn) btn.style.display = 'inline-block';
}
function expandField(wrapId, toggleBtnId){
  document.getElementById(wrapId).style.display = 'block';
  const btn = document.getElementById(toggleBtnId);
  if(btn) btn.style.display = 'none';
}
document.getElementById('costoToggleBtn').addEventListener('click', ()=>{
  expandField('rowCosto', 'costoToggleBtn');
  document.getElementById('costoUnit').focus();
});
document.getElementById('notaToggleBtn').addEventListener('click', ()=>{
  expandField('notaWrap', 'notaToggleBtn');
  document.getElementById('nota').focus();
});
document.getElementById('freqAddToggleBtn').addEventListener('click', ()=>{
  expandField('freqAddWrap', 'freqAddToggleBtn');
  document.getElementById('freqAddWrap').style.display = 'flex';
  document.getElementById('newFreqName').focus();
});
document.getElementById('fechaEditBtn').addEventListener('click', ()=>{
  document.getElementById('fechaDisplay').style.display = 'none';
  const fechaInput = document.getElementById('fecha');
  if(!fechaInput.value) fechaInput.value = todayStr();
  fechaInput.style.display = 'block';
  fechaInput.focus();
});

// Categorias de gasto: chips de seleccion unica, mismo patron visual que
// "Productos frecuentes" (reusa .type-btn) para no meter un componente nuevo.
function renderCategoriaChips(){
  const wrap = document.getElementById('categoriaChips');
  if(!wrap) return;
  wrap.innerHTML = GASTO_CATEGORIAS.map(cat => `
    <button type="button" class="type-btn${cat===selectedCategoria ? ' active-gasto' : ''}" style="flex:none;padding:6px 12px;font-size:12.5px;" data-categoria="${escapeHtml(cat)}">${escapeHtml(cat)}</button>
  `).join('');
  wrap.querySelectorAll('.type-btn').forEach(btn => {
    btn.addEventListener('click', ()=>{
      selectedCategoria = selectedCategoria === btn.dataset.categoria ? null : btn.dataset.categoria;
      renderCategoriaChips();
    });
  });
}

// Desplegable de proveedor en Gasto: mismo listado que ya carga loadData(),
// se repuebla cada vez que cambia (alta/baja de proveedor).
function fillGastoProveedorOptions(){
  const sel = document.getElementById('gastoProveedor');
  if(!sel) return;
  const current = sel.value;
  const sorted = [...proveedores].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'));
  sel.innerHTML = '<option value="">— Ninguno —</option>' +
    sorted.map(p => `<option value="${p.id}">${escapeHtml(p.nombre)}</option>`).join('');
  sel.value = sorted.some(p => String(p.id) === current) ? current : '';
}

setTipo('Venta');

// Bloquea cualquier carácter que no sea número o punto decimal en campos numéricos.
// El type="number" del navegador no alcanza en todos los casos (algunos móviles dejan pasar letras).
function sanitizeNumberField(el){
  el.addEventListener('input', ()=>{
    let v = el.value.replace(/[^0-9.]/g, '');
    const firstDot = v.indexOf('.');
    if(firstDot !== -1){
      v = v.slice(0, firstDot+1) + v.slice(firstDot+1).replace(/\./g, '');
    }
    if(v !== el.value) el.value = v;
  });
  el.addEventListener('keydown', (e)=>{
    const allowedKeys = ['Backspace','Delete','Tab','Escape','Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'];
    if(allowedKeys.includes(e.key) || e.ctrlKey || e.metaKey) return;
    if(e.key === '.' && !el.value.includes('.')) return;
    if(!/^[0-9]$/.test(e.key)) e.preventDefault();
  });
  el.addEventListener('paste', (e)=>{
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text');
    const clean = text.replace(/[^0-9.]/g, '');
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + clean + el.value.slice(end);
    el.dispatchEvent(new Event('input', {bubbles:true}));
  });
}
['cantidad','precioUnit','monto','costoUnit'].forEach(id => sanitizeNumberField(document.getElementById(id)));

function recalcMonto(){
  const cant = parseFloat(document.getElementById('cantidad').value) || 0;
  const precio = parseFloat(document.getElementById('precioUnit').value) || 0;
  if(cant && precio){
    document.getElementById('monto').value = (cant*precio).toFixed(2);
  }
  recalcGananciaPreview();
}

function recalcGananciaPreview(){
  const preview = document.getElementById('gananciaPreview');
  const cant = parseFloat(document.getElementById('cantidad').value) || 0;
  const costo = parseFloat(document.getElementById('costoUnit').value) || 0;
  const monto = parseFloat(document.getElementById('monto').value) || 0;
  if(costo > 0 && monto > 0){
    const ganancia = monto - (costo * cant);
    const pct = monto > 0 ? (ganancia/monto*100) : 0;
    preview.style.color = ganancia >= 0 ? 'var(--venta)' : 'var(--gasto)';
    preview.textContent = `Ganancia estimada: ${fmtMoney(ganancia)} (${pct.toFixed(0)}% de margen)`;
  }else{
    preview.textContent = '';
  }
}
document.getElementById('cantidad').addEventListener('input', recalcMonto);
document.getElementById('precioUnit').addEventListener('input', recalcMonto);
document.getElementById('costoUnit').addEventListener('input', recalcGananciaPreview);
document.getElementById('monto').addEventListener('input', recalcGananciaPreview);

// Elegir un producto (del selector o escaneando su codigo) precarga
// descripción/precio/costo y liga la venta a ese producto (para descontar
// stock al guardar). Si el usuario edita la descripción a mano después,
// se desliga: esa venta ya no es "de catálogo".
function selectProductoParaVenta(p){
  selectedProductId = p.id;
  document.getElementById('productoSelect').value = p.id;
  updateProductoSelectLabel();
  document.getElementById('descripcion').value = p.nombre;
  if(p.precio_venta){ document.getElementById('precioUnit').value = p.precio_venta; }
  if(p.costo_unitario){
    document.getElementById('costoUnit').value = p.costo_unitario;
    expandField('rowCosto', 'costoToggleBtn');
  }
  recalcMonto();
}
document.getElementById('productoSelect').addEventListener('change', (e)=>{
  const id = e.target.value;
  selectedProductId = id || null;
  if(!id) return;
  const p = products.find(x => String(x.id) === String(id));
  if(p) selectProductoParaVenta(p);
});
document.getElementById('descripcion').addEventListener('input', ()=>{ selectedProductId = null; });

document.getElementById('submitBtn').addEventListener('click', async ()=>{
  const desc = document.getElementById('descripcion').value.trim();
  const monto = parseFloat(document.getElementById('monto').value);
  const errEl = document.getElementById('errorMsg');
  if(!desc){ errEl.textContent = 'Ingresá una descripción.'; return; }
  if(!monto || monto <= 0){ errEl.textContent = 'Ingresá un monto mayor a 0.'; return; }
  errEl.textContent = '';

  const cantidadNum = parseFloat(document.getElementById('cantidad').value) || 0;
  const costoUnitNum = parseFloat(document.getElementById('costoUnit').value) || 0;
  const costoTotal = currentTipo === 'Venta' && costoUnitNum > 0 ? costoUnitNum * (cantidadNum || 1) : 0;
  const gananciaCalc = currentTipo === 'Venta' && costoTotal > 0 ? (monto - costoTotal) : '';

  const fieldsFromForm = {
    fecha: document.getElementById('fecha').value || todayStr(),
    tipo: currentTipo,
    descripcion: desc,
    cantidad: parseFloat(document.getElementById('cantidad').value) || '',
    precioUnitario: parseFloat(document.getElementById('precioUnit').value) || '',
    costoUnitario: currentTipo === 'Venta' ? (costoUnitNum || '') : '',
    costoTotal: currentTipo === 'Venta' ? (costoTotal || '') : '',
    ganancia: gananciaCalc,
    monto: monto,
    metodoPago: document.getElementById('metodoPago').value,
    nota: document.getElementById('nota').value.trim()
  };
  // Al editar, conservar la hora original del movimiento en vez de pisarla con la hora actual.
  if(editingId && editingHora){
    fieldsFromForm.hora = editingHora;
  }
  // Solo las ventas nuevas (no ediciones) ligadas a un producto del catálogo
  // descuentan stock — editar una venta ya cargada no lo toca, a propósito.
  if(currentTipo === 'Venta' && selectedProductId && !editingId){
    fieldsFromForm.productoId = selectedProductId;
    fieldsFromForm.cantidadVenta = cantidadNum || 1;
  }
  if(currentTipo === 'Gasto'){
    fieldsFromForm.categoria = selectedCategoria || 'Otro';
    fieldsFromForm.proveedorId = document.getElementById('gastoProveedor').value || null;
    fieldsFromForm.esFijo = document.getElementById('esFijo').checked;
  }

  document.getElementById('submitBtn').disabled = true;

  let ok;
  if(editingId){
    ok = await updateMovement(editingId, fieldsFromForm);
    document.getElementById('submitBtn').disabled = false;
    if(ok){
      editingId = null;
      editingHora = null;
      document.getElementById('submitBtn').textContent = 'Registrar';
      document.getElementById('cancelEditBtn').style.display = 'none';
      showToast(ok.pending ? 'Sin conexión: los cambios quedaron guardados en el dispositivo' : 'Movimiento actualizado');
    }
  }else{
    ok = await addMovement(fieldsFromForm);
    document.getElementById('submitBtn').disabled = false;
    if(ok) showToast(ok.pending ? 'Sin conexión: se guardó en el dispositivo, se sube sola cuando vuelva internet' : 'Movimiento registrado');
  }

  // Si falló el guardado, dejamos lo que el usuario tipeó tal cual estaba
  // para que no tenga que volver a cargarlo a mano.
  if(ok){
    document.getElementById('descripcion').value = '';
    document.getElementById('cantidad').value = 1;
    document.getElementById('precioUnit').value = '';
    document.getElementById('costoUnit').value = '';
    document.getElementById('gananciaPreview').textContent = '';
    document.getElementById('monto').value = '';
    document.getElementById('nota').value = '';
    document.getElementById('productoSelect').value = '';
    updateProductoSelectLabel();
    selectedProductId = null;
    selectedCategoria = null;
    document.getElementById('gastoProveedor').value = '';
    document.getElementById('esFijo').checked = false;
    if(currentTipo === 'Gasto') renderCategoriaChips();
    collapseField('rowCosto', 'costoToggleBtn');
    collapseField('notaWrap', 'notaToggleBtn');
    collapseField('freqAddWrap', 'freqAddToggleBtn');
    document.getElementById('fechaDisplay').style.display = 'block';
    document.getElementById('fecha').style.display = 'none';
    document.getElementById('descripcion').focus();
  }

  render();
});

document.getElementById('cancelEditBtn').addEventListener('click', ()=>{
  editingId = null;
  editingHora = null;
  document.getElementById('submitBtn').textContent = 'Registrar';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('descripcion').value = '';
  document.getElementById('cantidad').value = 1;
  document.getElementById('precioUnit').value = '';
  document.getElementById('costoUnit').value = '';
  document.getElementById('gananciaPreview').textContent = '';
  document.getElementById('monto').value = '';
  document.getElementById('nota').value = '';
  document.getElementById('errorMsg').textContent = '';
  selectedCategoria = null;
  document.getElementById('gastoProveedor').value = '';
  document.getElementById('esFijo').checked = false;
  if(currentTipo === 'Gasto') renderCategoriaChips();
  collapseField('rowCosto', 'costoToggleBtn');
  collapseField('notaWrap', 'notaToggleBtn');
  document.getElementById('fechaDisplay').style.display = 'block';
  document.getElementById('fecha').style.display = 'none';
});

function editEntry(id){
  const e = entries.find(x => x.id === id);
  if(!e) return;
  switchView('cargar');
  editingId = id;
  editingHora = e.hora || null;
  document.getElementById('errorMsg').textContent = '';
  setTipo(e.tipo); // ojo: resetea/colapsa los campos -- las siguientes lineas los repueblan con los datos reales de este movimiento.
  document.getElementById('descripcion').value = e.descripcion;
  document.getElementById('cantidad').value = e.cantidad || '';
  document.getElementById('precioUnit').value = e.precioUnitario || '';
  document.getElementById('costoUnit').value = e.costoUnitario || '';
  document.getElementById('monto').value = e.monto;
  document.getElementById('metodoPago').value = e.metodoPago;
  document.getElementById('fecha').value = e.fecha;
  document.getElementById('nota').value = e.nota || '';

  // Mostrar (no esconder) los campos colapsados que esta carga puntual si tiene.
  if(e.costoUnitario) expandField('rowCosto', 'costoToggleBtn');
  if(e.nota) expandField('notaWrap', 'notaToggleBtn');
  if(e.fecha !== todayStr()){
    document.getElementById('fechaDisplay').style.display = 'none';
    document.getElementById('fecha').style.display = 'block';
  }
  if(e.tipo === 'Gasto'){
    selectedCategoria = e.categoria || null;
    renderCategoriaChips();
    document.getElementById('gastoProveedor').value = e.proveedorId || '';
    document.getElementById('esFijo').checked = !!e.esFijo;
  }

  document.getElementById('submitBtn').textContent = 'Guardar cambios';
  document.getElementById('cancelEditBtn').style.display = 'block';
  recalcGananciaPreview();
  document.getElementById('descripcion').scrollIntoView({behavior:'smooth', block:'center'});
  document.getElementById('descripcion').focus();
}

async function deleteEntry(id){
  const e = entries.find(x => x.id === id);
  const label = e ? `"${e.descripcion}" (${fmtMoney(e.monto)})` : 'este movimiento';
  if(!confirm(`¿Seguro que querés borrar ${label}? No se puede deshacer.`)) return;
  const ok = await deleteMovement(id);
  if(editingId === id){
    editingId = null;
    editingHora = null;
    document.getElementById('submitBtn').textContent = 'Registrar';
    document.getElementById('cancelEditBtn').style.display = 'none';
  }
  if(ok) showToast('Movimiento eliminado');
  render();
}

function render(){
  renderTicket();
  renderSummary();
  renderHistory();
  renderStockWheel();
  renderRestockPrediction();
}

function renderTicket(){
  const today = todayStr();
  const todays = entries.filter(e => e.fecha === today).sort((a,b)=>b.timestamp-a.timestamp);

  const ticketList = document.getElementById('ticketList');
  if(todays.length === 0){
    ticketList.innerHTML = `<div class="ticket-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.4;margin-bottom:8px;"><path d="M4 4h16v16H4z" opacity="0"/><path d="M6 3v18M18 3v18M6 8h4M6 12h4M6 16h4"/><path d="M3 3h18v3H3z"/></svg>
      <div>Todavía no hay movimientos hoy.</div>
    </div>`;
  }else{
    ticketList.innerHTML = todays.map(e => `
      <div class="ticket-item">
        <div class="ti-left">
          <div class="ti-desc">${escapeHtml(e.descripcion)}</div>
          <div class="ti-meta">${escapeHtml(e.hora)} · ${metodoDot(e.metodoPago)}${escapeHtml(e.metodoPago)}${e.pending ? '<span class="pending-badge">Sin sincronizar</span>' : ''}</div>
        </div>
        <div class="ti-right">
          <span class="ti-amount ${e.tipo==='Venta'?'venta':'gasto'}">${e.tipo==='Venta'?'+':'-'}${fmtMoney(e.monto)}</span>
          ${e.tipo==='Venta' ? `<button class="ti-del" aria-label="Ver ticket" onclick="verTicket('${e.id}')">&#128196;</button>` : ''}
          <button class="ti-del" aria-label="Editar" onclick="editEntry('${e.id}')">&#9998;</button>
          <button class="ti-del" aria-label="Eliminar" onclick="deleteEntry('${e.id}')">&times;</button>
        </div>
      </div>
    `).join('');
  }
}

// ============================================
// Ticket de venta: comprobante no fiscal (no reemplaza una factura ARCA),
// pensado para imprimirse en una impresora termica de 80mm via el dialogo
// nativo del navegador -- no hace falta driver ni WebUSB, cualquier
// impresora que el sistema operativo ya reconozca como impresora sirve.
function verTicket(id){
  const e = entries.find(x => x.id === id);
  if(!e) return;
  const bizName = document.getElementById('bizName').value.trim() || 'Mi negocio';
  const cantidadLinea = (e.cantidad && e.precioUnitario)
    ? `<div class="tp-row"><span>${escapeHtml(String(e.cantidad))} x ${fmtMoney(e.precioUnitario)}</span><span></span></div>`
    : '';
  const factura = facturaDeMovimiento(e.id);
  const emitida = factura && factura.estado === 'emitida';
  const numeroTxt = emitida ? `Factura ${factura.tipo_comprobante} ${String(factura.punto_venta).padStart(4,'0')}-${String(factura.numero).padStart(8,'0')}` : 'Comprobante no fiscal';
  const fiscalBlock = emitida ? `
    <div class="tp-line"></div>
    <div class="tp-row"><span>CAE</span><span>${escapeHtml(factura.cae)}</span></div>
    <div class="tp-row"><span>Vto. CAE</span><span>${fmtFecha(factura.cae_vencimiento)}</span></div>
    ${factura.ambiente === 'homologacion' ? '<div class="tp-center" style="font-size:9.5px;color:#B85B5D;margin-top:4px;">AMBIENTE DE PRUEBAS — no es una factura real</div>' : ''}
    <div class="tp-center" style="margin-top:8px;"><div id="ticketQr"></div></div>
  ` : '';
  document.getElementById('ticketContent').innerHTML = `
    <div class="tp-center" style="font-weight:700;font-size:14px;">${escapeHtml(bizName)}</div>
    <div class="tp-center" style="font-size:10px;color:#666;">${escapeHtml(numeroTxt)}</div>
    <div class="tp-line"></div>
    <div class="tp-row"><span>${fmtFecha(e.fecha)}</span><span>${escapeHtml(e.hora)}</span></div>
    <div class="tp-line"></div>
    <div>${escapeHtml(e.descripcion)}</div>
    ${cantidadLinea}
    <div class="tp-line"></div>
    <div class="tp-row tp-total"><span>TOTAL</span><span>${fmtMoney(e.monto)}</span></div>
    <div class="tp-row" style="margin-top:4px;"><span>Pago</span><span>${escapeHtml(e.metodoPago)}</span></div>
    ${fiscalBlock}
    <div class="tp-line"></div>
    <div class="tp-center" style="font-size:10px;color:#666;">¡Gracias por tu compra!</div>
  `;
  if(emitida && window.QRCode && facturacionConfig){
    new QRCode(document.getElementById('ticketQr'), { text: armarQrArca({
      monto: factura.monto, tipoComprobante: factura.tipo_comprobante, puntoVenta: factura.punto_venta,
      numero: factura.numero, cae: factura.cae, fechaEmision: factura.fecha_emision,
    }), width: 108, height: 108, correctLevel: QRCode.CorrectLevel.M });
  }
  renderFacturarActions(e);
  document.getElementById('ticketModal').style.display = 'flex';
}
document.getElementById('ticketCloseBtn').addEventListener('click', ()=>{
  document.getElementById('ticketModal').style.display = 'none';
});
document.getElementById('ticketPrintBtn').addEventListener('click', ()=>{ window.print(); });
document.getElementById('ticketModal').addEventListener('click', (e)=>{
  if(e.target.id === 'ticketModal') document.getElementById('ticketModal').style.display = 'none';
});

// ============================================================
// Inicio / Resumen enriquecido: lectura en lenguaje claro ("Cómo venís"),
// tarjetas con variación vs el período anterior, gráfico interactivo que
// sigue el toggle Hoy/Mes, y avisos accionables. Todo con los datos ya
// cargados -- sin red ni API, el mismo análisis que usa el motor de Tiki.
// ============================================================

// Íconos de línea (en badge de color, nunca emoji -- ver CLAUDE.md).
const ICO_REPONER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>';
const ICO_ALERTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>';
const ICO_SUBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>';
const ICO_BAJA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l6 6 4-4 8 8"/><path d="M14 17h7v-7"/></svg>';
const ICO_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const ICO_OK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/></svg>';
const ICO_CELU = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>';
const ICO_CALENDARIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const ARROW_UP = '<svg class="delta-ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
const ARROW_DOWN = '<svg class="delta-ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M6 13l6 6 6-6"/></svg>';

// --- Período elegido y su comparable (ayer si es Hoy, el mes pasado si es Mes) ---
function ayerDe(fechaISO){
  const d = new Date(fechaISO + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function mesAnteriorDe(mesISO){
  const [y,m] = mesISO.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}
function entriesDelScope(scope){
  const hoy = todayStr();
  if(scope === 'mes'){
    const mes = hoy.slice(0,7), prev = mesAnteriorDe(mes);
    return {
      actual: entries.filter(e => e.fecha && e.fecha.slice(0,7) === mes),
      anterior: entries.filter(e => e.fecha && e.fecha.slice(0,7) === prev),
      labelAnterior: 'el mes pasado'
    };
  }
  const ayer = ayerDe(hoy);
  return {
    actual: entries.filter(e => e.fecha === hoy),
    anterior: entries.filter(e => e.fecha === ayer),
    labelAnterior: 'ayer'
  };
}
function calcPeriodo(list){
  const ventasArr = list.filter(e => e.tipo === 'Venta');
  const ventas = ventasArr.reduce((s,e)=>s+e.monto,0);
  const gastos = list.filter(e=>e.tipo==='Gasto').reduce((s,e)=>s+e.monto,0);
  const costoMerc = ventasArr.reduce((s,e)=>s + (parseFloat(e.costoTotal) || 0), 0);
  return {
    ventas, gastos, costoMerc, gananciaReal: ventas - costoMerc - gastos,
    nMov: list.length, nVentas: ventasArr.length,
    ventasSinCosto: ventasArr.filter(e => !(parseFloat(e.costoTotal) > 0)).length
  };
}
// % de cambio actual vs anterior. null = sin base de comparación (el período
// anterior está en cero): no inventamos "+100%" ni récords sin con qué comparar.
function pctCambio(actual, anterior){
  if(!(anterior > 0)) return null;
  return Math.round((actual - anterior) / anterior * 100);
}

// Chip de variación para las tarjetas. buenoSiSube: true (ventas/ganancia),
// false (gastos), null (sin juicio de valor -> neutro).
function deltaChip(pct, buenoSiSube, labelAnt){
  if(pct === null) return `<span class="delta delta-none">sin ${labelAnt} para comparar</span>`;
  if(pct === 0) return `<span class="delta delta-flat">igual que ${labelAnt}</span>`;
  const sube = pct > 0;
  const cls = buenoSiSube === null ? 'delta-neutral' : (sube === buenoSiSube ? 'delta-up' : 'delta-down');
  return `<span class="delta ${cls}">${sube ? ARROW_UP : ARROW_DOWN}${Math.abs(pct)}% <span class="delta-vs">vs ${labelAnt}</span></span>`;
}

// Panel "Cómo venís": el período leído en una frase, sin jerga. El número
// grande es lo que entró; la frase explica qué quedó y si vas mejor o peor.
function renderComoVenis(scope, act, ant){
  const el = document.getElementById('comoVenis');
  if(!el) return;
  const esMes = scope === 'mes', corto = esMes ? 'este mes' : 'hoy', vsAnt = esMes ? 'el mes pasado' : 'ayer';
  if(act.nMov === 0){
    el.innerHTML = `
      <div class="cv-inner">
        <div class="cv-eyebrow">Cómo venís</div>
        <div class="cv-headline">Cargá un movimiento y ${corto} vas a ver cómo viene el negocio</div>
        <p class="cv-text">Con cada venta y gasto, acá te lo resumo en una frase: cuánto entró, cuánto te quedó de verdad y si vas mejor que ${vsAnt}.</p>
        <button type="button" class="cv-cta" onclick="switchView('cargar')">Cargar mi primer movimiento</button>
      </div>`;
    return;
  }
  let fraseGan;
  if(act.nVentas === 0){
    fraseGan = `Por ahora solo cargaste gastos (${fmtMoney(act.gastos)}) y ninguna venta ${corto}.`;
  } else if(act.gananciaReal >= 0){
    fraseGan = `Después de la mercadería y los gastos, te quedaron <strong class="cv-pos">${fmtMoney(act.gananciaReal)}</strong> de ganancia real.`;
  } else {
    fraseGan = `Ojo: los costos y gastos superan a las ventas, así que vas <strong class="cv-neg">${fmtMoney(act.gananciaReal)}</strong> ${corto}.`;
  }
  const dV = pctCambio(act.ventas, ant.ventas), dG = pctCambio(act.gananciaReal, ant.gananciaReal);
  const base = dV !== null ? { d: dV, q: 'en ventas' } : (dG !== null ? { d: dG, q: 'en ganancia' } : null);
  let fraseComp;
  if(!base) fraseComp = ` Todavía no tengo ${vsAnt} para comparar.`;
  else if(base.d === 0) fraseComp = ` Vas parejo con ${vsAnt}.`;
  else { const mejor = base.d > 0; fraseComp = ` Vas un <strong class="${mejor?'cv-pos':'cv-neg'}">${Math.abs(base.d)}% ${mejor?'mejor':'peor'}</strong> que ${vsAnt} ${base.q}.`; }
  el.innerHTML = `
    <div class="cv-inner">
      <div class="cv-eyebrow">Cómo venís · ${corto}</div>
      <div class="cv-headline">Vendiste <span class="cv-big">${fmtMoney(act.ventas)}</span></div>
      <p class="cv-text">${fraseGan}${fraseComp}</p>
    </div>`;
}

// --- Datos del gráfico según el toggle: por hora (Hoy) o por día (Mes) ---
// Cada punto trae además `prev`: lo mismo en el período anterior comparable
// (ayer a esa hora, o el mes pasado ese día), para superponerlo y ver de un
// vistazo si vas por encima o por debajo. null = no hay con qué comparar.
function sumarVentasPorHora(fecha){
  const m = {};
  entries.filter(e => e.tipo === 'Venta' && e.fecha === fecha).forEach(e => {
    const h = /^(\d{1,2}):/.exec(e.hora || '');
    if(h) m[Number(h[1])] = (m[Number(h[1])] || 0) + e.monto;
  });
  return m;
}
function ventasPorHoraDeHoy(){
  const hoy = todayStr(), ayer = ayerDe(hoy);
  const porHora = sumarVentasPorHora(hoy), prevPorHora = sumarVentasPorHora(ayer);
  let sinHora = 0;
  entries.filter(e => e.tipo === 'Venta' && e.fecha === hoy).forEach(e => { if(!/^(\d{1,2}):/.test(e.hora || '')) sinHora += 1; });
  const horas = Object.keys(porHora).map(Number);
  if(!horas.length) return { puntos: [], sinHora };
  const min = Math.min(...horas), max = Math.max(...horas), puntos = [];
  for(let h = min; h <= max; h++){
    puntos.push({ label: `${h}h`, total: porHora[h] || 0, prev: (h in prevPorHora) ? prevPorHora[h] : null, sub: `${String(h).padStart(2,'0')}:00 a ${String(h+1).padStart(2,'0')}:00` });
  }
  return { puntos, sinHora };
}
function ventasPorDiaDelMes(){
  const hoy = todayStr(), mes = hoy.slice(0,7), diaHoy = Number(hoy.slice(8,10)), prevMes = mesAnteriorDe(mes);
  const porDia = {}, prevPorDia = {};
  entries.filter(e => e.tipo === 'Venta' && e.fecha).forEach(e => {
    const mm = e.fecha.slice(0,7), d = Number(e.fecha.slice(8,10));
    if(mm === mes) porDia[d] = (porDia[d] || 0) + e.monto;
    else if(mm === prevMes) prevPorDia[d] = (prevPorDia[d] || 0) + e.monto;
  });
  const puntos = [];
  for(let d = 1; d <= diaHoy; d++){
    puntos.push({ label: String(d), total: porDia[d] || 0, prev: (d in prevPorDia) ? prevPorDia[d] : null, sub: fmtFecha(`${mes}-${String(d).padStart(2,'0')}`) });
  }
  return { puntos, sinHora: 0 };
}
// Dibuja el gráfico interactivo: barras + línea de promedio + mejor punto
// resaltado + tooltip al pasar/tocar. Vacío = estado claro, no una caja muda.
function pintarGraficoInicio(puntos, sinHora){
  const wrap = document.getElementById('salesChart');
  if(!wrap) return;
  const vals = puntos.map(p => p.total);
  const prevVals = puntos.map(p => (p.prev != null ? p.prev : 0));
  const max = Math.max(...vals, ...prevVals, 0);
  if(!puntos.length || max === 0){
    wrap.innerHTML = `<div class="isc-empty">${summaryScope === 'mes'
      ? 'Todavía no registraste ventas este mes para graficar.'
      : 'Todavía no registraste ventas hoy. Cuando cargues la primera, la vas a ver acá hora por hora.'}</div>`;
    wrap.onpointerover = wrap.onclick = wrap.onpointerleave = null;
    return;
  }
  // Comparación con el período anterior: solo si hay algo con qué comparar.
  const hayPrev = puntos.some(p => p.prev != null && p.prev > 0);
  const vsLabel = summaryScope === 'mes' ? 'mes pasado' : 'ayer';
  const curLabel = summaryScope === 'mes' ? 'este mes' : 'hoy';
  const conVenta = vals.filter(v => v > 0);
  const prom = conVenta.length ? conVenta.reduce((a,b)=>a+b,0) / conVenta.length : 0;
  const curMax = Math.max(...vals, 0);
  const idxMax = curMax > 0 ? vals.indexOf(curMax) : -1;
  const promPct = max > 0 ? (prom / max * 100) : 0;
  wrap.innerHTML = `
    <div class="isc-plot">
      ${prom > 0 ? `<div class="isc-avg" style="bottom:${promPct.toFixed(1)}%"><span class="isc-avg-lbl">prom. ${fmtMoneyCompact(prom)}</span></div>` : ''}
      ${puntos.map((p,i) => `
        <div class="isc-col${i === idxMax ? ' is-top' : ''}${p.total === 0 ? ' is-zero' : ''}" data-label="${escapeHtml(p.sub || p.label)}" data-val="${escapeHtml(fmtMoney(p.total))}" data-prev="${p.prev != null ? escapeHtml(fmtMoney(p.prev)) : ''}">
          <div class="isc-barwrap"><div class="isc-bar" style="height:${p.total ? Math.max(3, p.total / max * 100) : 0}%"></div></div>
          ${hayPrev && p.prev != null && p.prev > 0 ? `<div class="isc-ghost" style="bottom:${(p.prev / max * 100).toFixed(1)}%"></div>` : ''}
        </div>`).join('')}
    </div>
    <div class="isc-xrow">${puntos.map(p => `<div class="isc-x">${escapeHtml(p.label)}</div>`).join('')}</div>
    ${hayPrev ? `<div class="isc-legend"><span class="isc-leg"><i class="isc-leg-cur"></i>${curLabel}</span><span class="isc-leg"><i class="isc-leg-prev"></i>${vsLabel}</span></div>` : ''}
    ${sinHora ? `<div class="isc-note">+ ${sinHora} venta${sinHora > 1 ? 's' : ''} sin hora cargada (no ${sinHora > 1 ? 'entran' : 'entra'} en este gráfico)</div>` : ''}
    <div class="isc-tip" id="iscTip" hidden></div>`;
  const tip = wrap.querySelector('#iscTip');
  const mostrar = (col) => {
    if(!col || !tip) return;
    wrap.querySelectorAll('.isc-col.is-active').forEach(c => c.classList.remove('is-active'));
    col.classList.add('is-active');
    tip.innerHTML = `<span class="isc-tip-k">${col.dataset.label}</span><span class="isc-tip-v">${col.dataset.val}</span>`
      + (col.dataset.prev ? `<span class="isc-tip-p">${vsLabel}: ${col.dataset.prev}</span>` : '');
    tip.hidden = false;
    const wr = wrap.getBoundingClientRect(), cr = col.getBoundingClientRect();
    tip.style.left = Math.round(cr.left - wr.left + cr.width / 2) + 'px';
  };
  wrap.onpointerover = (e) => { const c = e.target.closest('.isc-col'); if(c) mostrar(c); };
  wrap.onclick = (e) => { const c = e.target.closest('.isc-col'); if(c) mostrar(c); };
  wrap.onpointerleave = () => { if(tip) tip.hidden = true; wrap.querySelectorAll('.isc-col.is-active').forEach(c => c.classList.remove('is-active')); };
}

// Avisos accionables en lenguaje claro. Devuelve a lo sumo lo relevante; el
// render corta en 4 para no abrumar.
function construirAvisosInicio(scope, act, ant){
  const avisos = [];
  if(moduloActivo('catalogo') && typeof calcularListaCompras === 'function'){
    const lista = calcularListaCompras();
    if(lista.length){
      const urgentes = lista.filter(i => i.motivo === 'bajo-minimo' || (i.daysLeft != null && i.daysLeft <= 2)).length;
      avisos.push({ nivel: urgentes ? 'urgente' : 'pronto', icon: ICO_REPONER,
        titulo: `${lista.length} producto${lista.length > 1 ? 's' : ''} para reponer`,
        texto: urgentes
          ? `${urgentes} ya ${urgentes > 1 ? 'están en el mínimo o se agotan' : 'está en el mínimo o se agota'} enseguida.`
          : 'Según lo que vendiste en las últimas dos semanas.',
        accion: { label: 'Ver la lista', fn: 'openRestockList()' } });
    }
  }
  const dG = pctCambio(act.gananciaReal, ant.gananciaReal);
  if(act.nVentas > 0 && act.gananciaReal < 0){
    avisos.push({ nivel: 'urgente', icon: ICO_ALERTA, titulo: 'La ganancia está en rojo',
      texto: `${scope === 'mes' ? 'Este mes' : 'Hoy'} los costos y gastos superan a las ventas (${fmtMoney(act.gananciaReal)}). Mirá los gastos más grandes.`,
      accion: { label: 'Ver movimientos', fn: "switchView('historial')" } });
  } else if(dG !== null && dG <= -15){
    avisos.push({ nivel: 'pronto', icon: ICO_BAJA, titulo: `Ganancia ${Math.abs(dG)}% abajo`,
      texto: `Vas por debajo de ${scope === 'mes' ? 'el mes pasado' : 'ayer'}. Puede ser que subieran los gastos o bajaran las ventas.` });
  } else if(dG !== null && dG >= 15){
    avisos.push({ nivel: 'bien', icon: ICO_SUBE, titulo: `Ganancia ${dG}% arriba`,
      texto: `Vas mejor que ${scope === 'mes' ? 'el mes pasado' : 'ayer'}. Buen momento para reponer lo que más sale.` });
  }
  if(act.nVentas > 0 && act.ventasSinCosto > 0){
    avisos.push({ nivel: 'info', icon: ICO_INFO,
      titulo: `${act.ventasSinCosto} venta${act.ventasSinCosto > 1 ? 's' : ''} sin costo cargado`,
      texto: 'Sin el costo no puedo calcular bien tu ganancia real. Cargalo al registrar la venta.' });
  }
  if(moduloActivo('equipos') && typeof equipos !== 'undefined' && equipos){
    const pend = equipos.filter(e => e.estado === 'reservado' || e.estado === 'reparacion').length;
    if(pend){
      avisos.push({ nivel: 'info', icon: ICO_CELU, titulo: `${pend} equipo${pend > 1 ? 's' : ''} para seguir`,
        texto: 'Tenés equipos reservados o en reparación esperando.', accion: { label: 'Ver equipos', fn: "switchView('equipos')" } });
    }
  }
  return avisos;
}
function tarjetasAvisos(avisos, scope){
  if(!avisos.length){
    return `<div class="insight insight-bien"><span class="insight-ic">${ICO_OK}</span><div class="insight-body"><div class="insight-title">Todo en orden</div><div class="insight-text">No hay nada urgente ${scope === 'mes' ? 'este mes' : 'hoy'}. Seguí cargando tus ventas y gastos.</div></div></div>`;
  }
  return avisos.map(a => `
    <div class="insight insight-${a.nivel}">
      <span class="insight-ic">${a.icon}</span>
      <div class="insight-body">
        <div class="insight-title">${escapeHtml(a.titulo)}</div>
        <div class="insight-text">${a.texto}</div>
        ${a.accion ? `<button type="button" class="insight-btn" onclick="${a.accion.fn}">${escapeHtml(a.accion.label)}</button>` : ''}
      </div>
    </div>`).join('');
}
function renderInsightsInicio(scope, act, ant){
  const cont = document.getElementById('insightsInicio');
  if(!cont) return;
  if(act.nMov === 0){ cont.innerHTML = ''; cont.dataset.scope = ''; return; }
  const avisos = construirAvisosInicio(scope, act, ant).slice(0, 4);
  const head = '<div class="insights-head">Para mirar</div>';
  cont.innerHTML = head + tarjetasAvisos(avisos, scope);
  cont.dataset.scope = scope;
  // Feriado próximo: lo trae el motor de Tiki (async). Se suma cuando llega,
  // sin trabar el resto del Inicio ni duplicarse si cambió el período.
  if(typeof tikiProximoFeriado === 'function' && avisos.length < 4){
    tikiProximoFeriado().then(f => {
      if(!f || cont.dataset.scope !== scope) return;
      const dias = Math.round((new Date(f.fecha + 'T12:00:00') - new Date(todayStr() + 'T12:00:00')) / 86400000);
      if(dias < 0 || dias > 7) return;
      const aviso = { nivel: 'info', icon: ICO_CALENDARIO,
        titulo: dias === 0 ? 'Hoy es feriado' : (dias === 1 ? 'Mañana es feriado' : `Feriado en ${dias} días`),
        texto: `${escapeHtml(f.nombre || 'Feriado')}. Si abrís, revisá el stock de lo que más sale y avisá a tus proveedores si cambian las entregas.` };
      cont.innerHTML = head + tarjetasAvisos(avisos.slice(0, 3).concat([aviso]), scope);
    }).catch(() => {});
  }
}

function renderSummary(){
  const today = todayStr();
  const { actual: summaryEntries, anterior: prevEntries, labelAnterior } = entriesDelScope(summaryScope);
  const scopeLabel = summaryScope === 'mes' ? 'del mes' : 'hoy';
  const act = calcPeriodo(summaryEntries);
  const ant = calcPeriodo(prevEntries);
  const ventasS = act.ventas, gastosS = act.gastos, costoMercS = act.costoMerc, gananciaRealS = act.gananciaReal;

  renderComoVenis(summaryScope, act, ant);

  document.getElementById('summary').innerHTML = `
    <div class="metric metric-venta"><div class="metric-label">Ventas ${scopeLabel}</div><div class="metric-value" style="color:var(--venta)">${fmtMoney(ventasS)}</div><div class="metric-delta">${deltaChip(pctCambio(act.ventas, ant.ventas), true, labelAnterior)}</div></div>
    <div class="metric metric-accent"><div class="metric-label">Costo mercadería</div><div class="metric-value" style="color:var(--accent-dark)">${fmtMoney(costoMercS)}</div><div class="metric-delta">${deltaChip(pctCambio(act.costoMerc, ant.costoMerc), null, labelAnterior)}</div></div>
    <div class="metric metric-gasto"><div class="metric-label">Gastos ${scopeLabel}</div><div class="metric-value" style="color:var(--gasto)">${fmtMoney(gastosS)}</div><div class="metric-delta">${deltaChip(pctCambio(act.gastos, ant.gastos), false, labelAnterior)}</div></div>
    <div class="metric" style="border:1.5px solid ${gananciaRealS >= 0 ? 'var(--gold)' : 'var(--gasto)'};background:linear-gradient(${gananciaRealS >= 0 ? 'var(--gold-bg),var(--gold-bg)' : 'var(--gasto-bg),var(--gasto-bg)'}),var(--card);"><div class="metric-label" style="font-weight:700;">Ganancia real ${scopeLabel}</div><div class="metric-value" style="color:${gananciaRealS >= 0 ? 'var(--gold)' : 'var(--gasto)'};font-size:22px;">${fmtMoney(gananciaRealS)}</div><div class="metric-delta">${deltaChip(pctCambio(act.gananciaReal, ant.gananciaReal), true, labelAnterior)}</div></div>
    <div class="metric"><div class="metric-label">Movimientos ${scopeLabel}</div><div class="metric-value">${act.nMov}</div><div class="metric-delta">${deltaChip(pctCambio(act.nMov, ant.nMov), null, labelAnterior)}</div></div>
  `;

  renderInsightsInicio(summaryScope, act, ant);

  const totalMovS = ventasS + gastosS;
  const ventaPctS = totalMovS > 0 ? (ventasS/totalMovS*100) : 50;
  document.getElementById('segVenta').style.width = ventaPctS + '%';
  document.getElementById('segGasto').style.width = (100-ventaPctS) + '%';

  const metodosPresentes = ['Efectivo','Tarjeta','Transferencia','Otro'].filter(m =>
    summaryEntries.some(e => e.metodoPago === m)
  );
  const paymentBlock = document.getElementById('paymentBreakdown');
  if(metodosPresentes.length === 0){
    paymentBlock.innerHTML = '';
  }else{
    const itemsHtml = metodosPresentes.map(m => {
      const saldo = summaryEntries
        .filter(e => e.metodoPago === m)
        .reduce((s,e) => s + (e.tipo === 'Venta' ? e.monto : -e.monto), 0);
      return `
        <div class="payment-item">
          <div class="payment-item-label">${metodoDot(m)}${m}</div>
          <div class="payment-item-value" style="color:${saldo >= 0 ? 'var(--venta)' : 'var(--gasto)'}">${fmtMoney(saldo)}</div>
        </div>
      `;
    }).join('');
    paymentBlock.innerHTML = `
      <div class="payment-block">
        <div class="payment-block-label">Saldo por método de pago · ${scopeLabel}</div>
        <div class="payment-row">${itemsHtml}</div>
      </div>
    `;
  }

  const productMap = {};
  summaryEntries.filter(e => e.tipo === 'Venta').forEach(e => {
    const key = (e.descripcion || '').trim().toLowerCase();
    if(!key) return;
    if(!productMap[key]) productMap[key] = { nombre: e.descripcion.trim(), monto: 0 };
    productMap[key].monto += e.monto;
  });
  const topProducts = Object.values(productMap).sort((a,b)=>b.monto-a.monto).slice(0,5);
  const maxProductMonto = topProducts.length ? topProducts[0].monto : 0;
  const topList = document.getElementById('topProductsList');
  if(topProducts.length === 0){
    topList.innerHTML = `<div class="top-product-empty">Todavía no hay ventas ${scopeLabel} para armar el ranking.</div>`;
  }else{
    topList.innerHTML = topProducts.map((p,i) => `
      <div class="top-product-row">
        <div class="top-product-rank">${i+1}</div>
        <div class="top-product-name">${escapeHtml(p.nombre)}</div>
        <div class="top-product-bar-wrap"><div class="top-product-bar" style="width:${maxProductMonto ? (p.monto/maxProductMonto*100) : 0}%;"></div></div>
        <div class="top-product-amount">${fmtMoney(p.monto)}</div>
      </div>
    `).join('');
  }

  renderSalesChart();
}

// Gráfico del Inicio: sigue el toggle Hoy/Mes. En "Hoy" muestra las ventas
// hora por hora; en "Este mes", día por día. Así nunca queda vacío si hay
// ventas en el período elegido (antes era una semana fija que podía estar en
// cero aunque el mes tuviera datos). El dibujo lo hace pintarGraficoInicio.
function renderSalesChart(){
  const titleEl = document.getElementById('salesChartTitle');
  const esMes = summaryScope === 'mes';
  if(titleEl) titleEl.textContent = esMes ? 'Ventas de este mes, día por día' : 'Ventas de hoy, hora por hora';
  const { puntos, sinHora } = esMes ? ventasPorDiaDelMes() : ventasPorHoraDeHoy();
  pintarGraficoInicio(puntos, sinHora);
}

// Formato corto para las etiquetas del grafico ($5.2k en vez de $5.200,00):
// con 7 columnas angostas no entra el monto completo sin que se vea apretado.
function fmtMoneyCompact(n){
  const v = Number(n) || 0;
  if(v >= 1000){
    const k = v/1000;
    return '$' + (k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/,'')) + 'k';
  }
  return '$' + Math.round(v);
}

// ============================================
// Cierre de caja: cuanto efectivo deberia haber segun lo cargado (ventas
// menos gastos en efectivo de ese dia) contra lo que el kiosquero cuenta
// a mano, para detectar diferencias de caja el mismo dia que pasan. Vive
// en su propia vista (viewCaja) en vez de adentro de Inicio o Historial,
// para que tenga lugar para crecer sin volverse un cajon de sastre.
// ============================================
let cierreCajaFechaActiva = null;

function efectivoEsperadoDe(fecha){
  return entries
    .filter(e => e.fecha === fecha && e.metodoPago === 'Efectivo')
    .reduce((s,e) => s + (e.tipo === 'Venta' ? e.monto : -e.monto), 0);
}
function cierreDeFecha(fecha){
  return cierresCaja.find(c => c.fecha === fecha) || null;
}

// Punto de entrada al abrir la vista: carga el formulario en la fecha de
// hoy (o la que haya quedado seleccionada) y refresca todo lo demas.
function openCajaView(){
  loadCierreFormForFecha(cierreCajaFechaActiva || todayStr());
  renderCajaMetrics();
  renderCajaDiffChart();
  renderCierresCajaList();
}

function loadCierreFormForFecha(fecha){
  cierreCajaFechaActiva = fecha;
  const existente = cierreDeFecha(fecha);
  const esperado = efectivoEsperadoDe(fecha);
  document.getElementById('cierreCajaFechaInput').value = fecha;
  const esperadoEl = document.getElementById('cierreEsperadoValue');
  esperadoEl.textContent = fmtMoney(esperado);
  esperadoEl.dataset.raw = String(esperado);
  document.getElementById('cierreContado').value = existente ? existente.efectivo_contado : '';
  document.getElementById('cierreNotas').value = existente ? (existente.notas || '') : '';
  document.getElementById('cierreCajaErrorMsg').textContent = '';
  document.getElementById('cierreCajaSubmitBtn').textContent = existente ? 'Guardar cambios' : 'Guardar cierre';
  updateCierreDiferenciaLive();
}

function updateCierreDiferenciaLive(){
  const esperado = parseFloat(document.getElementById('cierreEsperadoValue').dataset.raw || '0');
  const contadoRaw = document.getElementById('cierreContado').value;
  const contado = parseFloat(contadoRaw);
  const dif = (isNaN(contado) ? 0 : contado) - esperado;
  const el = document.getElementById('cierreDiferenciaValue');
  el.textContent = fmtMoney(dif);
  el.style.color = dif === 0 ? 'var(--venta)' : 'var(--gasto)';
}

document.getElementById('cierreCajaFechaInput').addEventListener('change', (e)=>{
  loadCierreFormForFecha(e.target.value || todayStr());
});
document.getElementById('cierreCajaLimpiarBtn').addEventListener('click', ()=>{
  loadCierreFormForFecha(todayStr());
});
document.getElementById('cierreContado').addEventListener('input', updateCierreDiferenciaLive);

document.getElementById('cierreCajaSubmitBtn').addEventListener('click', async ()=>{
  const errEl = document.getElementById('cierreCajaErrorMsg');
  const contado = parseFloat(document.getElementById('cierreContado').value);
  if(isNaN(contado) || contado < 0){ errEl.textContent = 'Ingresá cuánto efectivo contaste.'; return; }
  errEl.textContent = '';

  const fecha = cierreCajaFechaActiva || todayStr();
  const esperado = efectivoEsperadoDe(fecha);
  const fields = {
    fecha,
    efectivo_esperado: esperado,
    efectivo_contado: contado,
    diferencia: contado - esperado,
    notas: document.getElementById('cierreNotas').value.trim() || null
  };

  const btn = document.getElementById('cierreCajaSubmitBtn');
  btn.disabled = true;
  const existing = cierreDeFecha(fecha);
  const ok = existing ? await updateCierreCaja(existing.id, fields) : await addCierreCaja(fields);
  btn.disabled = false;
  if(ok){
    showToast('Cierre de caja guardado');
    loadCierreFormForFecha(fecha);
    renderCajaMetrics();
    renderCajaDiffChart();
    renderCierresCajaList();
  }
});

// Metricas profesionales: total de cierres, diferencia promedio y cuantos
// dias no dieron exacto, sobre los ultimos 30 cierres cargados.
function renderCajaMetrics(){
  const wrap = document.getElementById('cajaMetrics');
  if(!wrap) return;
  const ultimos30 = [...cierresCaja].sort((a,b)=>b.fecha.localeCompare(a.fecha)).slice(0,30);
  const total = cierresCaja.length;
  const promedioDif = ultimos30.length ? ultimos30.reduce((s,c)=>s+(Number(c.diferencia)||0),0)/ultimos30.length : 0;
  const conDiferencia = ultimos30.filter(c => Number(c.diferencia) !== 0).length;
  wrap.innerHTML = `
    <div class="metric" style="border-left-color:var(--caja);"><div class="metric-label">Cierres registrados</div><div class="metric-value" style="color:var(--caja);">${total}</div></div>
    <div class="metric" style="border-left-color:${promedioDif === 0 ? 'var(--venta)' : 'var(--gasto)'};"><div class="metric-label">Diferencia promedio (30 últimos)</div><div class="metric-value" style="color:${promedioDif === 0 ? 'var(--venta)' : 'var(--gasto)'};">${fmtMoney(promedioDif)}</div></div>
    <div class="metric" style="border-left-color:${conDiferencia === 0 ? 'var(--venta)' : 'var(--gasto)'};"><div class="metric-label">Días con diferencia (30 últimos)</div><div class="metric-value" style="color:${conDiferencia === 0 ? 'var(--venta)' : 'var(--gasto)'};">${conDiferencia} de ${ultimos30.length}</div></div>
  `;
}

// Grafico de barras reutilizando el mismo look que "Ventas de los ultimos
// 7 dias": una barra por cierre (los ultimos 14, mas viejo a mas nuevo),
// altura segun el tamaño de la diferencia (en valor absoluto), verde si
// dio justo y roja si falto o sobro plata.
function renderCajaDiffChart(){
  const wrap = document.getElementById('cajaDiffChart');
  if(!wrap) return;
  const ultimos14 = [...cierresCaja].sort((a,b)=>a.fecha.localeCompare(b.fecha)).slice(-14);
  if(ultimos14.length === 0){
    wrap.innerHTML = `<div class="sales-chart-empty">Todavía no hay cierres para graficar.</div>`;
    return;
  }
  const max = Math.max(...ultimos14.map(c => Math.abs(Number(c.diferencia)||0)), 1);
  wrap.innerHTML = ultimos14.map(c => {
    const dif = Number(c.diferencia) || 0;
    const abs = Math.abs(dif);
    const [y,m,d] = c.fecha.split('-');
    return `
      <div class="sales-chart-col">
        <div class="sales-chart-bar-wrap">
          <div class="sales-chart-bar${dif !== 0 ? ' is-negative' : ''}" style="height:${abs ? Math.max(6, abs/max*100) : 4}%;" title="${fmtFecha(c.fecha)}: ${fmtMoney(dif)}">${abs ? `<span class="sales-chart-val">${fmtMoneyCompact(abs)}</span>` : ''}</div>
        </div>
        <div class="sales-chart-day">${d}/${m}</div>
      </div>
    `;
  }).join('');
}

// Historial completo (no solo los ultimos dias): cada fila se puede tocar
// para cargarla en el formulario de arriba y editarla, o borrarla.
function renderCierresCajaList(){
  const list = document.getElementById('cierresCajaList');
  const empty = document.getElementById('cierresCajaEmpty');
  if(!list || !empty) return;
  if(cierresCaja.length === 0){
    empty.style.display = 'block';
    list.innerHTML = '';
    return;
  }
  empty.style.display = 'none';
  const ordenados = [...cierresCaja].sort((a,b)=>b.fecha.localeCompare(a.fecha));
  list.innerHTML = ordenados.map(c => {
    const dif = Number(c.diferencia) || 0;
    return `
      <div class="ticket-item" style="cursor:pointer;" onclick="loadCierreFormForFecha('${c.fecha}')">
        <div class="ti-left">
          <div class="ti-desc">${fmtFecha(c.fecha)}</div>
          <div class="ti-meta">Esperado ${fmtMoney(c.efectivo_esperado)} · Contado ${fmtMoney(c.efectivo_contado)}${c.notas ? ' · ' + escapeHtml(c.notas) : ''}</div>
        </div>
        <div class="ti-right">
          <span style="font-family:'IBM Plex Mono';font-size:13px;font-weight:600;color:${dif === 0 ? 'var(--venta)' : 'var(--gasto)'};">${fmtMoney(dif)}</span>
          <button class="ti-del" aria-label="Eliminar cierre" onclick="event.stopPropagation();deleteCierreCaja('${c.id}')">&times;</button>
        </div>
      </div>
    `;
  }).join('');
}

async function deleteCierreCaja(id){
  if(!confirm('¿Seguro que querés borrar este cierre? Esta acción no se puede deshacer.')) return;
  try{
    const { error } = await sb.from('cierres_caja').delete().eq('id', id).eq('user_id', currentUserId);
    if(error){ console.error(error); showToast('No se pudo eliminar'); return; }
    cierresCaja = cierresCaja.filter(c => String(c.id) !== String(id));
    if(cierreCajaFechaActiva && !cierreDeFecha(cierreCajaFechaActiva)) loadCierreFormForFecha(cierreCajaFechaActiva);
    renderCajaMetrics();
    renderCajaDiffChart();
    renderCierresCajaList();
    showToast('Cierre eliminado');
  }catch(err){ console.error(err); showToast('No se pudo eliminar'); }
}

// ============================================
// Calculadora de IVA: no depende de ningun servicio externo, es solo
// matematica -- por eso no necesita fetch ni manejo de errores de red.
// ============================================
let ivaModo = 'agregar';
let ivaAlicuota = 21;

function setIvaModo(modo){
  ivaModo = modo;
  document.getElementById('ivaModoAgregar').className = 'type-btn' + (modo === 'agregar' ? ' active-accent' : '');
  document.getElementById('ivaModoQuitar').className = 'type-btn' + (modo === 'quitar' ? ' active-accent' : '');
  document.getElementById('ivaMontoLabel').textContent = modo === 'agregar' ? 'Monto sin IVA' : 'Monto con IVA';
  calcularIva();
}
document.getElementById('ivaModoAgregar').addEventListener('click', ()=>setIvaModo('agregar'));
document.getElementById('ivaModoQuitar').addEventListener('click', ()=>setIvaModo('quitar'));

document.querySelectorAll('#ivaAlicuotaToggle .type-btn').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    ivaAlicuota = parseFloat(btn.dataset.alicuota);
    document.querySelectorAll('#ivaAlicuotaToggle .type-btn').forEach(b => b.classList.toggle('active-accent', b === btn));
    calcularIva();
  });
});
document.getElementById('ivaMonto').addEventListener('input', calcularIva);

function calcularIva(){
  const monto = parseFloat(document.getElementById('ivaMonto').value) || 0;
  const factor = ivaAlicuota / 100;
  const alicuotaLabel = String(ivaAlicuota).replace('.', ',') + '%';
  if(ivaModo === 'agregar'){
    const iva = monto * factor;
    document.getElementById('ivaResultLabel1').textContent = `IVA (${alicuotaLabel})`;
    document.getElementById('ivaResultValue1').textContent = fmtMoney(iva);
    document.getElementById('ivaResultLabel2').textContent = 'Total con IVA';
    document.getElementById('ivaResultValue2').textContent = fmtMoney(monto + iva);
  }else{
    const neto = monto / (1 + factor);
    document.getElementById('ivaResultLabel1').textContent = `IVA (${alicuotaLabel})`;
    document.getElementById('ivaResultValue1').textContent = fmtMoney(monto - neto);
    document.getElementById('ivaResultLabel2').textContent = 'Monto sin IVA';
    document.getElementById('ivaResultValue2').textContent = fmtMoney(neto);
  }
}

async function addCierreCaja(fields){
  try{
    const { data, error } = await sb.from('cierres_caja').insert({ user_id: currentUserId, ...fields }).select().single();
    if(error){ console.error(error); showToast('No se pudo guardar el cierre'); return null; }
    cierresCaja.unshift(data);
    return data;
  }catch(err){ console.error(err); showToast('No se pudo guardar el cierre'); return null; }
}
async function updateCierreCaja(id, fields){
  try{
    const { data, error } = await sb.from('cierres_caja').update(fields).eq('id', id).eq('user_id', currentUserId).select().single();
    if(error){ console.error(error); showToast('No se pudo actualizar el cierre'); return null; }
    const idx = cierresCaja.findIndex(c => String(c.id) === String(id));
    if(idx !== -1) cierresCaja[idx] = data;
    return data;
  }catch(err){ console.error(err); showToast('No se pudo actualizar el cierre'); return null; }
}

function renderHistory(){
  const searchTerm = (document.getElementById('histSearch').value || '').trim().toLowerCase();
  const all = [...entries]
    .filter(e => !searchTerm || e.descripcion.toLowerCase().includes(searchTerm))
    .sort((a,b)=>b.timestamp-a.timestamp);
  const histBody = document.getElementById('histBody');
  if(all.length === 0){
    const msg = searchTerm ? `Sin resultados para "${escapeHtml(searchTerm)}".` : 'Sin movimientos todavía.';
    histBody.innerHTML = `<tr><td colspan="7" style="color:var(--ink-soft);text-align:center;padding:20px 0;">${msg}</td></tr>`;
  }else{
    histBody.innerHTML = all.map(e => `
      <tr>
        <td>${fmtFecha(e.fecha)}</td>
        <td>${e.tipo}</td>
        <td>${escapeHtml(e.descripcion)}${e.pending ? '<span class="pending-badge">Sin sincronizar</span>' : ''}</td>
        <td class="amt ${e.tipo==='Venta'?'venta':'gasto'}">${e.tipo==='Venta'?'+':'-'}${fmtMoney(e.monto)}</td>
        <td class="amt ${e.ganancia !== '' && e.ganancia < 0 ? 'gasto' : 'venta'}">${e.ganancia !== '' && e.ganancia !== undefined ? fmtMoney(e.ganancia) : '—'}</td>
        <td>${metodoDot(e.metodoPago)}${escapeHtml(e.metodoPago)}</td>
        <td style="white-space:nowrap;">
          ${e.tipo==='Venta' ? `<button class="hist-del" aria-label="Ver ticket" onclick="verTicket('${e.id}')" style="margin-right:6px;">&#128196;</button>` : ''}
          <button class="hist-del" aria-label="Editar" onclick="editEntry('${e.id}')" style="margin-right:6px;">&#9998;</button>
          <button class="hist-del" aria-label="Eliminar" onclick="deleteEntry('${e.id}')">&times;</button>
        </td>
      </tr>
    `).join('');
  }
}

// Sirve para texto y tambien dentro de atributos ("..." o '...'). La version
// anterior (textContent -> innerHTML) no escapaba comillas: un nombre como
// `x" onmouseover="..."` dentro de value="..." o title="..." inyectaba
// codigo, y las descripciones pueden venir de un Excel importado.
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});

// Convierte un valor importado de Excel a número >0, o '' si es inválido/negativo/cero.
// (parseFloat(x)||'' dejaba pasar negativos, porque un número negativo es "truthy" en JS.)
function parsePosNum(v){
  const n = parseFloat(v);
  return (!isNaN(n) && n > 0) ? n : '';
}

document.getElementById('importFile').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  if(!file) return;
  const importMsg = document.getElementById('importMsg');
  const reader = new FileReader();
  reader.onload = async (evt)=>{
    try{
      const data = new Uint8Array(evt.target.result);
      // cellDates:true es necesario para que las celdas de fecha lleguen como Date;
      // sin esto, SheetJS las entrega como número de serie de Excel y la fecha queda corrupta.
      const wb = XLSX.read(data, {type:'array', cellDates:true});
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});

      if(rows.length === 0){
        importMsg.style.color = 'var(--gasto)';
        importMsg.textContent = 'El archivo no tiene filas para importar.';
        return;
      }

      let importadas = 0, saltadas = 0;
      const nuevosFields = [];
      rows.forEach((row, i) => {
        const tipoRaw = String(row['Tipo'] || '').trim();
        const tipo = /venta/i.test(tipoRaw) ? 'Venta' : (/gasto/i.test(tipoRaw) ? 'Gasto' : null);
        const monto = parseFloat(row['Monto']);
        const descripcion = String(row['Descripción'] || row['Descripcion'] || '').trim();

        if(!tipo || !monto || monto <= 0 || !descripcion){
          saltadas++;
          return;
        }

        let fecha = row['Fecha'];
        if(fecha instanceof Date){
          fecha = fecha.toISOString().slice(0,10);
        }else{
          fecha = String(fecha || todayStr()).slice(0,10);
        }

        const cantidadImp = parsePosNum(row['Cantidad']);
        const precioUnitarioImp = parsePosNum(row['Precio unitario']);
        const costoUnitarioImp = parsePosNum(row['Costo unitario']);
        const costoTotalCruda = parsePosNum(row['Costo total']);
        const costoTotalImp = costoTotalCruda !== '' ? costoTotalCruda : (costoUnitarioImp !== '' && cantidadImp !== '' ? costoUnitarioImp * cantidadImp : '');
        const gananciaImp = row['Ganancia'] !== undefined && row['Ganancia'] !== '' ? parseFloat(row['Ganancia']) : (costoTotalImp !== '' ? monto - costoTotalImp : '');

        nuevosFields.push({
          fecha: fecha,
          hora: String(row['Hora'] || ''),
          tipo: tipo,
          descripcion: descripcion,
          cantidad: cantidadImp,
          precioUnitario: precioUnitarioImp,
          costoUnitario: tipo === 'Venta' ? costoUnitarioImp : '',
          costoTotal: tipo === 'Venta' ? costoTotalImp : '',
          ganancia: tipo === 'Venta' ? gananciaImp : '',
          monto: monto,
          metodoPago: String(row['Método de pago'] || row['Metodo de pago'] || 'Efectivo'),
          nota: String(row['Nota'] || '')
        });
        importadas++;
      });

      if(nuevosFields.length){
        const rowsToInsert = nuevosFields.map(f => mapFieldsToRow(f));
        const { data: insertedRows, error: insertErr } = await sb.from('movements').insert(rowsToInsert).select();
        if(insertErr){
          console.error(insertErr);
          importMsg.style.color = 'var(--gasto)';
          importMsg.textContent = 'Se leyó el archivo, pero hubo un error al guardar los movimientos en la base de datos.';
          document.getElementById('importFile').value = '';
          return;
        }
        entries = entries.concat((insertedRows || []).map(mapRowToEntry));
      }
      render();

      importMsg.style.color = importadas > 0 ? 'var(--venta)' : 'var(--gasto)';
      if(importadas === 0){
        importMsg.textContent = `Este archivo no tiene las columnas de Tikera (Fecha, Tipo, Descripción, Monto...). Probá exportar primero desde acá para ver el formato exacto que se espera.`;
      }else{
        importMsg.textContent = `Se importaron ${importadas} movimiento(s).` + (saltadas ? ` Se omitieron ${saltadas} fila(s) con datos incompletos o inválidos.` : '');
        showToast(`${importadas} movimiento(s) importado(s)`);
      }
    }catch(err){
      importMsg.style.color = 'var(--gasto)';
      importMsg.textContent = 'No se pudo leer el archivo. Verificá que sea un Excel exportado desde Tikera u otro con las mismas columnas.';
    }
    document.getElementById('importFile').value = '';
  };
  reader.readAsArrayBuffer(file);
});

// Evita CSV/Excel formula injection: si un texto libre (cargado a mano o importado)
// empieza con =,+,-,@ o un tab, Excel podría interpretarlo como fórmula al abrir el archivo.
function sanitizeForExcel(val){
  const s = String(val ?? '');
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// Aplica el mismo filtro de fecha (Desde/Hasta del historial) que usan tanto
// la exportación a Excel como la de PDF, para que ambas siempre muestren lo mismo.
function getEntriesParaExportar(){
  const desde = document.getElementById('fDesde').value;
  const hasta = document.getElementById('fHasta').value;
  let toExport = [...entries];
  if(desde) toExport = toExport.filter(e => e.fecha >= desde);
  if(hasta) toExport = toExport.filter(e => e.fecha <= hasta);
  toExport.sort((a,b)=>a.timestamp-b.timestamp);
  return { toExport, desde, hasta };
}

document.getElementById('exportBtn').addEventListener('click', ()=>{
  const { toExport } = getEntriesParaExportar();

  if(toExport.length === 0){
    alert('No hay movimientos en ese rango para exportar.');
    return;
  }

  const rows = toExport.map(e => ({
    'Fecha': e.fecha,
    'Hora': sanitizeForExcel(e.hora),
    'Tipo': e.tipo,
    'Descripción': sanitizeForExcel(e.descripcion),
    'Cantidad': e.cantidad,
    'Precio unitario': e.precioUnitario,
    'Costo unitario': e.costoUnitario || '',
    'Costo total': e.costoTotal || '',
    'Monto': e.monto,
    'Ganancia': e.ganancia !== undefined ? e.ganancia : '',
    'Método de pago': sanitizeForExcel(e.metodoPago),
    'Nota': sanitizeForExcel(e.nota)
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:8},{wch:8},{wch:32},{wch:10},{wch:14},{wch:14},{wch:12},{wch:12},{wch:12},{wch:16},{wch:24}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');

  const bizName = document.getElementById('bizName').value.trim() || 'kiosco';
  const safeName = bizName.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g,'_');
  XLSX.writeFile(wb, `${safeName}_movimientos_${todayStr()}.xlsx`);
});

document.getElementById('exportPdfBtn').addEventListener('click', ()=>{
  const { toExport, desde, hasta } = getEntriesParaExportar();

  if(toExport.length === 0){
    alert('No hay movimientos en ese rango para exportar.');
    return;
  }

  const ventas = toExport.filter(e=>e.tipo==='Venta').reduce((s,e)=>s+e.monto,0);
  const gastos = toExport.filter(e=>e.tipo==='Gasto').reduce((s,e)=>s+e.monto,0);
  const costoMerc = toExport.filter(e=>e.tipo==='Venta').reduce((s,e)=>s+(parseFloat(e.costoTotal)||0),0);
  const gananciaReal = ventas - costoMerc - gastos;
  const bizName = document.getElementById('bizName').value.trim() || 'Mi negocio';
  const periodoLabel = (desde || hasta)
    ? `${desde ? fmtFecha(desde) : 'inicio'} — ${hasta ? fmtFecha(hasta) : 'hoy'}`
    : 'Todo el historial';

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(17);
  doc.setTextColor(20);
  doc.text('Tikera — Reporte de caja', 14, 18);
  doc.setFontSize(11);
  doc.setTextColor(100);
  doc.text(bizName, 14, 25);
  doc.text(`Periodo: ${periodoLabel}`, 14, 31);
  doc.text(`Generado: ${fmtFecha(todayStr())}`, 14, 37);

  doc.setTextColor(20);
  doc.setFontSize(12);
  const y0 = 48;
  doc.text(`Ventas: ${fmtMoney(ventas)}`, 14, y0);
  doc.text(`Costo mercaderia: ${fmtMoney(costoMerc)}`, 14, y0 + 7);
  doc.text(`Gastos: ${fmtMoney(gastos)}`, 14, y0 + 14);
  doc.setFont(undefined, 'bold');
  doc.text(`Ganancia real: ${fmtMoney(gananciaReal)}`, 14, y0 + 23);
  doc.setFont(undefined, 'normal');

  let y = y0 + 34;
  const metodos = ['Efectivo','Tarjeta','Transferencia','Otro'].filter(m => toExport.some(e=>e.metodoPago===m));
  if(metodos.length){
    doc.setFontSize(11);
    doc.text('Saldo por metodo de pago:', 14, y);
    metodos.forEach((m,i)=>{
      const saldo = toExport.filter(e=>e.metodoPago===m).reduce((s,e)=>s+(e.tipo==='Venta'?e.monto:-e.monto),0);
      doc.text(`${m}: ${fmtMoney(saldo)}`, 18, y + 6 + i*6);
    });
    y += 6 + metodos.length*6 + 6;
  }

  doc.autoTable({
    startY: y,
    head: [['Fecha','Tipo','Descripcion','Monto','Ganancia','Pago']],
    body: toExport.map(e => [
      fmtFecha(e.fecha),
      e.tipo,
      e.descripcion,
      (e.tipo==='Venta'?'+':'-') + fmtMoney(e.monto),
      e.ganancia !== '' && e.ganancia !== undefined ? fmtMoney(e.ganancia) : '—',
      e.metodoPago
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [62,86,112] },
    margin: { left: 14, right: 14 }
  });

  const safeName = bizName.replace(/[^a-zA-Z0-9_\- ]/g, '').replace(/\s+/g,'_');
  doc.save(`${safeName}_reporte_${todayStr()}.pdf`);
});

document.getElementById('histSearch').addEventListener('input', renderHistory);

function setSummaryScope(s){
  summaryScope = s;
  document.getElementById('btnScopeHoy').className = 'type-btn' + (s==='hoy' ? ' active-accent' : '');
  document.getElementById('btnScopeMes').className = 'type-btn' + (s==='mes' ? ' active-accent' : '');
  renderSummary();
}
document.getElementById('btnScopeHoy').addEventListener('click', ()=>setSummaryScope('hoy'));
document.getElementById('btnScopeMes').addEventListener('click', ()=>setSummaryScope('mes'));
setSummaryScope('hoy');

document.getElementById('gateCode').focus();

if('serviceWorker' in navigator){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch((e)=> console.error('SW no se pudo registrar', e));
  });
}
