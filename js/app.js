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
let editingProveedorId = null;
let openProveedorId = null;
let catalogoTab = 'productos';
let cierresCaja = [];
let facturacionConfig = null;
let facturas = [];
let selectedCategoria = null;

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

function switchView(view){
  document.getElementById('viewCargar').style.display = view==='cargar' ? 'block' : 'none';
  document.getElementById('viewInicio').style.display = view==='inicio' ? 'block' : 'none';
  document.getElementById('viewTiki').style.display = view==='tiki' ? 'block' : 'none';
  document.getElementById('viewHistorial').style.display = view==='historial' ? 'block' : 'none';
  document.getElementById('viewCatalogo').style.display = view==='catalogo' ? 'block' : 'none';
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
  document.getElementById('navBtnCaja').classList.toggle('active', view==='caja');
  document.getElementById('navBtnNoticias').classList.toggle('active', view==='noticias');
  document.getElementById('navBtnFacturacion').classList.toggle('active', view==='facturacion');
  document.getElementById('navBtnCuenta').classList.toggle('active', view==='cuenta');
  document.getElementById('navBtnConfig').classList.toggle('active', view==='ajustes');
  if(view==='catalogo'){ renderCatalog(); if(catalogoTab === 'proveedores') renderProveedores(); }
  if(view==='caja') openCajaView();
  if(view==='tiki') openTikiView();
  if(view==='noticias'){ fetchDolar(); fetchInflacion(); fetchFeriados(); }
  if(view==='facturacion') openFacturacionView();
  if(view==='cuenta') loadPerfilView();
  if(view==='ajustes') loadAjustesView();
  window.scrollTo({top:0, behavior:'instant'});

  const viewIds = {cargar:'viewCargar', inicio:'viewInicio', tiki:'viewTiki', historial:'viewHistorial', catalogo:'viewCatalogo', caja:'viewCaja', noticias:'viewNoticias', facturacion:'viewFacturacion', cuenta:'viewCuenta', ajustes:'viewAjustes'};
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
  renderFacturacionAjustesForm();
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
  const { data } = await sb.from('facturacion_config').select('*').eq('user_id', currentUserId).maybeSingle();
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
  if(mios.length === 0 || !navigator.onLine) return;
  syncingPending = true;
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
  }
}
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
    const { data: facturacionRow, error: facturacionErr } = await sb.from('facturacion_config').select('*').eq('user_id', user.id).maybeSingle();
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
    const rows = items.map(p => {
      const stock = Number(p.stock_actual) || 0;
      const low = p.stock_minimo !== null && p.stock_minimo !== undefined && p.stock_minimo !== '' && stock <= Number(p.stock_minimo);
      return `
        <div class="ticket-item">
          <div class="ti-left">
            <div class="ti-desc">${escapeHtml(p.nombre)}</div>
            <div class="ti-meta">${p.precio_venta ? fmtMoney(p.precio_venta) : 'sin precio'} · Stock: <span class="${low ? 'stock-low' : ''}">${stock}${low ? ' — repone ya' : ''}</span></div>
          </div>
          <div class="ti-right">
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

// Rueda de stock: cuantos productos del catalogo estan en o por debajo del
// minimo configurado, con la lista de cuales son -- vive junto al formulario
// de carga porque ahi es cuando el kiosquero mas se beneficia de verlo (esta
// mirando la pantalla igual, no tiene que ir a buscarlo al Catalogo aparte).
function renderStockWheel(){
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
  if(products.length === 0){
    wrap.innerHTML = `<div class="restock-empty">Todavía no cargaste productos en el catálogo.</div>`;
    return;
  }
  const predictions = calcularReposicion();

  if(predictions.length === 0){
    wrap.innerHTML = `<div class="restock-empty">Con las ventas de las últimas dos semanas, ningún producto se está por quedar sin stock pronto.</div>`;
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

function renderSummary(){
  const today = todayStr();
  const todays = entries.filter(e => e.fecha === today);
  const currentMonth = today.slice(0,7); // "YYYY-MM"
  const summaryEntries = summaryScope === 'mes'
    ? entries.filter(e => e.fecha && e.fecha.slice(0,7) === currentMonth)
    : todays;
  const scopeLabel = summaryScope === 'mes' ? 'del mes' : 'hoy';

  const ventasS = summaryEntries.filter(e=>e.tipo==='Venta').reduce((s,e)=>s+e.monto,0);
  const gastosS = summaryEntries.filter(e=>e.tipo==='Gasto').reduce((s,e)=>s+e.monto,0);
  const costoMercS = summaryEntries.filter(e=>e.tipo==='Venta').reduce((s,e)=>s + (parseFloat(e.costoTotal) || 0), 0);
  const gananciaRealS = ventasS - costoMercS - gastosS;
  document.getElementById('summary').innerHTML = `
    <div class="metric metric-venta"><div class="metric-label">Ventas ${scopeLabel}</div><div class="metric-value" style="color:var(--venta)">${fmtMoney(ventasS)}</div></div>
    <div class="metric metric-accent"><div class="metric-label">Costo mercadería</div><div class="metric-value" style="color:var(--accent-dark)">${fmtMoney(costoMercS)}</div></div>
    <div class="metric metric-gasto"><div class="metric-label">Gastos ${scopeLabel}</div><div class="metric-value" style="color:var(--gasto)">${fmtMoney(gastosS)}</div></div>
    <div class="metric" style="border:1.5px solid ${gananciaRealS >= 0 ? 'var(--gold)' : 'var(--gasto)'};background:linear-gradient(${gananciaRealS >= 0 ? 'var(--gold-bg),var(--gold-bg)' : 'var(--gasto-bg),var(--gasto-bg)'}),var(--card);"><div class="metric-label" style="font-weight:700;">Ganancia real ${scopeLabel}</div><div class="metric-value" style="color:${gananciaRealS >= 0 ? 'var(--gold)' : 'var(--gasto)'};font-size:22px;">${fmtMoney(gananciaRealS)}</div></div>
    <div class="metric"><div class="metric-label">Movimientos ${scopeLabel}</div><div class="metric-value">${summaryEntries.length}</div></div>
  `;

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

// Grafico de barras de los ultimos 7 dias (independiente del toggle Hoy/Mes:
// una semana fija le da al kiosquero una foto rapida de la tendencia, sin
// tener que ir a Historial a compararla a mano).
function renderSalesChart(){
  const wrap = document.getElementById('salesChart');
  if(!wrap) return;
  const dayNames = ['dom','lun','mar','mié','jue','vie','sáb'];
  const days = [];
  for(let i=6;i>=0;i--){
    const d = new Date();
    d.setDate(d.getDate()-i);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    const key = `${y}-${m}-${day}`;
    const total = entries.filter(e => e.tipo==='Venta' && e.fecha===key).reduce((s,e)=>s+e.monto,0);
    days.push({ key, label: dayNames[d.getDay()], total, isToday: i===0 });
  }
  const max = Math.max(...days.map(d=>d.total));
  if(max === 0){
    wrap.innerHTML = `<div class="sales-chart-empty">Todavía no hay ventas esta semana para graficar.</div>`;
    return;
  }
  wrap.innerHTML = days.map(d => `
    <div class="sales-chart-col">
      <div class="sales-chart-bar-wrap">
        <div class="sales-chart-bar${d.isToday ? ' is-today' : ''}" style="height:${d.total ? Math.max(6, d.total/max*100) : 0}%;" title="${fmtFecha(d.key)}: ${fmtMoney(d.total)}">${d.total ? `<span class="sales-chart-val">${fmtMoneyCompact(d.total)}</span>` : ''}</div>
      </div>
      <div class="sales-chart-day${d.isToday ? ' is-today' : ''}">${d.label}</div>
    </div>
  `).join('');
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
