// Tiki -- el asistente de Tikera. Se carga despues de js/app.js (usa sus
// datos y helpers: entries, products, proveedores, pedidosProveedor,
// cierresCaja, currentUserId, sb, todayStr, escapeHtml, switchView,
// setCatalogoTab, setTipo, calcularReposicion, ventaDiariaDe,
// efectivoEsperadoDe, cierreDeFecha, pedidosDeProveedor).
// Diseño, modelo de amenazas y memoria: docs/tiki.md.

// ============================================
// Tiki: el asistente de Tikera (seccion propia del nav).
// Motor propio a proposito, SIN IA externa: no tiene costo por consulta,
// funciona sin conexion y nada de lo que se le pregunta sale del
// dispositivo. Entiende una pregunta buscando tres cosas en el texto --
// que se quiere saber (ventas, gastos, stock, deudas, cierre...), de
// cuando (hoy, ayer, el sabado, este mes...) y de que (un producto, un
// proveedor, un tipo de gasto) -- y responde con los mismos datos y las
// mismas cuentas que ya usan las otras pantallas (entries, products,
// proveedores, pedidosProveedor, cierresCaja, calcularReposicion...).
//
// La charla vive solo en memoria: no se guarda en Supabase ni en
// localStorage, y se borra al recargar o al cerrar sesion. Es lo que
// promete privacidad.html#tiki -- si esto cambia, cambiar la politica.
//
// Si algun dia se le suma una IA (etapa 2), las funciones tiki* de aca son
// justo las "herramientas" que el modelo necesitaria consultar; la Edge
// Function supabase/functions/ai-agent ya esta escrita para eso.
// ============================================
let tikiIniciado = false;
let tikiOcupado = false;
let tikiGen = 0;            // sube en cada reset: descarta respuestas en vuelo de una sesion anterior
let tikiSeguir = null;      // ultima pregunta con fecha, para repreguntar "¿y ayer?"
let tikiSeguirTs = 0;
let tikiCtx = null;         // de que se hablo en la ultima respuesta (para "¿por que?", "¿es bueno?"...)
let tikiSugerencia = null;  // paso siguiente que ofrecio Tiki y se acepta con "si"
const TIKI_CONTEXTO_MS = 10 * 60 * 1000;
let tikiFeriadosCache = null;

const TIKI_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5V17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><path d="M9 9.5v1M15 9.5v1"/><path d="M9.5 13.5c1.4.9 3.6.9 5 0"/></svg>';
const TIKI_DIAS = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
const TIKI_DIAS_PLURAL = ['domingos','lunes','martes','miércoles','jueves','viernes','sábados'];
const TIKI_MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const TIKI_CHIPS = ['¿Qué hacemos hoy?', '¿Cómo fue el cierre?', '¿Cómo vengo este mes?', '¿Qué tengo que reponer?', '¿Cuánto le debo a los proveedores?', '¿Qué producto me deja más?', '¿Qué día vendo más?'];

// Palabras de la pregunta que nunca son el nombre de un producto,
// proveedor o gasto (ya sin tildes, como quedan despues de tikiNorm).
const TIKI_STOP = new Set(('que cuanto cuanta cuantos cuantas como cual cuales cuando donde quien me mi mis te tu tus le les lo la el los las un una unos unas de del en a al y o por para con sin es son fue fueron era esta este estos estas ese esa eso hay tengo tenemos tiene tenes hoy ayer anteayer antes manana mes meses semana semanas ano dia dias pasado pasada ultimo ultimos ultima ultimas vendi vendimos vende vendo vendes vendio vendiste vendido venta ventas vender gaste gasto gastos gastamos gastado gastar pague pagamos pagado pagar pagarle quedan queda quedo quedaron stock reponer repongo agota agotar agotando falta faltan pedir comprar mas menos mucho muchos poco todo toda todos todas total ganancia ganancias gane ganamos ganado ganar deja dejo deje dejan unidades unidad plata precio precios cuesta costo sale vale margen debo debemos debes deuda deudas proveedor proveedores producto productos cosa cosas decime dime sabes podes podrias quiero queria necesito ver saber mostrame dame contame lunes martes miercoles jueves viernes sabado domingo hola tiki favor gracias bien mal va vamos voy vengo venimos estoy anda andamos fin dinero negocio kiosco local comercio almacen facture facturamos facturado facturacion recaude recaudamos recaudado recaudacion ingreso ingresos hice hicimos saque sacamos entro entraron plata efectivo cierre caja enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre').split(' '));
const TIKI_STOP_NOMBRE = new Set(['de','del','la','el','los','las','con','sin','por','para','en','al','un','una','x']);

// ---------- Texto ----------
function tikiNorm(s){
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\/\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Plural -> singular, lo justo para que "alfajores" encuentre "Alfajor".
function tikiRaiz(w){
  if(w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if(w.length > 3 && w.endsWith('s')) return w.slice(0, -1);
  return w;
}
function tikiCoinciden(a, b){
  return a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));
}
function tikiSobrantes(t){
  return t.split(' ').filter(w => w.length >= 2 && !TIKI_STOP.has(w) && !TIKI_STOP.has(tikiRaiz(w)) && !/^[\d\/]+$/.test(w));
}
// Devuelve los items cuyo nombre comparte mas palabras con la pregunta.
// Todos los empatados: "coca" trae todas las Coca, "coca zero" solo la Zero.
function tikiBuscar(claves, items, nombreDe){
  if(!claves.length) return [];
  let mejor = 0, res = [];
  items.forEach(it => {
    const palabras = [...new Set(tikiNorm(nombreDe(it)).split(' ')
      .filter(w => w.length >= 3 && !TIKI_STOP_NOMBRE.has(w) && !/^\d/.test(w)).map(tikiRaiz))];
    const score = palabras.filter(p => claves.some(c => tikiCoinciden(c, p))).length;
    if(score === 0) return;
    if(score > mejor){ mejor = score; res = [it]; }
    else if(score === mejor) res.push(it);
  });
  return res;
}

// ---------- Fechas y formatos ----------
function tikiFecha(d){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function tikiParse(f){ const [y,m,d] = f.split('-').map(Number); return new Date(y, m-1, d); }
function tikiSumarDias(f, n){ const d = tikiParse(f); d.setDate(d.getDate() + n); return tikiFecha(d); }
function tikiDiaSemana(f){ return TIKI_DIAS[tikiParse(f).getDay()]; }
function tikiFechaCorta(f){ const d = tikiParse(f); return `${d.getDate()}/${d.getMonth()+1}`; }
function tikiLabelDia(f){
  const hoy = todayStr();
  if(f === hoy) return 'hoy';
  if(f === tikiSumarDias(hoy, -1)) return 'ayer';
  return `el ${tikiDiaSemana(f)} ${tikiFechaCorta(f)}`;
}
// "de hoy" / "de ayer" / "del sábado 3/10"
function tikiDeDia(f){ const l = tikiLabelDia(f); return l.startsWith('el ') ? 'del ' + l.slice(3) : 'de ' + l; }
function tikiCap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
function tikiPlata(n){
  n = Math.round(Number(n) || 0);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('es-AR');
}
function tikiNum(n){ return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString('es-AR'); }
function tikiListaNombres(items, yaHtml, max){
  const lista = items.map(x => yaHtml ? x : escapeHtml(x));
  const tope = max || 3;
  if(lista.length > tope) return lista.slice(0, tope).join(', ') + ` y ${lista.length - tope} más`;
  if(lista.length <= 1) return lista.join('');
  return lista.slice(0, -1).join(', ') + ' y ' + lista[lista.length - 1];
}
function tikiSaludo(){
  const h = new Date().getHours();
  if(h >= 5 && h < 13) return 'Buen día';
  if(h >= 13 && h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

// Alterna entre formas de decir lo mismo, para no sonar a contestador.
// En orden (no al azar): la misma conversacion siempre suena igual.
let tikiVariante = 0;
function tikiUnaDe(opciones){ return opciones[(tikiVariante++) % opciones.length]; }

// Saca el periodo de la pregunta. null = no dijo de cuando (cada
// respuesta elige su default: hoy, este mes, ultimos 30 dias...).
function tikiPeriodo(t){
  const hoy = todayStr();
  const dia = (f) => ({ desde: f, hasta: f, label: tikiLabelDia(f), dia: true });
  if(/\b(anteayer|antes de ayer)\b/.test(t)) return dia(tikiSumarDias(hoy, -2));
  if(/\bayer\b/.test(t)) return dia(tikiSumarDias(hoy, -1));
  if(/\bhoy\b/.test(t)) return dia(hoy);
  const lunesDe = (f) => tikiSumarDias(f, -((tikiParse(f).getDay() + 6) % 7));
  if(/\bsemana pasada\b/.test(t)){
    const l = tikiSumarDias(lunesDe(hoy), -7);
    return { desde: l, hasta: tikiSumarDias(l, 6), label: 'la semana pasada' };
  }
  if(/\bsemana\b/.test(t)) return { desde: lunesDe(hoy), hasta: hoy, label: 'esta semana', semana: true };
  const d = tikiParse(hoy);
  const mesEntero = (y, m) => {
    const desde = tikiFecha(new Date(y, m, 1));
    const fin = tikiFecha(new Date(y, m + 1, 0));
    const esEste = y === d.getFullYear() && m === d.getMonth();
    return { desde, hasta: fin > hoy ? hoy : fin, label: esEste ? 'este mes' : `en ${TIKI_MESES[m]}`, mes: esEste };
  };
  if(/\bmes pasado\b/.test(t)){
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    return mesEntero(prev.getFullYear(), prev.getMonth());
  }
  if(/\bmes\b/.test(t)) return mesEntero(d.getFullYear(), d.getMonth());
  if(/\bano\b/.test(t)) return { desde: hoy.slice(0, 5) + '01-01', hasta: hoy, label: 'este año' };
  let m = t.match(/\bultimos? (\d{1,3}) dias\b/);
  if(m){
    const n = Math.max(1, Number(m[1]));
    return { desde: tikiSumarDias(hoy, -(n - 1)), hasta: hoy, label: `en los últimos ${n} días` };
  }
  m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if(m){
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : d.getFullYear();
    let f = tikiFecha(new Date(y, Number(m[2]) - 1, Number(m[1])));
    if(!m[3] && f > hoy) f = tikiFecha(new Date(y - 1, Number(m[2]) - 1, Number(m[1])));
    return dia(f);
  }
  for(let i = 0; i < 12; i++){
    if(new RegExp('\\b' + TIKI_MESES[i] + '\\b').test(t)){
      return mesEntero(i > d.getMonth() ? d.getFullYear() - 1 : d.getFullYear(), i);
    }
  }
  for(let i = 0; i < 7; i++){
    if(new RegExp('\\b' + tikiNorm(TIKI_DIAS[i]) + '\\b').test(t)){
      let atras = (d.getDay() - i + 7) % 7;
      if(atras === 0) atras = 7; // "el lunes" dicho un lunes = el lunes pasado
      return dia(tikiSumarDias(hoy, -atras));
    }
  }
  return null;
}
function tikiUltimos30(){
  const hoy = todayStr();
  return { desde: tikiSumarDias(hoy, -29), hasta: hoy, label: 'en los últimos 30 días' };
}

// ---------- Datos ----------
function tikiMovs(desde, hasta, tipo){
  return entries.filter(e => e.fecha && e.fecha >= desde && e.fecha <= hasta && (!tipo || e.tipo === tipo));
}
// Misma cuenta de ganancia real que el Resumen de Inicio (renderSummary).
function tikiResumen(desde, hasta){
  const movs = tikiMovs(desde, hasta);
  const ventas = movs.filter(e => e.tipo === 'Venta');
  const gastos = movs.filter(e => e.tipo === 'Gasto');
  const totalVentas = ventas.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  const totalGastos = gastos.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  const costoMerc = ventas.reduce((s,e) => s + (parseFloat(e.costoTotal) || 0), 0);
  return {
    ventas: totalVentas, gastos: totalGastos, costoMerc,
    ganancia: totalVentas - costoMerc - totalGastos,
    cantVentas: ventas.length,
    sinCosto: ventas.filter(e => !(parseFloat(e.costoTotal) > 0)).length,
    lista: ventas
  };
}
// "un 12% más que" / "un 8% menos que" / "lo mismo que" ('' si no hay contra que comparar)
function tikiVariacion(actual, anterior){
  if(!(anterior > 0)) return '';
  const pct = Math.round((actual - anterior) / anterior * 100);
  if(pct === 0) return 'lo mismo que';
  return pct > 0 ? `<span class="tiki-pos">un ${pct}% más</span> que` : `<span class="tiki-neg">un ${-pct}% menos</span> que`;
}
// Ventas agrupadas por descripcion (igual que "Productos que mas facturan":
// las ventas guardan el nombre, no el id del producto).
function tikiAgruparVentas(ventas){
  const map = new Map();
  ventas.forEach(e => {
    const key = tikiNorm(e.descripcion);
    if(!key) return;
    const g = map.get(key) || { nombre: (e.descripcion || '').trim(), monto: 0, cantidad: 0, ganancia: 0, conCosto: 0, n: 0 };
    g.monto += Number(e.monto) || 0;
    g.cantidad += Number(e.cantidad) || 1;
    if(parseFloat(e.costoTotal) > 0){ g.ganancia += (Number(e.monto) || 0) - parseFloat(e.costoTotal); g.conCosto++; }
    g.n++;
    map.set(key, g);
  });
  return [...map.values()];
}
// Nombres que Tiki reconoce como "algo que se vende": el catalogo + lo
// vendido en los ultimos 6 meses (cubre ventas cargadas a mano, sin catalogo).
function tikiNombresVendidos(){
  const desde = tikiSumarDias(todayStr(), -180);
  const map = new Map();
  products.forEach(p => { const k = tikiNorm(p.nombre); if(k && !map.has(k)) map.set(k, p.nombre); });
  entries.forEach(e => {
    if(e.tipo !== 'Venta' || !e.fecha || e.fecha < desde) return;
    const k = tikiNorm(e.descripcion);
    if(k && !map.has(k)) map.set(k, (e.descripcion || '').trim());
  });
  return [...map.values()];
}
function tikiParaReponer(){
  const lista = calcularReposicion().map(r => ({
    nombre: r.nombre, dias: r.daysLeft,
    corto: r.daysLeft < 1 ? 'se agota hoy' : `~${Math.floor(r.daysLeft)} ${Math.floor(r.daysLeft) === 1 ? 'día' : 'días'}`,
    largo: r.daysLeft < 1 ? `se termina hoy, reponé ${r.suggestedQty}` : `te alcanza para ~${Math.floor(r.daysLeft)} ${Math.floor(r.daysLeft) === 1 ? 'día' : 'días'}, reponé ${r.suggestedQty}`
  }));
  products.forEach(p => {
    const min = p.stock_minimo;
    if(min === null || min === undefined || min === '') return;
    const stock = Number(p.stock_actual) || 0;
    if(stock > Number(min) || lista.some(r => r.nombre === p.nombre)) return;
    const txt = stock <= 0 ? 'sin stock' : `quedan ${tikiNum(stock)}, mínimo ${tikiNum(min)}`;
    lista.push({ nombre: p.nombre, dias: stock <= 0 ? 0 : null, corto: txt, largo: txt });
  });
  return lista;
}
function tikiDeudasLista(){
  return proveedores.map(p => {
    const pend = pedidosDeProveedor(p.id).filter(x => !x.pagado);
    return {
      p,
      total: pend.reduce((s,x) => s + (Number(x.monto) || 0), 0),
      cant: pend.length,
      desde: pend.reduce((m,x) => (!m || x.fecha < m) ? x.fecha : m, null)
    };
  }).filter(d => d.total > 0).sort((a,b) => b.total - a.total);
}
// Gastos marcados "fijo" el mes pasado que todavia no aparecen este mes.
function tikiFijosPendientes(){
  const hoy = todayStr();
  const d = tikiParse(hoy);
  const iniPrev = tikiFecha(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const finPrev = tikiFecha(new Date(d.getFullYear(), d.getMonth(), 0));
  const esteMes = new Set(tikiMovs(hoy.slice(0, 8) + '01', hoy, 'Gasto').map(e => tikiNorm(e.descripcion)));
  const pend = new Map();
  tikiMovs(iniPrev, finPrev, 'Gasto').filter(e => e.esFijo).forEach(e => {
    const k = tikiNorm(e.descripcion);
    if(!k || esteMes.has(k) || pend.has(k)) return;
    pend.set(k, { nombre: (e.descripcion || '').trim(), monto: Number(e.monto) || 0, dia: Number(e.fecha.slice(8)) });
  });
  return [...pend.values()].sort((a,b) => a.dia - b.dia);
}
// Promedio de venta por dia de la semana, ultimas 8 semanas (sin hoy).
// null si hay menos de dos semanas de datos: con menos, el "mejor dia" es ruido.
function tikiPromediosPorDia(){
  const hoy = todayStr();
  const desde = tikiSumarDias(hoy, -56), hasta = tikiSumarDias(hoy, -1);
  const ventas = tikiMovs(desde, hasta, 'Venta');
  if(!ventas.length) return null;
  const primera = ventas.reduce((m,e) => e.fecha < m ? e.fecha : m, hasta);
  const inicio = primera > desde ? primera : desde;
  if(Math.round((tikiParse(hasta) - tikiParse(inicio)) / 86400000) + 1 < 14) return null;
  const totales = [0,0,0,0,0,0,0], veces = [0,0,0,0,0,0,0];
  for(let f = inicio; f <= hasta; f = tikiSumarDias(f, 1)) veces[tikiParse(f).getDay()]++;
  ventas.forEach(e => { totales[tikiParse(e.fecha).getDay()] += Number(e.monto) || 0; });
  return totales.map((t,i) => ({ dia: i, promedio: veces[i] ? t / veces[i] : 0 }));
}
async function tikiProximoFeriado(){
  const hoy = todayStr();
  if(!tikiFeriadosCache){
    // Misma fuente publica que Noticias; sin conexion, Tiki sigue sin este dato.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try{
      const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${hoy.slice(0, 4)}`, { signal: ctrl.signal });
      const data = res.ok ? await res.json() : null;
      if(Array.isArray(data)) tikiFeriadosCache = data;
    }catch(err){}
    clearTimeout(timer);
  }
  return (tikiFeriadosCache || []).find(f => f.fecha >= hoy) || null;
}
// Ejemplos con datos reales del negocio (un producto y un proveedor suyos).
function tikiEjemplos(){
  const top = tikiAgruparVentas(tikiMovs(tikiSumarDias(todayStr(), -29), todayStr(), 'Venta')).sort((a,b) => b.monto - a.monto)[0];
  const prod = top ? top.nombre : (products[0] && products[0].nombre);
  const deuda = tikiDeudasLista()[0];
  const prov = deuda ? deuda.p.nombre : (proveedores[0] && proveedores[0].nombre);
  return [
    '¿Cuánto vendí ayer?',
    prod ? `¿Cuánto me queda de ${prod}?` : '¿Qué tengo que reponer?',
    prov ? `¿Cuánto le debo a ${prov}?` : '¿Cuánto le debo a los proveedores?',
    '¿Cuánto gasté en servicios este mes?',
    '¿Cómo fue el cierre de ayer?',
    '¿A qué hora vendo más?',
    '¿Qué no se vende?'
  ];
}
function tikiBarras(filas, ancho){
  const max = Math.max(...filas.map(f => f.valor), 0) || 1;
  return `<div class="tiki-bars${ancho ? ' wide' : ''}">${filas.map(f => `
    <div class="tiki-bar-row${f.top ? ' top' : ''}">
      <span class="tiki-bar-label" title="${escapeHtml(f.label)}">${escapeHtml(f.label)}</span>
      <span class="tiki-bar-track"><span class="tiki-bar-fill" style="width:${Math.max(f.valor > 0 ? 3 : 0, f.valor / max * 100)}%"></span></span>
      <span class="tiki-bar-val">${f.texto}</span>
    </div>`).join('')}</div>`;
}

// ---------- Respuestas ----------
async function tikiPlanDelDia(){
  const hoy = todayStr();
  const ayer = tikiSumarDias(hoy, -1);
  const tareas = [];

  if(tikiMovs(ayer, ayer).length && !cierreDeFecha(ayer)){
    tareas.push({ nivel: 'urgente', html: `Cerrar la caja de ayer: según lo cargado, tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(ayer))}</strong> en efectivo.`, accion: { label: 'Cerrar la caja de ayer', view: 'caja', fecha: ayer } });
  }
  const aPerdida = products.filter(p => Number(p.precio_venta) > 0 && Number(p.costo_unitario) > 0 && Number(p.precio_venta) <= Number(p.costo_unitario));
  if(aPerdida.length){
    tareas.push({ nivel: 'urgente', html: `Revisar precios: ${tikiListaNombres(aPerdida.map(p => `<strong>${escapeHtml(p.nombre)}</strong>`), true)} ${aPerdida.length === 1 ? 'se vende' : 'se venden'} al costo o por debajo.`, accion: { label: 'Ver catálogo', view: 'catalogo' } });
  }
  const reponer = tikiParaReponer();
  if(reponer.length){
    tareas.push({
      nivel: reponer.some(r => r.dias !== null && r.dias <= 2) ? 'urgente' : 'pronto',
      html: `Reponer ${tikiListaNombres(reponer.map(r => `<strong>${escapeHtml(r.nombre)}</strong> <span class="tiki-soft">(${r.corto})</span>`), true, 4)}.`,
      accion: { label: 'Qué reponer', pregunta: '¿Qué tengo que reponer?' }
    });
  }
  const deudas = tikiDeudasLista();
  if(deudas.length){
    const total = deudas.reduce((s,d) => s + d.total, 0);
    tareas.push({ nivel: 'pronto', html: `Pagarle a ${tikiListaNombres(deudas.map(d => `<strong>${escapeHtml(d.p.nombre)}</strong> <span class="tiki-soft">(${tikiPlata(d.total)})</span>`), true)}${deudas.length > 1 ? `: ${tikiPlata(total)} en total` : ''}.`, accion: { label: 'Ver proveedores', view: 'catalogo', tab: 'proveedores' } });
  }
  const fijos = tikiFijosPendientes();
  if(fijos.length){
    const diaHoy = tikiParse(hoy).getDate();
    tareas.push({ nivel: fijos.some(f => f.dia <= diaHoy) ? 'pronto' : 'info', html: `Cargar los gastos fijos del mes: ${tikiListaNombres(fijos.map(f => `<strong>${escapeHtml(f.nombre)}</strong> <span class="tiki-soft">(el mes pasado fue el ${f.dia}, ${tikiPlata(f.monto)})</span>`), true)}.`, accion: { label: 'Cargar un gasto', view: 'cargar', tipo: 'Gasto' } });
  }
  const feriado = await tikiProximoFeriado();
  if(feriado){
    const dias = Math.round((tikiParse(feriado.fecha) - tikiParse(hoy)) / 86400000);
    const nombre = escapeHtml(feriado.nombre || 'feriado');
    if(dias === 0) tareas.push({ nivel: 'info', html: `Hoy es feriado (${nombre}): si abrís, el movimiento suele cambiar.` });
    else if(dias <= 3) tareas.push({ nivel: 'info', html: `${dias === 1 ? 'Mañana' : `El ${tikiDiaSemana(feriado.fecha)} ${tikiFechaCorta(feriado.fecha)}`} es feriado (${nombre}): fijate el stock de lo que más sale y avisale a tus proveedores si cambian las entregas.` });
  }
  const metaAyer = tikiRecuerda('meta_venta_diaria');
  const ventasAyer = tikiResumen(ayer, ayer);
  if(metaAyer && ventasAyer.cantVentas){
    tareas.push({ nivel: ventasAyer.ventas >= metaAyer.monto ? 'bien' : 'info', html: tikiTextoMeta(ventasAyer.ventas, metaAyer.monto, false, 'Ayer') });
  }
  const prom = tikiPromediosPorDia();
  if(prom){
    const cerrados = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias;
    const conVentas = prom.filter(x => x.promedio > 0 && !cerrados.includes(x.dia)).sort((a,b) => b.promedio - a.promedio);
    const hoyDow = tikiParse(hoy).getDay();
    if(conVentas.length >= 3 && conVentas[0].dia === hoyDow){
      tareas.push({ nivel: 'info', html: `Los ${TIKI_DIAS_PLURAL[hoyDow]} son tu mejor día (vendés ~${tikiPlata(conVentas[0].promedio)}): que no te falte nada de lo que más sale.` });
    } else if(conVentas.length >= 3 && conVentas[conVentas.length - 1].dia === hoyDow){
      tareas.push({ nivel: 'info', html: `Los ${TIKI_DIAS_PLURAL[hoyDow]} suelen ser flojos: buen día para ordenar, contar stock o hacer pedidos.` });
    }
  }
  const sinCosto = products.filter(p => !(Number(p.costo_unitario) > 0));
  if(sinCosto.length){
    tareas.push({ nivel: 'info', html: `Cargarle el costo a ${sinCosto.length === 1 ? `<strong>${escapeHtml(sinCosto[0].nombre)}</strong>` : `${sinCosto.length} productos`}: sin eso no puedo calcular cuánto te ${sinCosto.length === 1 ? 'deja' : 'dejan'}.`, accion: { label: 'Ver catálogo', view: 'catalogo' } });
  }
  // Recordatorio de cierre: una hora antes del horario que dijo el usuario,
  // o desde las 19 si no dijo ninguno.
  const horaCierre = tikiRecuerda('horario_cierre');
  const ahora = new Date();
  const desdeMin = horaCierre ? horaCierre.hora * 60 + horaCierre.minuto - 60 : 19 * 60;
  if(ahora.getHours() * 60 + ahora.getMinutes() >= desdeMin && tikiMovs(hoy, hoy).length && !cierreDeFecha(hoy)){
    tareas.push({ nivel: 'info', html: `Antes de irte, cerrar la caja de hoy (tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(hoy))}</strong> en efectivo).`, accion: { label: 'Cerrar la caja de hoy', view: 'caja', fecha: hoy } });
  }

  if(!tareas.length){
    const r = tikiResumen(ayer, ayer);
    return { html: `<p>Por ahora está todo en orden: no hay cajas sin cerrar, ni productos por agotarse, ni deudas con proveedores.</p>${r.cantVentas ? `<p>Ayer vendiste <strong>${tikiPlata(r.ventas)}</strong>.</p>` : ''}` };
  }
  const orden = { urgente: 0, pronto: 1, info: 2, bien: 3 };
  tareas.sort((a,b) => orden[a.nivel] - orden[b.nivel]);
  const acciones = [];
  tareas.forEach(t => { if(t.accion && !acciones.some(a => a.label === t.accion.label)) acciones.push(t.accion); });
  return {
    html: `<p>${tareas.length === 1 ? 'Para hoy hay una sola cosa:' : `Para hoy hay ${tareas.length} cosas, de la más urgente a la menos:`}</p>
      <ul class="tiki-list">${tareas.map(t => `<li class="${t.nivel}"><span>${t.html}</span></li>`).join('')}</ul>`,
    acciones: acciones.slice(0, 3),
    ctx: { tema: 'plan' }
  };
}

function tikiCierre(periodo){
  const hoy = todayStr();
  const irACaja = (fecha) => ({ label: `Cerrar la caja ${tikiDeDia(fecha)}`, view: 'caja', fecha });
  if(!cierresCaja.length && !periodo){
    const ayer = tikiSumarDias(hoy, -1);
    const f = tikiMovs(ayer, ayer).length ? ayer : hoy;
    return {
      html: `<p>Todavía no cerraste ninguna caja. El cierre compara el efectivo que tendría que haber según lo cargado con lo que contás en la caja: así un faltante se detecta el mismo día.</p>${tikiMovs(f, f).length ? `<p>Según lo cargado ${tikiLabelDia(f)}, tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(f))}</strong> en efectivo.</p>` : ''}`,
      acciones: [irACaja(f)]
    };
  }
  if(periodo && !periodo.dia) return tikiCierresRango(periodo);

  const ordenados = [...cierresCaja].sort((a,b) => b.fecha.localeCompare(a.fecha));
  const fecha = periodo ? periodo.desde : ordenados[0].fecha;
  const c = cierreDeFecha(fecha);
  const label = tikiLabelDia(fecha);
  if(!c){
    if(!tikiMovs(fecha, fecha).length) return { html: `<p>${tikiCap(label)} no hay cierre de caja ni movimientos cargados.</p>` };
    const rs = tikiResumen(fecha, fecha);
    const vendido = rs.cantVentas ? ` Ese día vendiste ${tikiPlata(rs.ventas)} en ${rs.cantVentas} ${rs.cantVentas === 1 ? 'venta' : 'ventas'}.` : '';
    return { html: `<p>${tikiCap(label)} todavía no cerraste la caja. Según lo cargado, tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(fecha))}</strong> en efectivo.${vendido}</p>`, acciones: [irACaja(fecha)], ctx: { tema: 'cierreAbierto', fecha } };
  }

  // Primero el veredicto (es lo que el comerciante quiere saber), despues el detalle.
  const dif = Number(c.diferencia) || 0;
  const esperado = tikiPlata(c.efectivo_esperado), contado = tikiPlata(c.efectivo_contado);
  let html = Math.abs(dif) < 1
    ? `<p>${tikiUnaDe(['Todo en orden', 'Bien ahí'])}: la caja ${tikiDeDia(fecha)} <span class="tiki-pos">dio justo</span>. Esperabas <strong>${esperado}</strong> en efectivo y contaste lo mismo.</p>`
    : dif < 0
      ? `<p>Ojo: en el cierre ${tikiDeDia(fecha)} <span class="tiki-neg">faltaron ${tikiPlata(-dif)}</span>. Esperabas <strong>${esperado}</strong> en efectivo y contaste <strong>${contado}</strong>.</p>`
      : `<p>En el cierre ${tikiDeDia(fecha)} <strong>sobraron ${tikiPlata(dif)}</strong>: esperabas <strong>${esperado}</strong> en efectivo y contaste <strong>${contado}</strong>.</p><p class="tiki-soft">Cuando sobra plata, muchas veces es una venta que no se cargó.</p>`;
  if(c.notas) html += `<p class="tiki-soft">Anotaste: “${escapeHtml(c.notas)}”</p>`;

  const acciones = [];
  const ultimos = ordenados.filter(x => x.fecha <= fecha).slice(0, 7);
  const faltantes = ultimos.filter(x => (Number(x.diferencia) || 0) <= -1).length;
  const avisoFaltantes = dif <= -1 && faltantes >= 3;
  if(avisoFaltantes){
    html += `<p>Y no es la primera vez: es el faltante número ${faltantes} en tus últimos ${ultimos.length} cierres. Conviene revisar si quedan ventas sin cargar o cómo se está dando el vuelto.</p>`;
  }
  if(!periodo){
    const ayer = tikiSumarDias(hoy, -1);
    if(fecha < ayer && tikiMovs(ayer, ayer).length && !cierreDeFecha(ayer)){
      html += `<p>${avisoFaltantes ? 'Además, la' : 'Ojo: la'} caja de ayer todavía no la cerraste.</p>`;
      acciones.push(irACaja(ayer));
    }
  }
  return {
    html, acciones, ctx: { tema: 'cierre', fecha, dif },
    sugerencia: dif <= -1 ? { texto: '¿Querés que veamos de dónde puede venir la diferencia?', pregunta: '¿por qué?' } : null
  };
}
function tikiCierresRango(p){
  const hoy = todayStr();
  const enRango = cierresCaja.filter(c => c.fecha >= p.desde && c.fecha <= p.hasta);
  const sinCerrar = [...new Set(tikiMovs(p.desde, p.hasta).map(e => e.fecha))].filter(f => f !== hoy && !cierreDeFecha(f)).sort();
  if(!enRango.length && !sinCerrar.length) return { html: `<p>${tikiCap(p.label)} no hay cierres de caja guardados.</p>` };
  const difDe = (c) => Number(c.diferencia) || 0;
  const justos = enRango.filter(c => Math.abs(difDe(c)) < 1).length;
  const falt = enRango.filter(c => difDe(c) <= -1);
  const sobr = enRango.filter(c => difDe(c) >= 1);
  const items = [];
  if(justos) items.push(`<li class="bien"><span>${justos === 1 ? 'Un día dio' : `${justos} días dieron`} justo</span></li>`);
  if(falt.length) items.push(`<li class="urgente"><span>${falt.length === 1 ? 'Un día faltó' : `${falt.length} días faltó`} plata: <strong>${tikiPlata(-falt.reduce((s,c) => s + difDe(c), 0))}</strong> en total</span></li>`);
  if(sobr.length) items.push(`<li class="pronto"><span>${sobr.length === 1 ? 'Un día sobró' : `${sobr.length} días sobró`} plata: ${tikiPlata(sobr.reduce((s,c) => s + difDe(c), 0))} en total</span></li>`);
  if(sinCerrar.length) items.push(`<li><span>${sinCerrar.length === 1 ? 'Un día quedó' : `${sinCerrar.length} días quedaron`} sin cerrar: ${tikiListaNombres(sinCerrar.map(tikiFechaCorta), true, 5)}</span></li>`);
  const intro = enRango.length
    ? `${tikiCap(p.label)} cerraste la caja ${enRango.length} ${enRango.length === 1 ? 'vez' : 'veces'}:`
    : `${tikiCap(p.label)} no cerraste la caja ningún día:`;
  return {
    html: `<p>${intro}</p><ul class="tiki-list">${items.join('')}</ul>`,
    acciones: sinCerrar.length ? [{ label: `Cerrar la caja ${tikiDeDia(sinCerrar[sinCerrar.length - 1])}`, view: 'caja', fecha: sinCerrar[sinCerrar.length - 1] }] : []
  };
}

function tikiDeudas(provs, sobrantes){
  const accion = [{ label: 'Ver proveedores', view: 'catalogo', tab: 'proveedores' }];
  if(!proveedores.length) return { html: '<p>Todavía no anotaste proveedores. Si los cargás en Catálogo › Proveedores (con sus pedidos), te digo cuánto le debés a cada uno.</p>', acciones: accion };
  const lista = tikiDeudasLista();
  if(provs && provs.length){
    return {
      html: provs.map(p => {
        const d = lista.find(x => x.p.id === p.id);
        if(!d) return `<p>Con <strong>${escapeHtml(p.nombre)}</strong> estás al día: no tenés pedidos sin pagar.</p>`;
        return `<p>A <strong>${escapeHtml(p.nombre)}</strong> le debés <strong>${tikiPlata(d.total)}</strong> en ${d.cant} ${d.cant === 1 ? 'pedido' : 'pedidos'}${d.desde ? `; el más viejo es del ${tikiFechaCorta(d.desde)}` : ''}.</p>`;
      }).join(''),
      acciones: accion,
      ctx: { tema: 'deudas' },
      sugerencia: lista.length ? { texto: '¿Te digo a quién conviene pagarle primero?', pregunta: '¿qué hago?' } : null
    };
  }
  const aviso = sobrantes && sobrantes.length ? `<p class="tiki-soft">No encontré a «${escapeHtml(sobrantes.join(' '))}» entre tus proveedores, así que te paso todos.</p>` : '';
  if(!lista.length) return { html: `${aviso}<p>No le debés nada a ningún proveedor: todos los pedidos están pagados.</p>`, acciones: accion };
  const total = lista.reduce((s,d) => s + d.total, 0);
  return {
    html: `${aviso}<p>En total le debés <strong>${tikiPlata(total)}</strong> a ${lista.length === 1 ? 'un proveedor' : `${lista.length} proveedores`}:</p>
      <ul class="tiki-list">${lista.slice(0, 6).map(d => `<li class="pronto"><span><strong>${escapeHtml(d.p.nombre)}</strong>: ${tikiPlata(d.total)} <span class="tiki-soft">· desde el ${tikiFechaCorta(d.desde)}</span></span></li>`).join('')}</ul>
      ${lista.length > 6 ? `<p class="tiki-soft">Y ${lista.length - 6} más.</p>` : ''}`,
    acciones: accion,
    ctx: { tema: 'deudas' },
    sugerencia: { texto: '¿Te digo a quién conviene pagarle primero?', pregunta: '¿qué hago?' }
  };
}

function tikiStockTexto(p){
  const stock = Number(p.stock_actual) || 0;
  const nombre = escapeHtml(p.nombre);
  let txt = stock <= 0
    ? `No te queda <strong>${nombre}</strong>: el stock está en 0.`
    : `Te ${stock === 1 ? 'queda' : 'quedan'} <strong>${tikiNum(stock)}</strong> de ${nombre}.`;
  const rate = ventaDiariaDe(p);
  if(stock > 0 && rate > 0){
    const dias = Math.floor(stock / rate);
    txt += dias < 1
      ? ' Al ritmo de las últimas dos semanas, <span class="tiki-neg">se termina hoy</span>.'
      : ` Al ritmo de las últimas dos semanas (unas ${tikiNum(rate)} por día) te alcanza para <strong>~${dias} ${dias === 1 ? 'día' : 'días'}</strong>.`;
  } else if(stock > 0){
    txt += ' En las últimas dos semanas no registraste ventas de este producto.';
  }
  const min = p.stock_minimo;
  if(stock > 0 && min !== null && min !== undefined && min !== '' && stock <= Number(min)) txt += ` Ya llegaste al mínimo que pusiste (${tikiNum(min)}).`;
  return txt;
}
function tikiStock(prods){
  if(prods.length === 1){
    return { html: `<p>${tikiStockTexto(prods[0])}</p>`, ctx: { tema: 'stock', prods }, sugerencia: { texto: '¿Querés ver todo lo que hay que reponer?', pregunta: '¿Qué tengo que reponer?' } };
  }
  return {
    ctx: { tema: 'stock', prods },
    html: `<p>Encontré ${prods.length} productos parecidos:</p>
      <ul class="tiki-list">${prods.slice(0, 8).map(p => {
        const stock = Number(p.stock_actual) || 0;
        const rate = ventaDiariaDe(p);
        const dias = rate > 0 ? Math.floor(stock / rate) : 0;
        const extra = stock > 0 && rate > 0 ? ` <span class="tiki-soft">· ${dias < 1 ? 'se agota hoy' : `~${dias} ${dias === 1 ? 'día' : 'días'}`}</span>` : '';
        return `<li class="${stock <= 0 ? 'urgente' : ''}"><span>${escapeHtml(p.nombre)}: <strong>${tikiNum(stock)}</strong>${extra}</span></li>`;
      }).join('')}</ul>`
  };
}
function tikiReponer(sobrantes){
  if(!products.length) return { html: '<p>Todavía no cargaste productos en el catálogo, así que no sé qué stock tenés. Cuando los cargues con su stock, te aviso qué se está por terminar.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const aviso = sobrantes && sobrantes.length ? `<p class="tiki-soft">No encontré «${escapeHtml(sobrantes.join(' '))}» en tu catálogo, así que te paso todo lo que hay para reponer.</p>` : '';
  const lista = tikiParaReponer();
  if(!lista.length) return { html: `${aviso}<p>Con las ventas de las últimas dos semanas no hay nada por terminarse, y ningún producto está por debajo del mínimo que configuraste.</p>` };
  return {
    html: `${aviso}<p>Esto es lo que conviene reponer:</p>
      <ul class="tiki-list">${lista.slice(0, 8).map(r => `<li class="${r.dias !== null && r.dias <= 2 ? 'urgente' : 'pronto'}"><span><strong>${escapeHtml(r.nombre)}</strong>: ${r.largo}</span></li>`).join('')}</ul>
      ${lista.length > 8 ? `<p class="tiki-soft">Y ${lista.length - 8} más.</p>` : ''}
      <p class="tiki-soft">Lo calculo con lo que vendiste en las últimas dos semanas.</p>`,
    acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }],
    ctx: { tema: 'stock', prods: [] },
    sugerencia: { texto: '¿Te digo por dónde empezar?', pregunta: '¿qué hago?' }
  };
}

function tikiProducto(p){
  const precio = Number(p.precio_venta) || 0, costo = Number(p.costo_unitario) || 0;
  const nombre = escapeHtml(p.nombre);
  let html;
  if(precio > 0 && costo > 0){
    const gan = precio - costo;
    html = `<p><strong>${nombre}</strong>: lo vendés a <strong>${tikiPlata(precio)}</strong> y te cuesta ${tikiPlata(costo)}, así que te deja <span class="${gan > 0 ? 'tiki-pos' : 'tiki-neg'}">${tikiPlata(gan)}</span> por unidad (${Math.round(gan / precio * 100)}% de margen).</p>`;
  } else if(precio > 0){
    html = `<p><strong>${nombre}</strong>: lo vendés a <strong>${tikiPlata(precio)}</strong>. No tiene el costo cargado, así que no sé cuánto te deja.</p>`;
  } else {
    html = `<p><strong>${nombre}</strong> no tiene precio cargado en el catálogo.</p>`;
  }
  html += `<p>${tikiStockTexto(p)}</p>`;
  const p30 = tikiUltimos30();
  const v = tikiAgruparVentas(tikiMovs(p30.desde, p30.hasta, 'Venta').filter(e => tikiNorm(e.descripcion) === tikiNorm(p.nombre)))[0];
  html += v
    ? `<p>En los últimos 30 días vendiste <strong>${tikiNum(v.cantidad)}</strong> por ${tikiPlata(v.monto)}.</p>`
    : '<p>En los últimos 30 días no registraste ventas de este producto.</p>';
  return { html, ctx: { tema: 'producto', prod: p }, sugerencia: { texto: '¿Querés ver cuánto vendiste este mes?', pregunta: `¿Cuánto vendí de ${p.nombre} este mes?` } };
}
function tikiVariosProductos(prods){
  return {
    html: `<p>Encontré ${prods.length} productos con ese nombre. ¿Cuál querés ver?</p>`,
    acciones: prods.slice(0, 6).map(p => ({ label: p.nombre, pregunta: p.nombre }))
  };
}

function tikiVentasProducto(nombres, periodo){
  const p = periodo || tikiUltimos30();
  const keys = new Set(nombres.map(tikiNorm));
  const grupos = tikiAgruparVentas(tikiMovs(p.desde, p.hasta, 'Venta').filter(e => keys.has(tikiNorm(e.descripcion))));
  const nombreTxt = tikiListaNombres(nombres.map(n => `<strong>${escapeHtml(n)}</strong>`), true);
  if(!grupos.length) return { html: `<p>${tikiCap(p.label)} no registraste ventas de ${nombreTxt}.</p>` };
  const tot = grupos.reduce((a,g) => ({ monto: a.monto + g.monto, cantidad: a.cantidad + g.cantidad, ganancia: a.ganancia + g.ganancia, conCosto: a.conCosto + g.conCosto, n: a.n + g.n }), { monto: 0, cantidad: 0, ganancia: 0, conCosto: 0, n: 0 });
  let html = `<p>${tikiCap(p.label)} vendiste <strong>${tikiNum(tot.cantidad)}</strong> ${tot.cantidad === 1 ? 'unidad' : 'unidades'} de ${nombreTxt} por <strong>${tikiPlata(tot.monto)}</strong>`;
  if(tot.conCosto === tot.n) html += `, y te dejaron <span class="tiki-pos">${tikiPlata(tot.ganancia)}</span> de ganancia`;
  html += '.</p>';
  if(tot.conCosto < tot.n) html += `<p class="tiki-soft">${tot.conCosto === 0 ? 'Esas ventas no tienen' : `${tot.n - tot.conCosto} de esas ventas no tienen`} el costo cargado, así que no puedo calcular cuánto te ${tot.conCosto === 0 ? 'dejaron' : 'dejaron en total'}.</p>`;
  if(grupos.length > 1) html += tikiBarras(grupos.sort((a,b) => b.monto - a.monto).slice(0, 6).map((g,i) => ({ label: g.nombre, valor: g.monto, texto: `${tikiNum(g.cantidad)} u. · ${tikiPlata(g.monto)}`, top: i === 0 })), true);
  return { html, ctx: { tema: 'ventasProducto', p, nombres } };
}

function tikiTextoMeta(vendido, meta, enCurso, sujeto){
  const pct = Math.round(vendido / meta * 100);
  const quien = sujeto ? `${sujeto} ` : '';
  if(pct >= 100) return `${quien}${sujeto ? 'llegaste' : 'Llegaste'} a tu meta de ${tikiPlata(meta)}: <span class="tiki-pos">${pct}%</span>.`;
  return `${quien}${sujeto ? (enCurso ? 'vas' : 'llegaste') : (enCurso ? 'Vas' : 'Llegaste')} al <strong>${pct}%</strong> de tu meta de ${tikiPlata(meta)}${enCurso ? ` (te faltan ${tikiPlata(meta - vendido)})` : ''}.`;
}
function tikiVentas(periodo, foco){
  const hoy = todayStr();
  const p = periodo || { desde: hoy, hasta: hoy, label: 'hoy', dia: true };
  const r = tikiResumen(p.desde, p.hasta);
  if(!r.cantVentas && !r.gastos) return { html: `<p>${tikiCap(p.label)} no hay ventas ni gastos cargados.</p>` };
  if(!r.cantVentas) return { html: `<p>${tikiCap(p.label)} no hay ventas cargadas. Gastos: ${tikiPlata(r.gastos)}.</p>` };
  const enCurso = p.hasta === hoy;
  const verbo = enCurso ? 'va en' : 'fue de';
  const gan = `<strong class="${r.ganancia >= 0 ? 'tiki-pos' : 'tiki-neg'}">${tikiPlata(r.ganancia)}</strong>`;
  let html = foco === 'ganancia'
    ? `<p>${tikiCap(p.label)} la ganancia real ${verbo} ${gan}: vendiste ${tikiPlata(r.ventas)}${r.gastos ? `, la mercadería te costó ${tikiPlata(r.costoMerc)} y gastaste ${tikiPlata(r.gastos)}` : ` y la mercadería te costó ${tikiPlata(r.costoMerc)}`}.</p>`
    : `<p>${tikiCap(p.label)} vendiste <strong>${tikiPlata(r.ventas)}</strong> en ${r.cantVentas} ${r.cantVentas === 1 ? 'venta' : 'ventas'}${r.gastos ? ` y gastaste ${tikiPlata(r.gastos)}` : ''}. La ganancia real ${verbo} ${gan}.</p>`;
  // Una reaccion corta, solo si los numeros la justifican: un dia ya
  // terminado contra el promedio de ese mismo dia de la semana.
  if(foco !== 'ganancia' && p.dia && p.desde !== hoy){
    const { prom, n } = tikiPromedioMismoDia(p.desde);
    if(n >= 3 && prom > 0){
      const pct = (r.ventas - prom) / prom;
      if(pct >= 0.15) html = `<p><strong>${tikiUnaDe(['¡Buen día!', 'Fue un buen día.'])}</strong></p>` + html;
      else if(pct <= -0.15) html = `<p><strong>${tikiUnaDe(['Fue un día flojo.', 'Vino más tranquilo que de costumbre.'])}</strong></p>` + html;
    }
  }

  if(p.dia){
    const ant = tikiSumarDias(p.desde, -7);
    const v = tikiVariacion(r.ventas, tikiResumen(ant, ant).ventas);
    if(v) html += `<p>Vendiste ${v} el ${tikiDiaSemana(ant)} anterior${p.desde === hoy ? ' (y el día todavía no terminó)' : ''}.</p>`;
    const meta = tikiRecuerda('meta_venta_diaria');
    if(meta) html += `<p>${tikiTextoMeta(r.ventas, meta.monto, p.desde === hoy)}</p>`;
  } else if(p.semana){
    const v = tikiVariacion(r.ventas, tikiResumen(tikiSumarDias(p.desde, -7), tikiSumarDias(p.hasta, -7)).ventas);
    if(v) html += `<p>Vas ${v} la semana pasada a esta altura.</p>`;
  }
  if(r.ventas > 0 && r.cantVentas >= 2){
    const porMetodo = {};
    r.lista.forEach(e => { const m = e.metodoPago || 'Otro'; porMetodo[m] = (porMetodo[m] || 0) + (Number(e.monto) || 0); });
    // "Efectivo" -> "efectivo" en medio de la frase, pero "QR" queda "QR".
    const partes = Object.entries(porMetodo).sort((a,b) => b[1] - a[1]).map(([m,v]) => `${escapeHtml(m === m.toUpperCase() ? m : m.toLowerCase())} ${Math.round(v / r.ventas * 100)}%`);
    if(partes.length > 1) html += `<p class="tiki-soft">Cómo te pagaron: ${partes.join(', ')}.</p>`;
  }
  if(r.sinCosto) html += `<p class="tiki-soft">${r.sinCosto === r.cantVentas ? 'Ninguna de esas ventas tiene' : r.sinCosto === 1 ? 'Una de esas ventas no tiene' : `${r.sinCosto} de esas ventas no tienen`} el costo cargado: la ganancia real puede ser menor.</p>`;
  return {
    html, ctx: { tema: 'ventas', p, r, foco },
    sugerencia: foco === 'ganancia'
      ? { texto: '¿Querés que te muestre cómo se calcula?', pregunta: '¿por qué?' }
      : { texto: '¿Querés ver qué fue lo que más vendiste?', pregunta: `¿Qué fue lo que más vendí ${p.label}?` }
  };
}

function tikiComoVengo(){
  const hoy = todayStr();
  const d = tikiParse(hoy);
  const desde = hoy.slice(0, 8) + '01';
  const r = tikiResumen(desde, hoy);
  const mes = TIKI_MESES[d.getMonth()];
  if(!r.cantVentas && !r.gastos) return { html: `<p>En ${mes} todavía no hay ventas ni gastos cargados.</p>`, acciones: [{ label: 'Cargar una venta', view: 'cargar' }] };
  let html = `<p>En lo que va de ${mes} vendiste <strong>${tikiPlata(r.ventas)}</strong> y la ganancia real es de <strong class="${r.ganancia >= 0 ? 'tiki-pos' : 'tiki-neg'}">${tikiPlata(r.ganancia)}</strong>.</p>`;
  const finPrev = new Date(d.getFullYear(), d.getMonth(), 0);
  const corte = Math.min(d.getDate(), finPrev.getDate());
  const rp = tikiResumen(tikiFecha(new Date(finPrev.getFullYear(), finPrev.getMonth(), 1)), tikiFecha(new Date(finPrev.getFullYear(), finPrev.getMonth(), corte)));
  if(rp.ventas > 0){
    const mesPrev = TIKI_MESES[finPrev.getMonth()];
    const contra = corte === 1 ? `el 1 de ${mesPrev}` : `los primeros ${corte} días de ${mesPrev}`;
    const vg = rp.ganancia > 0 ? tikiVariacion(r.ganancia, rp.ganancia) : '';
    html += `<p>Contra ${contra}: vendiste ${tikiVariacion(r.ventas, rp.ventas)} entonces${vg ? `, y ganaste ${vg} entonces` : ''}.</p>`;
  }
  const diasConVentas = new Set(r.lista.map(e => e.fecha)).size;
  if(diasConVentas > 1) html += `<p>En promedio vendés <strong>${tikiPlata(r.ventas / diasConVentas)}</strong> por día abierto.</p>`;
  const meta = tikiRecuerda('meta_venta_diaria');
  if(meta && diasConVentas > 0){
    const llegaron = [...new Set(r.lista.map(e => e.fecha))].filter(f => tikiResumen(f, f).ventas >= meta.monto).length;
    html += `<p>Llegaste a tu meta de ${tikiPlata(meta.monto)} en <strong>${llegaron} de ${diasConVentas}</strong> ${diasConVentas === 1 ? 'día' : 'días'} con ventas.</p>`;
  }
  const top = tikiAgruparVentas(r.lista).sort((a,b) => b.monto - a.monto)[0];
  if(top) html += `<p>Lo que más facturó: <strong>${escapeHtml(top.nombre)}</strong> (${tikiPlata(top.monto)}).</p>`;
  if(r.sinCosto) html += `<p class="tiki-soft">${r.sinCosto} ${r.sinCosto === 1 ? 'venta no tiene' : 'ventas no tienen'} el costo cargado: la ganancia real puede ser menor.</p>`;
  return { html, ctx: { tema: 'mes', r }, sugerencia: { texto: '¿Te muestro qué día de la semana vendés más?', pregunta: '¿Qué día vendo más?' } };
}

// ---------- Punto de equilibrio y objetivos ----------
// Dos piezas:
//  - Margen de contribución %: lo que deja cada $100 de venta después de
//    pagar la mercadería, medido sobre las ventas que TIENEN costo cargado
//    (ventas - costo) / ventas. Si pocas ventas tienen costo, se avisa.
//  - Gastos operativos del mes: alquiler, servicios, sueldos, impuestos,
//    otros -- TODO menos "Mercadería" (esa compra ya está en el costo de
//    cada venta; contarla de nuevo sería doble). Se toma el último mes
//    completo como referencia; si no hay, el mes en curso.
// Punto de equilibrio = gastos operativos / margen de contribución.
// Objetivo de ganancia X por mes: ventas = (X + gastos operativos) / margen.
function tikiMargenContrib(dias = 30){
  const hasta = todayStr();
  const desde = tikiSumarDias(hasta, -(dias - 1));
  const ventas = tikiMovs(desde, hasta, 'Venta');
  const conCosto = ventas.filter(e => parseFloat(e.costoTotal) > 0);
  const vMed = conCosto.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  const cMed = conCosto.reduce((s,e) => s + (parseFloat(e.costoTotal) || 0), 0);
  const vTot = ventas.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  return {
    pct: vMed > 0 ? (vMed - cMed) / vMed : null,  // 0..1, o null si no hay con qué medir
    cobertura: vTot > 0 ? vMed / vTot : 0,         // qué parte de las ventas tenía costo
    hayVentas: vTot > 0
  };
}
function tikiGastosOperativosMes(){
  const hoy = todayStr();
  const d = tikiParse(hoy);
  const sumaOperativos = (desde, hasta) => tikiMovs(desde, hasta, 'Gasto')
    .filter(e => (e.categoria || '') !== 'Mercadería')
    .reduce((s,e) => s + (Number(e.monto) || 0), 0);
  // Mes anterior completo como referencia estable; si no hay nada, el mes en curso.
  const iniPrev = tikiFecha(new Date(d.getFullYear(), d.getMonth() - 1, 1));
  const finPrev = tikiFecha(new Date(d.getFullYear(), d.getMonth(), 0));
  const prev = sumaOperativos(iniPrev, finPrev);
  const esteMes = sumaOperativos(hoy.slice(0, 8) + '01', hoy);
  if(prev > 0) return { monto: prev, ref: `de ${TIKI_MESES[tikiParse(iniPrev).getMonth()]}`, completo: true };
  if(esteMes > 0) return { monto: esteMes, ref: 'de este mes (todavía incompleto)', completo: false };
  return { monto: 0, ref: null, completo: false };
}
function tikiDiasAbiertosMes(){
  const cerrados = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias.length;
  return Math.max(1, Math.round(30 - cerrados * 30 / 7));
}
// Falta algún dato para calcular equilibrio/objetivo: devuelve el aviso, o null.
function tikiFaltaParaEquilibrio(margen, gastos){
  if(!margen.hayVentas) return { html: '<p>Para eso necesito tus ventas cargadas. Cuando registres unos días de ventas, te lo calculo.</p>', acciones: [{ label: 'Cargar una venta', view: 'cargar' }] };
  if(margen.pct === null) return { html: '<p>Para calcular el punto de equilibrio necesito saber cuánto te deja cada venta, y para eso las ventas tienen que tener el costo cargado. Se completa solo cuando el producto del catálogo tiene su costo.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  if(margen.pct <= 0) return { html: '<p>Con los datos de este último mes estás vendiendo <strong>al costo o por debajo</strong> (no te queda margen después de pagar la mercadería), así que no hay un punto de equilibrio posible: primero habría que recuperar margen subiendo algún precio o bajando costos.</p>', sugerencia: { texto: '¿Querés ver qué productos te dejan menos?', pregunta: '¿Qué producto me deja menos?' } };
  if(!gastos.monto) return { html: '<p>Para calcular cuánto necesitás vender para cubrir tus gastos, primero cargá tus gastos del mes (alquiler, servicios, sueldos, impuestos). Sin eso solo puedo decirte el margen, no el punto de equilibrio.</p>', acciones: [{ label: 'Cargar un gasto', view: 'cargar', tipo: 'Gasto' }] };
  return null;
}
function tikiEquilibrio(){
  const margen = tikiMargenContrib(30);
  const gastos = tikiGastosOperativosMes();
  const falta = tikiFaltaParaEquilibrio(margen, gastos);
  if(falta) return falta;
  const ventasEq = gastos.monto / margen.pct;
  const dias = tikiDiasAbiertosMes();
  const porDia = ventasEq / dias;
  let html = `<p>Para cubrir tus gastos necesitás vender alrededor de <strong>${tikiPlata(ventasEq)}</strong> por mes, o sea unos <strong>${tikiPlata(porDia)}</strong> por día abierto.</p>`;
  html += `<p class="tiki-soft">Lo calculo así: de cada $100 que vendés te quedan ${tikiPlata(Math.round(margen.pct * 100))} después de pagar la mercadería, y tus gastos ${gastos.ref} suman ${tikiPlata(gastos.monto)} (sin contar la compra de mercadería, que ya está en el costo de cada venta). Es una estimación con tus números de las últimas semanas.</p>`;
  if(margen.cobertura < 0.6) html += `<p class="tiki-soft">Ojo: muchas de tus ventas no tienen el costo cargado, así que el margen puede ser menos preciso.</p>`;
  return { html, ctx: { tema: 'equilibrio', margen, gastos, ventasEq }, sugerencia: { texto: '¿Querés que lo calcule para una meta de ganancia?', pregunta: '¿Cuánto tengo que vender para ganar 500000 por mes?' } };
}
function tikiObjetivo(montoMensual){
  const margen = tikiMargenContrib(30);
  const gastos = tikiGastosOperativosMes();
  const falta = tikiFaltaParaEquilibrio(margen, gastos);
  if(falta) return falta;
  const ventasNec = (montoMensual + gastos.monto) / margen.pct;
  const dias = tikiDiasAbiertosMes();
  const porDia = ventasNec / dias;
  let html = `<p>Para ganar <strong>${tikiPlata(montoMensual)}</strong> limpios en el mes, tendrías que vender alrededor de <strong>${tikiPlata(ventasNec)}</strong>, o sea unos <strong>${tikiPlata(porDia)}</strong> por día abierto.</p>`;
  html += `<p class="tiki-soft">Sale de sumar tu objetivo (${tikiPlata(montoMensual)}) más tus gastos ${gastos.ref} (${tikiPlata(gastos.monto)}), dividido tu margen de ${tikiPlata(Math.round(margen.pct * 100))} por cada $100. Es una estimación.</p>`;
  // ¿Cómo viene contra el ritmo actual?
  const r30 = tikiResumen(tikiSumarDias(todayStr(), -29), todayStr());
  if(r30.ventas > 0){
    const ritmoMensual = r30.ventas; // ~30 días
    const v = tikiVariacion(ritmoMensual, ventasNec);
    if(ritmoMensual >= ventasNec) html += `<p>Buena noticia: al ritmo de los últimos 30 días (${tikiPlata(ritmoMensual)}) ya estarías llegando.</p>`;
    else html += `<p>Hoy venís a un ritmo de ${tikiPlata(ritmoMensual)} por mes, así que te faltaría vender un poco más para llegar.</p>`;
  }
  return { html, ctx: { tema: 'objetivo', montoMensual, ventasNec }, sugerencia: { texto: '¿Querés ver qué producto te deja más para enfocarte ahí?', pregunta: '¿Qué producto me deja más ganancia?' } };
}

// ---------- Categorías ----------
// Las ventas guardan el nombre, no la categoría: se cruza el nombre con el
// catálogo para saber a qué categoría pertenece cada venta. Lo que no
// matchea un producto del catálogo no entra (se avisa si es mucho).
function tikiMapaCategorias(){
  const m = new Map();
  products.forEach(p => { const k = tikiNorm(p.nombre); const c = (p.categoria || '').trim(); if(k && c) m.set(k, c); });
  return m;
}
function tikiMetricasCategorias(desde, hasta){
  const mapa = tikiMapaCategorias();
  const cats = new Map();
  let sinCat = 0, totalVentas = 0;
  tikiMovs(desde, hasta, 'Venta').forEach(e => {
    const monto = Number(e.monto) || 0;
    totalVentas += monto;
    const c = mapa.get(tikiNorm(e.descripcion));
    if(!c){ sinCat += monto; return; }
    const g = cats.get(c) || { ventas: 0, costo: 0, unidades: 0, conCosto: 0, n: 0 };
    g.ventas += monto;
    g.unidades += Number(e.cantidad) || 1;
    if(parseFloat(e.costoTotal) > 0){ g.costo += parseFloat(e.costoTotal); g.conCosto += monto; }
    g.n++;
    cats.set(c, g);
  });
  return { cats, sinCat, totalVentas, catList: [...cats.entries()].map(([nombre, g]) => ({ nombre, ...g, margenPct: g.conCosto > 0 ? (g.conCosto - g.costo) / g.conCosto : null })) };
}
function tikiCategoriasPresentes(){
  return [...new Set(products.map(p => (p.categoria || '').trim()).filter(Boolean))];
}
function tikiCategorias(periodo){
  const p = periodo || tikiUltimos30();
  if(!products.length || !tikiCategoriasPresentes().length) return { html: '<p>Para analizar por categoría necesito que tus productos del catálogo tengan una categoría asignada (Bebidas, Golosinas, etc.).</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const r = tikiMetricasCategorias(p.desde, p.hasta);
  if(!r.catList.length) return { html: `<p>${tikiCap(p.label)} no pude agrupar ventas por categoría (las ventas no coinciden con productos del catálogo que tengan categoría).</p>` };
  const orden = r.catList.sort((a,b) => b.ventas - a.ventas);
  let html = `<p>${tikiCap(p.label)}, por categoría:</p>${tikiBarras(orden.map((c,i) => ({ label: c.nombre, valor: c.ventas, texto: c.margenPct !== null ? `${tikiPlata(c.ventas)} · ${Math.round(c.margenPct * 100)}%` : tikiPlata(c.ventas), top: i === 0 })), true)}`;
  const conMargen = orden.filter(c => c.margenPct !== null);
  if(conMargen.length > 1){
    const mejor = [...conMargen].sort((a,b) => b.margenPct - a.margenPct)[0];
    html += `<p class="tiki-soft">La que mejor margen te deja es <strong>${escapeHtml(mejor.nombre)}</strong> (${Math.round(mejor.margenPct * 100)}%).</p>`;
  }
  if(r.sinCat > r.totalVentas * 0.25) html += `<p class="tiki-soft">Ojo: ${Math.round(r.sinCat / r.totalVentas * 100)}% de lo que vendiste no está en el catálogo con categoría, así que quedó afuera.</p>`;
  return { html, ctx: { tema: 'categorias', p }, sugerencia: { texto: '¿Querés ver qué categoría está creciendo?', pregunta: '¿Qué categoría está creciendo?' } };
}
// Una categoría del catálogo nombrada en la pregunta (singular/plural simple).
function tikiCategoriaEnTexto(t){
  for(const c of tikiCategoriasPresentes()){
    const n = tikiNorm(c);
    if(new RegExp('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + 's?\\b').test(t)) return c;
  }
  return null;
}
function tikiVentasCategoria(cat, periodo){
  const p = periodo || tikiUltimos30();
  const g = tikiMetricasCategorias(p.desde, p.hasta).cats.get(cat);
  if(!g || !g.ventas) return { html: `<p>${tikiCap(p.label)} no registré ventas de <strong>${escapeHtml(cat)}</strong> (según los productos del catálogo que tienen esa categoría).</p>` };
  let html = `<p>${tikiCap(p.label)} vendiste <strong>${tikiPlata(g.ventas)}</strong> en ${escapeHtml(cat)} (${g.n} ${g.n === 1 ? 'venta' : 'ventas'})`;
  if(g.conCosto > 0){ const margen = (g.conCosto - g.costo) / g.conCosto; html += `, con un margen de <strong>${Math.round(margen * 100)}%</strong>`; }
  html += '.</p>';
  return { html, ctx: { tema: 'categorias', p } };
}
function tikiCategoriaCrece(){
  if(!tikiCategoriasPresentes().length) return tikiCategorias();
  const hoy = todayStr();
  const act = tikiMetricasCategorias(tikiSumarDias(hoy, -29), hoy).cats;
  const prev = tikiMetricasCategorias(tikiSumarDias(hoy, -59), tikiSumarDias(hoy, -30)).cats;
  const difs = [];
  act.forEach((g, c) => {
    const antes = prev.get(c);
    if(antes && antes.ventas > 0) difs.push({ cat: c, pct: (g.ventas - antes.ventas) / antes.ventas, act: g.ventas, prev: antes.ventas });
  });
  if(difs.length < 1) return { html: '<p>Todavía no tengo dos meses de ventas por categoría para comparar cómo evolucionan.</p>' };
  difs.sort((a,b) => b.pct - a.pct);
  const sube = difs[0], baja = difs[difs.length - 1];
  let html = '';
  if(sube.pct > 0.05) html += `<p>La que más <span class="tiki-pos">crece</span> es <strong>${escapeHtml(sube.cat)}</strong>: ${tikiPlata(sube.prev)} → ${tikiPlata(sube.act)} (${sube.pct > 0 ? '+' : ''}${Math.round(sube.pct * 100)}%) contra los 30 días anteriores.</p>`;
  if(baja !== sube && baja.pct < -0.05) html += `<p>La que más <span class="tiki-neg">cae</span> es <strong>${escapeHtml(baja.cat)}</strong>: ${tikiPlata(baja.prev)} → ${tikiPlata(baja.act)} (${Math.round(baja.pct * 100)}%).</p>`;
  if(!html) html = '<p>Tus categorías están bastante estables: ninguna subió ni bajó de forma marcada contra los 30 días anteriores.</p>';
  return { html, ctx: { tema: 'categorias' } };
}

// ---------- Detección de anomalías ----------
// No es adivinar: son comparaciones de los últimos 30 días contra los 30
// anteriores, con tus datos. Devuelve lo más relevante primero.
function tikiUnidadesPorNombre(desde, hasta){
  const m = new Map();
  tikiMovs(desde, hasta, 'Venta').forEach(e => { const k = tikiNorm(e.descripcion); if(k) m.set(k, (m.get(k) || 0) + (Number(e.cantidad) || 1)); });
  return m;
}
function tikiContribPctDe(desde, hasta){
  const v = tikiMovs(desde, hasta, 'Venta').filter(e => parseFloat(e.costoTotal) > 0);
  const vm = v.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  const cm = v.reduce((s,e) => s + parseFloat(e.costoTotal), 0);
  return vm > 0 ? (vm - cm) / vm : null;
}
function tikiAnomalias(){
  const hoy = todayStr();
  const a = { desde: tikiSumarDias(hoy, -29), hasta: hoy };
  const b = { desde: tikiSumarDias(hoy, -59), hasta: tikiSumarDias(hoy, -30) };
  const ra = tikiResumen(a.desde, a.hasta), rb = tikiResumen(b.desde, b.hasta);
  if(ra.cantVentas < 5 || rb.cantVentas < 5) return { html: '<p>Todavía no tengo suficientes datos de los últimos dos meses para comparar y detectar cosas raras. En unas semanas sí.</p>' };
  const hallazgos = [];
  // 1. Vendés más pero el margen bajó.
  const ma = tikiContribPctDe(a.desde, a.hasta), mb = tikiContribPctDe(b.desde, b.hasta);
  if(ma !== null && mb !== null){
    if(ra.ventas > rb.ventas * 1.05 && ma < mb - 0.03){
      hallazgos.push({ nivel: 'urgente', html: `Estás vendiendo <strong>más</strong> (${tikiPlata(rb.ventas)} → ${tikiPlata(ra.ventas)}) pero tu <strong>margen bajó</strong> de ${Math.round(mb * 100)}% a ${Math.round(ma * 100)}%: vendés más y te queda proporcionalmente menos.` });
    } else if(ma < mb - 0.04){
      hallazgos.push({ nivel: 'pronto', html: `Tu margen bajó de ${Math.round(mb * 100)}% a ${Math.round(ma * 100)}% respecto del mes anterior.` });
    }
  }
  // 2. Ventas en caída.
  if(ra.ventas < rb.ventas * 0.9){
    hallazgos.push({ nivel: 'urgente', html: `Tus ventas <strong>cayeron</strong> ${Math.round((1 - ra.ventas / rb.ventas) * 100)}%: ${tikiPlata(rb.ventas)} → ${tikiPlata(ra.ventas)} contra los 30 días anteriores.` });
  }
  // 3. Categoría que se desplomó.
  if(tikiCategoriasPresentes().length){
    const ca = tikiMetricasCategorias(a.desde, a.hasta).cats, cb = tikiMetricasCategorias(b.desde, b.hasta).cats;
    let peor = null;
    cb.forEach((g, c) => { const act = (ca.get(c) || { ventas: 0 }).ventas; if(g.ventas > 0){ const pct = (act - g.ventas) / g.ventas; if(pct < -0.2 && (!peor || pct < peor.pct)) peor = { c, pct, prev: g.ventas, act }; } });
    if(peor) hallazgos.push({ nivel: 'pronto', html: `La categoría <strong>${escapeHtml(peor.c)}</strong> cayó ${Math.round(-peor.pct * 100)}% (${tikiPlata(peor.prev)} → ${tikiPlata(peor.act)}).` });
  }
  // 4. Un producto que vendías y dejó de venderse.
  const ua = tikiUnidadesPorNombre(a.desde, a.hasta), ub = tikiUnidadesPorNombre(b.desde, b.hasta);
  let frenado = null;
  ub.forEach((u, k) => { if(u >= 10 && (ua.get(k) || 0) <= u * 0.2){ const prod = products.find(p => tikiNorm(p.nombre) === k); if(!frenado || u > frenado.u) frenado = { nombre: prod ? prod.nombre : k, u, ahora: ua.get(k) || 0 }; } });
  if(frenado) hallazgos.push({ nivel: 'pronto', html: `<strong>${escapeHtml(frenado.nombre)}</strong> se frenó: pasaste de ${tikiNum(frenado.u)} a ${frenado.ahora === 0 ? 'cero' : tikiNum(frenado.ahora)} unidades. ¿Te quedaste sin stock o cambió algo?` });
  // 5. Faltantes de caja repetidos.
  const cierres = [...cierresCaja].sort((x,y) => y.fecha.localeCompare(x.fecha)).slice(0, 10);
  const faltantes = cierres.filter(c => (Number(c.diferencia) || 0) <= -1).length;
  if(cierres.length >= 5 && faltantes >= cierres.length * 0.5) hallazgos.push({ nivel: 'pronto', html: `En ${faltantes} de tus últimos ${cierres.length} cierres faltó plata en la caja. Vale la pena revisar el vuelto o ventas sin cargar.` });

  if(!hallazgos.length) return { html: '<p>Miré tus ventas, márgenes, categorías, stock y cierres de los últimos dos meses y <strong>no veo nada raro</strong>. Todo dentro de lo normal.</p>' };
  const orden = { urgente: 0, pronto: 1 };
  hallazgos.sort((x, y) => orden[x.nivel] - orden[y.nivel]);
  return {
    html: `<p>${hallazgos.length === 1 ? 'Hay una cosa para mirar:' : 'Encontré algunas cosas para mirar:'}</p><ul class="tiki-list">${hallazgos.slice(0, 4).map(h => `<li class="${h.nivel}"><span>${h.html}</span></li>`).join('')}</ul>`,
    ctx: { tema: 'anomalias' },
    sugerencia: { texto: '¿Querés ver dónde estás perdiendo margen?', pregunta: '¿Dónde estoy perdiendo plata?' }
  };
}

// ---------- Proyección de cierre de mes ----------
// Estimación lineal: al ritmo de lo que va del mes, cuánto cerraría. Siempre
// marcada como estimación, nunca como certeza.
function tikiProyeccionMes(){
  const hoy = todayStr();
  const d = tikiParse(hoy);
  const inicio = hoy.slice(0, 8) + '01';
  const dia = d.getDate();
  const diasMes = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const r = tikiResumen(inicio, hoy);
  if(!r.cantVentas) return { html: '<p>Este mes todavía no hay ventas cargadas, así que no puedo proyectar el cierre.</p>', acciones: [{ label: 'Cargar una venta', view: 'cargar' }] };
  if(dia < 5) return { html: `<p>Todavía es muy pronto para proyectar el mes (van ${dia} ${dia === 1 ? 'día' : 'días'}). En unos días te lo estimo mejor. Por ahora llevás ${tikiPlata(r.ventas)}.</p>` };
  const factor = diasMes / dia;
  const proyVentas = r.ventas * factor;
  const proyGanancia = r.ganancia * factor;
  const mes = TIKI_MESES[d.getMonth()];
  let html = `<p>Al ritmo de lo que va de ${mes}, si seguís así cerrarías el mes alrededor de <strong>${tikiPlata(proyVentas)}</strong> en ventas`;
  if(r.sinCosto < r.cantVentas) html += ` y una ganancia real cerca de <strong class="${proyGanancia >= 0 ? 'tiki-pos' : 'tiki-neg'}">${tikiPlata(proyGanancia)}</strong>`;
  html += `.</p><p class="tiki-soft">Es una estimación: llevás ${tikiPlata(r.ventas)} en ${dia} días y la proyecto a los ${diasMes} del mes. Si cambia el ritmo, cambia el número.</p>`;
  // Contra el mes pasado completo.
  const finPrev = new Date(d.getFullYear(), d.getMonth(), 0);
  const rp = tikiResumen(tikiFecha(new Date(finPrev.getFullYear(), finPrev.getMonth(), 1)), tikiFecha(finPrev));
  if(rp.ventas > 0){
    const v = tikiVariacion(proyVentas, rp.ventas);
    if(v) html += `<p>Eso sería ${v} el total de ${TIKI_MESES[finPrev.getMonth()]} (${tikiPlata(rp.ventas)}).</p>`;
  }
  const meta = tikiRecuerda('meta_venta_diaria');
  if(meta){ const metaMes = meta.monto * tikiDiasAbiertosMes(); html += `<p>${proyVentas >= metaMes ? 'Vas camino a' : 'Quedarías por debajo de'} tu meta (${tikiPlata(metaMes)} en el mes).</p>`; }
  return { html, ctx: { tema: 'proyeccion', proyVentas, proyGanancia }, sugerencia: { texto: '¿Querés ver cuánto necesitás para una meta de ganancia?', pregunta: '¿Cuánto tengo que vender para ganar 500000 por mes?' } };
}

// ---------- Rentabilidad cruzada por producto ----------
// Para cada producto del catálogo: margen % (del catálogo, precio vs costo),
// unidades vendidas y monto de los últimos N días. Sirve para cruzar "vende
// mucho" con "deja poco", o "buen margen" con "no rota".
function tikiMetricasProductos(dias = 30){
  const hasta = todayStr();
  const desde = tikiSumarDias(hasta, -(dias - 1));
  const ventas = tikiMovs(desde, hasta, 'Venta');
  const porNombre = new Map();
  ventas.forEach(e => {
    const k = tikiNorm(e.descripcion);
    if(!k) return;
    const g = porNombre.get(k) || { monto: 0, unidades: 0 };
    g.monto += Number(e.monto) || 0;
    g.unidades += Number(e.cantidad) || 1;
    porNombre.set(k, g);
  });
  return products.map(p => {
    const precio = Number(p.precio_venta) || 0, costo = Number(p.costo_unitario) || 0;
    const v = porNombre.get(tikiNorm(p.nombre)) || { monto: 0, unidades: 0 };
    return {
      nombre: p.nombre, precio, costo, stock: Number(p.stock_actual) || 0,
      margenPct: precio > 0 && costo > 0 ? (precio - costo) / precio : null,
      gananciaUnit: precio > 0 && costo > 0 ? precio - costo : null,
      monto: v.monto, unidades: v.unidades
    };
  });
}
function tikiMargenPromedio(ms){
  const con = ms.filter(m => m.margenPct !== null);
  return con.length ? con.reduce((s,m) => s + m.margenPct, 0) / con.length : null;
}
function tikiPctTexto(pct){ return Math.round(pct * 100) + '%'; }

function tikiMuchoVendePocoMargen(){
  if(!products.length) return { html: '<p>Para eso necesito tu catálogo con precios y costos.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const ms = tikiMetricasProductos(30).filter(m => m.margenPct !== null && m.monto > 0);
  if(ms.length < 2) return { html: '<p>Todavía tengo pocos productos con precio, costo y ventas cargados para comparar el margen.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const prom = tikiMargenPromedio(ms);
  // Los que más facturan y, de esos, los que dejan menos que tu promedio.
  const flojos = ms.filter(m => m.margenPct < prom).sort((a,b) => b.monto - a.monto).slice(0, 5);
  if(!flojos.length) return { html: `<p>Buenas noticias: lo que más vendés también te deja un margen parejo o por encima de tu promedio (${tikiPctTexto(prom)}). No hay un producto que venda mucho y te deje poco.</p>` };
  let html = `<p>Estos venden bien pero te dejan <strong>menos que tu promedio</strong> (${tikiPctTexto(prom)} de margen):</p>`;
  html += `<ul class="tiki-list">${flojos.map(m => `<li class="pronto"><span><strong>${escapeHtml(m.nombre)}</strong>: ${tikiPlata(m.monto)} vendidos, pero solo <span class="tiki-neg">${tikiPctTexto(m.margenPct)}</span> de margen</span></li>`).join('')}</ul>`;
  html += `<p class="tiki-soft">Son candidatos a revisar el precio o el costo: mueven plata pero rinden poco.</p>`;
  return { html, ctx: { tema: 'ranking' }, sugerencia: { texto: '¿Querés ver cuáles te dejan más?', pregunta: '¿Qué producto me deja más ganancia?' } };
}
function tikiBuenMargenPocaRotacion(){
  if(!products.length) return { html: '<p>Para eso necesito tu catálogo con precios, costos y stock.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const ms = tikiMetricasProductos(30).filter(m => m.margenPct !== null);
  if(ms.length < 2) return { html: '<p>Todavía tengo pocos productos con precio y costo cargados para comparar.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
  const prom = tikiMargenPromedio(ms);
  const unidadProm = ms.reduce((s,m) => s + m.unidades, 0) / ms.length;
  // Buen margen (sobre el promedio) y casi sin ventas, con stock parado.
  const joyas = ms.filter(m => m.margenPct >= prom && m.unidades <= Math.max(1, unidadProm * 0.4) && m.stock > 0)
    .sort((a,b) => b.margenPct - a.margenPct).slice(0, 5);
  if(!joyas.length) return { html: `<p>No encontré productos de buen margen que estén parados: lo que más te deja también se va vendiendo. Bien ahí.</p>` };
  let html = `<p>Estos te dejan <strong>buen margen</strong> pero casi no rotan, así que tenés plata quieta ahí:</p>`;
  html += `<ul class="tiki-list">${joyas.map(m => `<li class="pronto"><span><strong>${escapeHtml(m.nombre)}</strong>: <span class="tiki-pos">${tikiPctTexto(m.margenPct)}</span> de margen, pero ${m.unidades === 0 ? 'no vendiste ninguno' : `vendiste solo ${tikiNum(m.unidades)}`} en 30 días (quedan ${tikiNum(m.stock)})</span></li>`).join('')}</ul>`;
  html += `<p class="tiki-soft">Si los ponés más a la vista o los sumás a un combo, pueden rendir bien.</p>`;
  return { html, ctx: { tema: 'ranking' } };
}
function tikiDondePierdoPlata(){
  const ms = tikiMetricasProductos(30);
  const aPerdida = products.filter(p => Number(p.precio_venta) > 0 && Number(p.costo_unitario) > 0 && Number(p.precio_venta) <= Number(p.costo_unitario));
  const ventasPerdida = tikiMovs(tikiSumarDias(todayStr(), -29), todayStr(), 'Venta')
    .filter(e => parseFloat(e.costoTotal) > 0 && parseFloat(e.costoTotal) >= (Number(e.monto) || 0));
  const bloques = [];
  if(aPerdida.length){
    bloques.push(`<p>Estás vendiendo <strong>al costo o por debajo</strong> ${aPerdida.length === 1 ? 'este producto' : 'estos'}:</p><ul class="tiki-list">${aPerdida.slice(0, 6).map(p => `<li class="urgente"><span><strong>${escapeHtml(p.nombre)}</strong>: lo vendés a ${tikiPlata(p.precio_venta)} y te cuesta ${tikiPlata(p.costo_unitario)}</span></li>`).join('')}</ul>`);
  }
  if(ventasPerdida.length){
    const total = ventasPerdida.reduce((s,e) => s + (parseFloat(e.costoTotal) - (Number(e.monto) || 0)), 0);
    if(!aPerdida.length) bloques.push(`<p>En los últimos 30 días hubo ${ventasPerdida.length} ${ventasPerdida.length === 1 ? 'venta' : 'ventas'} donde cobraste menos que lo que te costó la mercadería${total > 0 ? ` (unos ${tikiPlata(total)} de diferencia)` : ''}.</p>`);
  }
  const flojos = ms.filter(m => m.margenPct !== null && m.monto > 0 && m.margenPct < 0.1).sort((a,b) => b.monto - a.monto).slice(0, 4);
  if(flojos.length){
    bloques.push(`<p>Y estos dejan un margen muy finito (menos del 10%) moviendo bastante plata:</p><ul class="tiki-list">${flojos.map(m => `<li class="pronto"><span>${escapeHtml(m.nombre)}: ${tikiPctTexto(m.margenPct)} de margen sobre ${tikiPlata(m.monto)} vendidos</span></li>`).join('')}</ul>`);
  }
  const sinCosto = products.filter(p => !(Number(p.costo_unitario) > 0)).length;
  if(!bloques.length){
    return { html: `<p>No veo productos que estés vendiendo a pérdida ni con margen negativo. ${sinCosto ? `Eso sí, ${sinCosto} ${sinCosto === 1 ? 'producto no tiene' : 'productos no tienen'} el costo cargado, así que de esos no puedo saberlo.` : 'Por donde miro, no estás perdiendo plata en productos.'}</p>`, acciones: sinCosto ? [{ label: 'Ir al catálogo', view: 'catalogo' }] : undefined };
  }
  return { html: bloques.join(''), ctx: { tema: 'ranking' }, sugerencia: { texto: '¿Querés que veamos cuáles te dejan más para compensar?', pregunta: '¿Qué producto me deja más ganancia?' } };
}

const TIKI_CATEGORIAS = { alquiler: 'Alquiler', servicio: 'Servicios', sueldo: 'Sueldos', empleado: 'Sueldos', impuesto: 'Impuestos', monotributo: 'Impuestos', mercaderia: 'Mercadería' };
const TIKI_SERVICIOS = ['luz', 'gas', 'agua', 'internet', 'telefono', 'celular', 'wifi', 'cable'];
function tikiGastos(periodo, claves){
  const hoy = todayStr();
  const p = periodo || { desde: hoy.slice(0, 8) + '01', hasta: hoy, label: 'este mes' };
  let gastos = tikiMovs(p.desde, p.hasta, 'Gasto');
  let filtro = '', aviso = '';
  const cat = Object.keys(TIKI_CATEGORIAS).find(k => claves.some(c => tikiCoinciden(c, k)));
  if(cat){
    // Por categoria, o por nombre para los gastos viejos que no tienen categoria.
    gastos = gastos.filter(e => e.categoria === TIKI_CATEGORIAS[cat] || tikiNorm(e.descripcion).split(' ').some(w => tikiCoinciden(tikiRaiz(w), cat)));
    filtro = ` en ${TIKI_CATEGORIAS[cat].toLowerCase()}`;
  } else if(claves.length){
    const nombres = tikiBuscar(claves, [...new Set(entries.filter(e => e.tipo === 'Gasto').map(e => (e.descripcion || '').trim()).filter(Boolean))], n => n);
    if(nombres.length){
      const keys = new Set(nombres.map(tikiNorm));
      gastos = gastos.filter(e => keys.has(tikiNorm(e.descripcion)));
      filtro = ` en ${tikiListaNombres(nombres)}`;
    } else if(claves.some(c => TIKI_SERVICIOS.includes(c))){
      gastos = gastos.filter(e => e.categoria === 'Servicios');
      filtro = ' en servicios';
      aviso = '<p class="tiki-soft">No tenés gastos con ese nombre exacto, así que sumé todos los de la categoría Servicios.</p>';
    } else {
      aviso = '<p class="tiki-soft">No encontré gastos con ese nombre, así que te paso el total.</p>';
    }
  }
  if(!gastos.length) return { html: `${aviso}<p>${tikiCap(p.label)} no hay gastos${filtro} cargados.</p>` };
  const total = gastos.reduce((s,e) => s + (Number(e.monto) || 0), 0);
  let html = `${aviso}<p>${tikiCap(p.label)} gastaste <strong>${tikiPlata(total)}</strong>${filtro}${gastos.length > 1 ? ` en ${gastos.length} pagos` : ''}.</p>`;
  if(!filtro){
    const porCat = {};
    gastos.forEach(e => { const c = e.categoria || 'Sin categoría'; porCat[c] = (porCat[c] || 0) + (Number(e.monto) || 0); });
    const filas = Object.entries(porCat).sort((a,b) => b[1] - a[1]);
    if(filas.length > 1) html += tikiBarras(filas.slice(0, 6).map(([c,v],i) => ({ label: c, valor: v, texto: tikiPlata(v), top: i === 0 })), true);
  } else if(gastos.length > 1 && gastos.length <= 6){
    html += `<ul class="tiki-list">${[...gastos].sort((a,b) => a.fecha.localeCompare(b.fecha)).map(e => `<li><span>${tikiFechaCorta(e.fecha)} · ${escapeHtml(e.descripcion)}: ${tikiPlata(e.monto)}</span></li>`).join('')}</ul>`;
  }
  const fijos = gastos.filter(e => e.esFijo).reduce((s,e) => s + (Number(e.monto) || 0), 0);
  if(fijos > 0 && fijos < total) html += `<p class="tiki-soft">De eso, ${tikiPlata(fijos)} son gastos fijos.</p>`;
  return { html, ctx: { tema: 'gastos', p }, sugerencia: { texto: '¿Querés ver cuánto te quedó de ganancia real?', pregunta: `¿Cuánto gané ${p.label}?` } };
}

function tikiTopProductos(periodo, criterio, menos, cuantos = 5, invertido = false){
  const p = periodo || tikiUltimos30();
  if(menos){
    if(!products.length) return { html: '<p>Para decirte qué no se vende necesito tu catálogo de productos con su stock.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
    const vendidos = new Set(tikiMovs(p.desde, p.hasta, 'Venta').map(e => tikiNorm(e.descripcion)));
    const quietos = products.filter(x => (Number(x.stock_actual) || 0) > 0 && !vendidos.has(tikiNorm(x.nombre)));
    if(!quietos.length) return { html: `<p>${tikiCap(p.label)} vendiste algo de todos los productos que tenés en stock. No hay nada parado.</p>` };
    const parado = quietos.reduce((s,x) => s + (Number(x.stock_actual) || 0) * (Number(x.costo_unitario) || 0), 0);
    return {
      html: `<p>${tikiCap(p.label)} no vendiste ${quietos.length === 1 ? 'este producto' : `estos ${quietos.length} productos`}, y tenés stock:</p>
        <ul class="tiki-list">${quietos.slice(0, 8).map(x => `<li class="pronto"><span>${escapeHtml(x.nombre)} <span class="tiki-soft">· quedan ${tikiNum(x.stock_actual)}</span></span></li>`).join('')}</ul>
        ${quietos.length > 8 ? `<p class="tiki-soft">Y ${quietos.length - 8} más.</p>` : ''}
        ${parado > 0 ? `<p>Ahí tenés <strong>${tikiPlata(parado)}</strong> parados (a precio de costo).</p>` : ''}`,
      ctx: { tema: 'ranking', p, criterio, menos: true },
      sugerencia: { texto: '¿Querés algunas ideas para moverlos?', pregunta: '¿qué hago?' }
    };
  }
  let grupos = tikiAgruparVentas(tikiMovs(p.desde, p.hasta, 'Venta'));
  if(!grupos.length) return { html: `<p>${tikiCap(p.label)} no hay ventas cargadas.</p>` };
  let campo = criterio, titulo;
  if(criterio === 'ganancia'){
    grupos = grupos.filter(g => g.conCosto > 0);
    if(!grupos.length) return { html: '<p>Para decirte qué te deja más ganancia necesito que las ventas tengan el costo cargado. Se completa solo cuando el producto del catálogo tiene su costo.</p>', acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }] };
    titulo = 'Lo que más ganancia te dejó';
  } else if(criterio === 'cantidad'){
    titulo = 'Lo que más unidades vendiste';
  } else {
    campo = 'monto';
    titulo = 'Lo que más facturó';
  }
  grupos.sort((a,b) => invertido ? a[campo] - b[campo] : b[campo] - a[campo]);
  if(invertido) titulo = criterio === 'ganancia' ? 'Lo que menos ganancia te dejó' : criterio === 'cantidad' ? 'Lo que menos unidades vendiste' : 'Lo que menos facturó';
  const filas = grupos.slice(0, cuantos).map((g,i) => ({ label: g.nombre, valor: g[campo], texto: campo === 'cantidad' ? `${tikiNum(g.cantidad)} u.` : tikiPlata(g[campo]), top: i === 0 }));
  return {
    html: `<p>${titulo} ${p.label}:</p>${tikiBarras(filas, true)}`,
    ctx: { tema: 'ranking', p, criterio, menos: false },
    sugerencia: criterio === 'ganancia'
      ? { texto: '¿Te muestro también lo que no se vende?', pregunta: '¿Qué no se vende?' }
      : { texto: '¿Querés ver cuál te deja más ganancia?', pregunta: `¿Qué producto me deja más ganancia ${p.label}?` }
  };
}

function tikiMejorDia(){
  const prom = tikiPromediosPorDia();
  if(!prom) return { html: '<p>Todavía tengo pocos datos para eso: necesito por lo menos dos semanas de ventas cargadas.</p>' };
  const cerrados = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias;
  const conVentas = prom.filter(x => x.promedio > 0 && !cerrados.includes(x.dia)).sort((a,b) => b.promedio - a.promedio);
  if(!conVentas.length) return { html: '<p>En las últimas semanas no hay ventas cargadas.</p>' };
  const mejor = conVentas[0], peor = conVentas[conVentas.length - 1];
  let html = `<p>Tu mejor día es el <strong>${TIKI_DIAS[mejor.dia]}</strong>: vendés en promedio <strong>${tikiPlata(mejor.promedio)}</strong>.${conVentas.length > 1 ? ` El más flojo es el ${TIKI_DIAS[peor.dia]} (${tikiPlata(peor.promedio)}).` : ''}</p>`;
  const semana = [1,2,3,4,5,6,0].map(i => prom[i]);
  html += tikiBarras(semana.map(x => ({ label: tikiCap(TIKI_DIAS[x.dia].slice(0, 3)), valor: x.promedio, texto: cerrados.includes(x.dia) ? 'cerrado' : x.promedio > 0 ? tikiPlata(x.promedio) : '—', top: x.dia === mejor.dia })));
  html += '<p class="tiki-soft">Promedio de las últimas 8 semanas.</p>';
  return { html, ctx: { tema: 'dias' }, sugerencia: { texto: '¿Y querés ver a qué hora vendés más?', pregunta: '¿A qué hora vendo más?' } };
}

function tikiMejorHora(periodo){
  const p = periodo || tikiUltimos30();
  const total = new Array(24).fill(0), cant = new Array(24).fill(0);
  let n = 0;
  tikiMovs(p.desde, p.hasta, 'Venta').forEach(e => {
    const m = String(e.hora || '').match(/^(\d{1,2}):/);
    if(!m || Number(m[1]) > 23) return;
    total[Number(m[1])] += Number(e.monto) || 0;
    cant[Number(m[1])]++;
    n++;
  });
  if(n < 10) return { html: `<p>${tikiCap(p.label)} tengo pocas ventas con hora para saber eso (necesito al menos 10).</p>` };
  const horas = total.map((t,h) => ({ h, t, c: cant[h] })).filter(x => x.c > 0);
  const top = [...horas].sort((a,b) => b.t - a.t)[0];
  let html = `<p>${tikiCap(p.label)} vendiste más entre las <strong>${top.h} y las ${top.h + 1} hs</strong>: ${tikiPlata(top.t)} en ${top.c} ${top.c === 1 ? 'venta' : 'ventas'}.</p>`;
  html += tikiBarras(horas.map(x => ({ label: `${x.h} hs`, valor: x.t, texto: tikiPlata(x.t), top: x.h === top.h })));
  return { html, ctx: { tema: 'horas' } };
}

function tikiAyuda(){
  return {
    html: `<p>Soy Tiki. Respondo con lo que cargás en Tikera: ventas, gastos, stock, proveedores y cierres de caja.</p>
      <p>No soy una inteligencia artificial: entiendo preguntas sobre tus números (sobre todo si me decís de cuándo: hoy, ayer, el sábado, este mes), pero no charla libre ni consejos generales.</p>
      <p>Probá con alguna de estas:</p>`,
    acciones: tikiEjemplos().slice(0, 5).map(q => ({ label: q, pregunta: q }))
  };
}
function tikiNoEntendi(){
  return {
    html: '<p>Eso todavía no lo sé responder. Entiendo preguntas sobre tus ventas, gastos, ganancia, stock, proveedores y cierres de caja, y me ayuda que me digas de cuándo (hoy, ayer, esta semana, este mes).</p><p>Probá con alguna de estas:</p>',
    acciones: tikiEjemplos().slice(0, 4).map(q => ({ label: q, pregunta: q }))
  };
}

// ---------- Memoria ----------
// Tiki separa cinco tipos de informacion y no los mezcla (detalle en
// docs/tiki.md):
//  A. La charla actual: solo en memoria (tikiSeguir, tikiPendiente), se
//     pierde al recargar o cerrar sesion.
//  B. Charlas anteriores: NO se guardan (ni el texto ni un resumen).
//  C. Lo que el usuario le pide recordar: tabla tiki_memoria, solo estas 3
//     claves con forma fija, siempre con confirmacion explicita y borrable.
//  D. Datos del negocio (entries, products, cierresCaja...): la unica
//     fuente de cualquier numero que Tiki diga.
//  E. Patrones (mejor dia, hora de cierre...): se calculan de D en el
//     momento, mostrando la evidencia, y nunca se guardan como hechos.
// Una frase suelta ("hoy vendi muchisimo") nunca se guarda: se contesta
// con los datos reales.
const TIKI_MEMORIA_CLAVES = ['horario_cierre', 'dias_cerrado', 'meta_venta_diaria'];
let tikiMemoria = {};          // clave -> { valor, desde }, solo de tikiMemoriaDe
let tikiMemoriaDe = null;      // cuenta a la que pertenece lo cargado
let tikiMemoriaCarga = null;   // promesa de la carga (una por cuenta)
let tikiPendiente = null;      // { clave, valor } que Tiki ofrecio recordar y espera un "si"

function tikiValidarMemoria(clave, v){
  if(!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if(clave === 'horario_cierre') return Number.isInteger(v.hora) && v.hora >= 0 && v.hora <= 23 && Number.isInteger(v.minuto) && v.minuto >= 0 && v.minuto <= 59;
  if(clave === 'dias_cerrado') return Array.isArray(v.dias) && v.dias.length <= 6 && new Set(v.dias).size === v.dias.length && v.dias.every(d => Number.isInteger(d) && d >= 0 && d <= 6);
  if(clave === 'meta_venta_diaria') return typeof v.monto === 'number' && isFinite(v.monto) && v.monto >= 1 && v.monto < 1e10;
  return false;
}
function tikiCargarMemoria(){
  const uid = currentUserId;
  if(tikiMemoriaCarga && tikiMemoriaDe === uid) return tikiMemoriaCarga;
  tikiMemoria = {};
  tikiMemoriaDe = uid;
  tikiMemoriaCarga = (async () => {
    if(!uid) return;
    try{
      const { data, error } = await sb.from('tiki_memoria').select('clave, valor, updated_at').eq('user_id', uid);
      if(error) throw error;
      if(tikiMemoriaDe !== uid) return; // cambio la sesion mientras cargaba
      (data || []).forEach(r => {
        if(TIKI_MEMORIA_CLAVES.includes(r.clave) && tikiValidarMemoria(r.clave, r.valor)) tikiMemoria[r.clave] = { valor: r.valor, desde: r.updated_at };
      });
    }catch(err){
      // Sin conexion o sin la tabla (falta 015_tiki_memoria.sql): Tiki sigue
      // andando, solo que sin recordar nada.
      console.error(err);
    }
    if(tikiMemoriaDe === uid) renderTikiSabe();
  })();
  return tikiMemoriaCarga;
}
function tikiRecuerda(clave){
  return tikiMemoriaDe && tikiMemoriaDe === currentUserId && tikiMemoria[clave] ? tikiMemoria[clave].valor : null;
}
async function tikiGuardarMemoria(clave, valor){
  if(!currentUserId || tikiMemoriaDe !== currentUserId || !TIKI_MEMORIA_CLAVES.includes(clave) || !tikiValidarMemoria(clave, valor)) return false;
  try{
    const { error } = await sb.from('tiki_memoria').upsert({ user_id: currentUserId, clave, valor }, { onConflict: 'user_id,clave' });
    if(error) throw error;
  }catch(err){ console.error(err); return false; }
  tikiMemoria[clave] = { valor, desde: new Date().toISOString() };
  renderTikiSabe();
  return true;
}
async function tikiOlvidar(claves){
  if(!currentUserId || tikiMemoriaDe !== currentUserId) return false;
  try{
    const { error } = await sb.from('tiki_memoria').delete().eq('user_id', currentUserId).in('clave', claves);
    if(error) throw error;
  }catch(err){ console.error(err); return false; }
  claves.forEach(c => { delete tikiMemoria[c]; });
  renderTikiSabe();
  return true;
}
function tikiHoraMin(min){
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function tikiOrdenSemana(dias){ return [...dias].sort((a,b) => ((a + 6) % 7) - ((b + 6) % 7)); }
function tikiTextoMemoria(clave, v){
  if(clave === 'horario_cierre') return `cerrás la caja a las ${tikiHoraMin(v.hora * 60 + v.minuto)}`;
  if(clave === 'dias_cerrado') return v.dias.length ? `no abrís los ${tikiListaNombres(tikiOrdenSemana(v.dias).map(d => TIKI_DIAS_PLURAL[d]), false, 7)}` : 'abrís todos los días';
  if(clave === 'meta_venta_diaria') return `tu meta es vender ${tikiPlata(v.monto)} por día`;
  return '';
}

// ---------- Lo que el usuario cuenta de su negocio ----------
// "cierro a las 21", "cerramos tipo 22 30", "mi horario de cierre es 9 de la noche"
// (tikiNorm ya convirtio "21:30" en "21 30"). "cierre" solo no cuenta: en
// "¿como fue el cierre del 21?" el numero es una fecha, no una hora.
function tikiLeerHorario(t){
  const m = t.match(/\b(cierro|cerramos|cierra|horario de cierre|hora de cierre)\b[^0-9]{0,30}?\b(\d{1,2})(?: (\d{2}))?(?: ?(?:hs|h|horas))?(?: (de la manana|de la tarde|de la noche|am|pm))?\b/);
  if(!m) return null;
  let hora = Number(m[2]);
  const minuto = m[3] ? Number(m[3]) : 0;
  if(hora === 24) hora = 0;
  if(hora > 23 || minuto > 59) return null;
  const mer = m[4] || '';
  if(/tarde|noche|pm/.test(mer) && hora < 12) hora += 12;
  return { hora, minuto, ambiguo: !mer && hora >= 1 && hora <= 11 };
}
function tikiLeerDias(t){
  const dias = [];
  TIKI_DIAS.forEach((d, i) => { if(new RegExp('\\b' + tikiNorm(d) + 's?\\b').test(t)) dias.push(i); });
  return dias;
}
// Monto escrito como lo escribe un comerciante: "100.000", "$80000", "100 mil",
// "80k", "150 lucas", "1,5 millones". Del texto original, no del normalizado
// (que convierte "100.000" en "100 000").
function tikiLeerMonto(raw){
  const s = String(raw || '').toLowerCase().replace(/\$/g, ' ');
  const m = s.match(/(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:,(\d{1,2}))?\s*(mil\b|k\b|lucas?\b|palos?\b|mill[oó]n(?:es)?\b)?/);
  if(!m) return null;
  let n = Number(m[1].replace(/[.\s]/g, '')) + (m[2] ? Number('0.' + m[2]) : 0);
  if(m[3]) n *= /^(mill|palo)/.test(m[3]) ? 1000000 : 1000; // "millones" empieza con "mil"
  return isFinite(n) && n > 0 ? Math.round(n) : null;
}
// Pregunta sobre un habito ("siempre cierro a las 20, ¿no?") -> se contesta
// con evidencia; afirmacion ("cierro a las 21") -> se ofrece recordarla.
function tikiEsPreguntaDeHabito(raw, t){
  return /\?/.test(raw) || /\b(siempre|normalmente|generalmente|suelo|solemos|casi siempre|verdad|cierto|no es asi)\b/.test(t) || /\bno$/.test(t);
}
function tikiOfrecer(clave, valor, html){
  tikiPendiente = { clave, valor };
  return { html, acciones: [{ label: 'Sí, acordate', guardar: { clave, valor } }, { label: 'No', descartar: true }] };
}
function tikiMemoriaListado(){
  const claves = TIKI_MEMORIA_CLAVES.filter(c => tikiRecuerda(c));
  const fuente = '<p class="tiki-soft">Todo lo demás que te digo sale de lo que cargás en Tikera: eso no lo guardo aparte, lo calculo cada vez.</p>';
  if(!claves.length){
    return { html: `<p>No me pediste que recuerde nada todavía. Si querés, decime cosas como «cierro a las 21», «los domingos no abro» o «mi meta es vender 100.000 por día», y te pregunto antes de guardarlas.</p>${fuente}` };
  }
  return {
    html: `<p>Esto es lo que me pediste que recuerde:</p>
      <ul class="tiki-list">${claves.map(c => `<li><span>Que ${tikiTextoMemoria(c, tikiRecuerda(c))}.</span></li>`).join('')}</ul>${fuente}`,
    acciones: claves.map(c => ({ label: `Olvidar ${c === 'horario_cierre' ? 'el horario' : c === 'dias_cerrado' ? 'los días' : 'la meta'}`, olvidar: [c] }))
      .concat(claves.length > 1 ? [{ label: 'Olvidar todo', olvidar: claves }] : [])
  };
}
// Devuelve una respuesta si el mensaje es sobre la memoria (ver, olvidar,
// contarle algo), o null para seguir con el resto de las preguntas.
function tikiMemoriaResponder(raw, t){
  if(/\bque (sabes|recordas|te acordas|tenes guardado|guardaste) (de mi|de nosotros|de mi negocio|del negocio|de mi kiosco|sobre mi)\b|\bque (recordas|te acordas|guardaste)\b|\btu memoria\b|\bque te dije\b/.test(t)){
    return tikiMemoriaListado();
  }
  if(/\b(olvida\w*|borra\w*|elimina\w*|saca\w*)\b/.test(t)){
    const claves = [];
    if(/\b(horario|hora de cierre|a que hora cierro|cierro a las)\b/.test(t)) claves.push('horario_cierre');
    if(/\b(dias? (que )?(no abro|no abrimos|cierro|cerramos)|dias? cerrados?|no abro|no abrimos)\b/.test(t)) claves.push('dias_cerrado');
    if(/\b(meta|objetivo)\b/.test(t)) claves.push('meta_venta_diaria');
    const todo = /\b(lo que (te dije|sabes|recordas|guardaste)|tu memoria|todo lo que)\b/.test(t);
    if(todo) return tikiMemoriaListado();
    const guardadas = claves.filter(c => tikiRecuerda(c));
    if(claves.length && !guardadas.length) return { html: '<p>No tenía eso guardado, así que no hay nada que olvidar.</p>' };
    if(guardadas.length){
      return { html: `<p>¿Me olvido de que ${guardadas.map(c => tikiTextoMemoria(c, tikiRecuerda(c))).join(' y de que ')}?</p>`, acciones: [{ label: 'Sí, olvidalo', olvidar: guardadas }, { label: 'No', descartar: true }] };
    }
    return null;
  }
  const esPregunta = tikiEsPreguntaDeHabito(raw, t);
  // Meta de ventas
  const hablaDeMeta = /\b(meta|objetivo)\b/.test(t);
  const montoMeta = tikiLeerMonto(raw);
  if((hablaDeMeta || (/\bquiero (vender|hacer|facturar)\b/.test(t) && montoMeta)) && !/\b(que|cual|cuanto) (es|era) (mi|la) (meta|objetivo)\b/.test(t) && !esPregunta){
    if(/\b(por mes|al mes|mensual\w*|por semana|semanal\w*)\b/.test(t)) return { html: '<p>Por ahora puedo recordar una meta <strong>por día</strong>. Decime cuánto querés vender en un día, por ejemplo «mi meta es vender 100.000 por día».</p>' };
    const monto = montoMeta;
    if(!monto) return { html: '<p>¿Cuánto querés vender por día? Decime algo como «mi meta es vender 100.000 por día».</p>' };
    const valor = { monto };
    return tikiOfrecer('meta_venta_diaria', valor, `<p>¿Querés que me acuerde de que ${tikiTextoMemoria('meta_venta_diaria', valor)}? La voy a usar para decirte cómo venís contra esa meta.</p>`);
  }
  if(/\b(que|cual|cuanto) (es|era) (mi|la) (meta|objetivo)\b/.test(t)){
    const meta = tikiRecuerda('meta_venta_diaria');
    return { html: meta ? `<p>Me dijiste que ${tikiTextoMemoria('meta_venta_diaria', meta)}.</p>` : '<p>No me dijiste ninguna meta todavía. Si querés, decime «mi meta es vender 100.000 por día».</p>' };
  }
  // Horario de cierre
  const horario = tikiLeerHorario(t);
  const dias = tikiLeerDias(t);
  if(horario && dias.length && !esPregunta){
    return { html: '<p>Por ahora puedo recordar un solo horario de cierre para todos los días. Si cerrás a la misma hora casi siempre, decime esa hora.</p>' };
  }
  if(horario && !esPregunta){
    if(horario.ambiguo){
      const am = { hora: horario.hora, minuto: horario.minuto }, pm = { hora: horario.hora + 12, minuto: horario.minuto };
      tikiPendiente = null;
      return {
        html: `<p>¿Cerrás a las ${tikiHoraMin(am.hora * 60 + am.minuto)} o a las ${tikiHoraMin(pm.hora * 60 + pm.minuto)}? Si me confirmás, me lo acuerdo para avisarte del cierre.</p>`,
        acciones: [{ label: `A las ${tikiHoraMin(am.hora * 60 + am.minuto)}`, guardar: { clave: 'horario_cierre', valor: am } }, { label: `A las ${tikiHoraMin(pm.hora * 60 + pm.minuto)}`, guardar: { clave: 'horario_cierre', valor: pm } }, { label: 'No guardes nada', descartar: true }]
      };
    }
    const valor = { hora: horario.hora, minuto: horario.minuto };
    return tikiOfrecer('horario_cierre', valor, `<p>¿Querés que me acuerde de que ${tikiTextoMemoria('horario_cierre', valor)}? Lo voy a usar para recordarte el cierre un rato antes.</p>`);
  }
  // Dias que no abre (o que vuelve a abrir)
  if(dias.length && !esPregunta){
    const actuales = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias;
    if(/\b(no abro|no abrimos|cerramos|esta cerrado|estamos cerrados|cerrado|no trabajo|no trabajamos|descanso|descansamos|franco)\b/.test(t)){
      const valor = { dias: tikiOrdenSemana([...new Set(actuales.concat(dias))]) };
      if(valor.dias.length > 6) return { html: '<p>Si no abrís ningún día, no tengo mucho para ayudarte. ¿Me lo repetís?</p>' };
      return tikiOfrecer('dias_cerrado', valor, `<p>¿Querés que me acuerde de que ${tikiTextoMemoria('dias_cerrado', valor)}? Así no los cuento como días flojos.</p>`);
    }
    if(/\b(abro|abrimos|trabajo|trabajamos)\b/.test(t) && dias.some(d => actuales.includes(d))){
      const valor = { dias: actuales.filter(d => !dias.includes(d)) };
      if(!valor.dias.length) return { html: `<p>¿Me olvido de que ${tikiTextoMemoria('dias_cerrado', { dias: actuales })}?</p>`, acciones: [{ label: 'Sí, olvidalo', olvidar: ['dias_cerrado'] }, { label: 'No', descartar: true }] };
      return tikiOfrecer('dias_cerrado', valor, `<p>Entonces, ¿me acuerdo de que ${tikiTextoMemoria('dias_cerrado', valor)}?</p>`);
    }
  }
  return null;
}

// ---------- Habitos: siempre con la evidencia a la vista ----------
// Hora a la que se guardo cada cierre, solo los guardados el mismo dia que
// cierran: uno cargado dias despues no dice nada del horario real.
function tikiHorasDeCierre(){
  return cierresCaja.map(c => {
    if(!c || !c.created_at || !c.fecha) return null;
    const d = new Date(c.created_at);
    if(isNaN(d) || tikiFecha(d) !== c.fecha) return null;
    return { fecha: c.fecha, min: d.getHours() * 60 + d.getMinutes() };
  }).filter(Boolean).sort((a,b) => b.fecha.localeCompare(a.fecha)).slice(0, 30);
}
function tikiHabitoCierre(afirmado){
  const datos = tikiHorasDeCierre();
  const recordado = tikiRecuerda('horario_cierre');
  const como = '<p class="tiki-soft">Lo mido por la hora en que guardás el cierre en Tikera, solo los guardados el mismo día.</p>';
  let html = recordado ? `<p>Me dijiste que cerrás a las <strong>${tikiHoraMin(recordado.hora * 60 + recordado.minuto)}</strong>.</p>` : '';
  if(datos.length < 5){
    const cuales = datos.length ? ` (${datos.map(d => tikiHoraMin(d.min)).join(', ')})` : '';
    html += `<p>${datos.length === 0 ? 'No tengo cierres guardados el mismo día' : `Solo tengo ${datos.length} ${datos.length === 1 ? 'cierre guardado' : 'cierres guardados'} el mismo día${cuales}`}: con tan pocos no puedo decirte si es un hábito.</p>`;
    return { html: html + como };
  }
  const mins = datos.map(d => d.min).sort((a,b) => a - b);
  const mediana = mins[Math.floor(mins.length / 2)];
  if(afirmado){
    const objetivo = afirmado.hora * 60 + afirmado.minuto;
    const cerca = datos.filter(d => Math.abs(d.min - objetivo) <= 45).length;
    const pct = cerca / datos.length;
    const veredicto = pct >= 0.7 ? 'Sí' : pct >= 0.4 ? 'A veces' : 'No mucho';
    html += `<p><strong>${veredicto}</strong>: en ${cerca} de tus últimos ${datos.length} cierres guardaste la caja entre las ${tikiHoraMin(objetivo - 45)} y las ${tikiHoraMin(objetivo + 45)}.${pct < 0.7 ? ` Lo más común es cerca de las <strong>${tikiHoraMin(mediana)}</strong>.` : ''}</p>`;
  } else {
    const cerca = datos.filter(d => Math.abs(d.min - mediana) <= 45).length;
    html += `<p>Cerrás cerca de las <strong>${tikiHoraMin(mediana)}</strong>: ${cerca} de tus últimos ${datos.length} cierres los guardaste a menos de 45 minutos de esa hora.</p>`;
  }
  return { html: html + como };
}
function tikiHabitoDias(dias){
  const hoy = todayStr();
  const conVenta = new Set(tikiMovs(tikiSumarDias(hoy, -56), tikiSumarDias(hoy, -1), 'Venta').map(e => e.fecha));
  const cerrados = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias;
  const partes = dias.map(d => {
    let total = 0, abiertos = 0;
    for(let i = 1; i <= 56; i++){
      const f = tikiSumarDias(hoy, -i);
      if(tikiParse(f).getDay() !== d) continue;
      total++;
      if(conVenta.has(f)) abiertos++;
    }
    return `<li><span>${tikiCap(TIKI_DIAS_PLURAL[d])}: cargaste ventas en <strong>${abiertos} de ${total}</strong>${cerrados.includes(d) ? ' <span class="tiki-soft">(me dijiste que no abrís)</span>' : ''}</span></li>`;
  });
  return { html: `<p>En las últimas 8 semanas:</p><ul class="tiki-list">${partes.join('')}</ul><p class="tiki-soft">Un día sin ventas cargadas puede ser un día cerrado o un día que no se cargó.</p>` };
}

// ---------- Lo que quedo registrado en un periodo ----------
function tikiActividad(periodo){
  const hoy = todayStr();
  const p = periodo || { desde: hoy, hasta: hoy, label: 'hoy', dia: true };
  const r = tikiResumen(p.desde, p.hasta);
  const gastos = tikiMovs(p.desde, p.hasta, 'Gasto');
  const cierres = cierresCaja.filter(c => c && c.fecha >= p.desde && c.fecha <= p.hasta);
  const sinCerrar = [...new Set(tikiMovs(p.desde, p.hasta).map(e => e.fecha))].filter(f => f !== hoy && !cierreDeFecha(f));
  const pedidos = pedidosProveedor.filter(x => x && x.fecha >= p.desde && x.fecha <= p.hasta);
  const enRango = (ts) => { if(!ts) return false; const d = new Date(ts); if(isNaN(d)) return false; const f = tikiFecha(d); return f >= p.desde && f <= p.hasta; };
  const nuevos = products.filter(x => enRango(x.created_at));
  const items = [];
  if(r.cantVentas){
    const dias = new Set(r.lista.map(e => e.fecha)).size;
    items.push(`<li class="bien"><span><strong>${r.cantVentas}</strong> ${r.cantVentas === 1 ? 'venta' : 'ventas'} por <strong>${tikiPlata(r.ventas)}</strong>${dias > 1 ? ` en ${dias} días` : ''}</span></li>`);
  }
  if(gastos.length) items.push(`<li><span>${gastos.length} ${gastos.length === 1 ? 'gasto' : 'gastos'} por ${tikiPlata(r.gastos)}</span></li>`);
  if(cierres.length){
    const falt = cierres.filter(c => (Number(c.diferencia) || 0) <= -1).length;
    items.push(`<li class="${falt ? 'pronto' : 'bien'}"><span>${cierres.length === 1 ? 'Un cierre de caja' : `${cierres.length} cierres de caja`}${falt ? `, ${falt === 1 ? 'uno' : falt} con faltante` : ''}</span></li>`);
  }
  if(sinCerrar.length) items.push(`<li class="urgente"><span>${sinCerrar.length === 1 ? 'Un día' : `${sinCerrar.length} días`} con movimientos y sin cierre: ${tikiListaNombres(sinCerrar.sort().map(tikiFechaCorta), true, 5)}</span></li>`);
  if(pedidos.length){
    const pend = pedidos.filter(x => !x.pagado).length;
    items.push(`<li><span>${pedidos.length} ${pedidos.length === 1 ? 'pedido' : 'pedidos'} a proveedores por ${tikiPlata(pedidos.reduce((s,x) => s + (Number(x.monto) || 0), 0))}${pend ? ` (${pend} sin pagar)` : ''}</span></li>`);
  }
  if(nuevos.length) items.push(`<li><span>${nuevos.length === 1 ? 'Un producto nuevo' : `${nuevos.length} productos nuevos`} en el catálogo</span></li>`);
  if(!items.length) return { html: `<p>${tikiCap(p.label)} no quedó nada registrado en Tikera.</p>` };
  return { html: `<p>${tikiCap(p.label)} quedó registrado en Tikera:</p><ul class="tiki-list">${items.join('')}</ul>`, ctx: { tema: 'actividad', p } };
}

// ---------- Lo que Tiki nunca hace ----------
// Se contestan explicitamente en vez de caer en una respuesta con los datos
// propios (que se podria leer como si fueran "del otro comercio"). Igual,
// la proteccion real no es esta: la app solo descarga los datos de la
// cuenta logueada (RLS en Supabase), asi que Tiki no tiene como verlos.
const TIKI_RE_META = /\b(ignor\w*|olvida\w*|olvidate|saltea\w*|desactiva\w*|desactivame|anula\w*|quita\w*|saca\w*|baja\w*|apaga\w*)\b.{0,25}\b(instrucciones|reglas|indicaciones|restricciones|restriccion|limites|filtros?|controles?|protecciones?|censura|seguridad)\b|\b(sin|sin ninguna) (restricci\w*|regla\w*|limite\w*|filtro\w*|censura)\b|\bobedec\w*.{0,15}\b(solo|solamente|unicamente) (mis|a mi)\b|\bsolo (tenes que |debes )?(obedecer|hacer|seguir) (lo que (yo |te )?diga|mis)\b|\bsystem prompt\b|\bprompt\b|\binstrucciones (internas|del sistema|que te dieron|ocultas|secretas)\b|\bmodo (admin\w*|administrador|desarrollador|dios|debug|sin (reglas|limites)|libre|dan)\b|\bactua\w* como\b|\b(hace(te)? de cuenta|imagin\w*|supon\w*|pretend\w*|fingi\w*|jug(a|ue)mos a) que (sos|eres|fueras)\b|\bsos (ahora )?(dan|un modelo|una ia sin|un sistema sin|otro (sistema|asistente|bot))\b|\b(hacer|podes hacer|pode[ií]s hacer) cualquier cosa\b|\bsin ning(un|ún) l[ií]mite\b|\bsoy (el |la |un |una )?(admin\w*|desarrollador\w*|programador\w*|creador\w*|developer|soporte|equipo)\b|\bsoy (el |la )?(dueno|duena|creador|creadora) de (la plataforma|tikera|la app|el sistema|tiki)\b|\bte habla (el |la )?(equipo|soporte|desarrollador|administrador)\b|\bjailbreak\b|\bdeveloper mode\b|\bignore\b.{0,20}\b(instructions|rules|prompt)\b|\bdisregard\b.{0,20}\b(instructions|rules)\b|\bforget\b.{0,15}\b(your |the )?(rules|instructions)\b|\bshow\b.{0,15}\b(your |the )?(system )?prompt\b/;
const TIKI_RE_AJENO = /\b(otr[oa]s?|ajen[oa]s?|demas)\b.{0,25}\b(comercios?|kioscos?|negocios?|usuarios?|locales?|almacen(es)?|tiendas?|duenos?|personas|cuentas?)\b|\b(otra cuenta|cuenta de otr[oa]|otras cuentas de tikera)\b|\b(competencia|competidor\w*)\b|\bde (todos|todas|los demas) (los|las)? ?(comercios|kioscos|negocios|usuarios|cuentas)\b|\bdatos de (todos|otros|los demas)\b|\bcualquier (comercio|kiosco|negocio|usuario|cuenta)\b|\b(kiosco|negocio|local|comercio) de (enfrente|al lado|la esquina)\b|\b(user|usuario) ?id\b|\bother (users?|merchants?|accounts?|shops?|stores?|businesses)\b|\b(all|other) (users?|accounts?) (sales|data)\b/;
const TIKI_RE_ACCION = /\b(carga|cargame|cargale|anota|anotame|registra|registrame|borra|borrame|borrale|elimina|eliminame|modifica|modificame|cambia|cambiame|cambiale|edita|agrega|agregame|crea|creame|subi|subile|baja|bajale|pone|ponele|ponle|actualiza|marca|marcame)\b.*\b(ventas?|gastos?|productos?|stock|precios?|cierres?|caja|proveedor(es)?|pedidos?|movimientos?|pagos?|deudas?)\b|\b(borr[aá]|elimin[aá]|resete[aá]|limpi[aá]|vaci[aá])\w*\b.{0,12}\b(todo|todos|todas|la base|los datos|mi (cuenta|negocio|historial)|el historial)\b/;
function tikiFueraDeAlcance(tipo, t){
  if(tipo === 'ajeno'){
    return { html: '<p>Solo puedo ver los datos de esta cuenta. Ventas, productos o charlas de otros comercios o usuarios no los tengo: la app nunca los descarga, así que no hay forma de pedírmelos.</p><p class="tiki-soft">Si tenés otro local con otra cuenta de Tikera, entrá con esa cuenta.</p>' };
  }
  if(tipo === 'meta'){
    return {
      html: '<p>No tengo instrucciones secretas ni modos especiales: funciono con reglas fijas que hacen cuentas con los datos de esta cuenta, y nada de lo que se escriba en el chat cambia eso.</p>',
      acciones: tikiEjemplos().slice(0, 3).map(q => ({ label: q, pregunta: q }))
    };
  }
  const destino = /\b(ventas?|gastos?|movimientos?|pagos?)\b/.test(t) ? { label: 'Ir a Cargar', view: 'cargar' }
    : /\b(cierres?|caja)\b/.test(t) ? { label: 'Ir a Caja', view: 'caja' }
    : /\b(proveedor(es)?|pedidos?|deudas?)\b/.test(t) ? { label: 'Ver proveedores', view: 'catalogo', tab: 'proveedores' }
    : { label: 'Ir al catálogo', view: 'catalogo' };
  return { html: '<p>Yo solo leo tus datos: no puedo cargar, cambiar ni borrar ventas, gastos, productos, cierres ni pedidos. Así nada se modifica sin que lo hagas vos.</p>', acciones: [destino] };
}

// ---------- Seguridad: intencion y riesgo ----------
// No es una lista negra de palabras: clasifica QUE se pide, CON QUE fin
// (protegerse o dañar) y SOBRE QUIEN. "¿Cómo detecto un billete falso?" se
// ayuda; "¿Cómo falsifico un billete?" se rechaza; las dos tienen la
// palabra "billete". Igual, la seguridad de fondo no depende de esto: Tiki
// no tiene datos ajenos ni secretos (RLS en Supabase) ni puede escribir
// nada. Esta capa es para contestar bien, no para "contener" al modelo.
//
// Corre sobre tres formas del mensaje para que no la esquiven escondiendo
// el texto: el normal, uno "aplanado" (junta letras separadas como
// "v-e-n-t-a-s" y deshace leet 0/1/3/4/5/@) y, si hay un bloque tipo
// base64, su contenido decodificado.
let tikiManipSeguidas = 0; // intentos de manipulacion al hilo (para endurecer la respuesta)

function tikiAplanar(t){
  let s = t;
  // "v e n t a s" / "v-e-n-t-a-s" / "o.t.r.o.s": 4+ letras sueltas seguidas.
  s = s.replace(/\b([a-z]( |-|\.|_|\*){1,2}){3,}[a-z]\b/g, m => m.replace(/[ \-._*]/g, ''));
  // leet basico, solo para esta capa (nunca para las cuentas).
  s = s.replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a').replace(/5/g, 's').replace(/@/g, 'a').replace(/\$/g, 's');
  return s.replace(/\s+/g, ' ').trim();
}
function tikiDeBase64(raw){
  const salidas = [];
  const tokens = String(raw || '').match(/[A-Za-z0-9+/]{16,}={0,2}/g) || [];
  for(const tok of tokens.slice(0, 4)){
    if(tok.length % 4 !== 0 && !tok.includes('=')) continue;
    try{
      const dec = (typeof atob === 'function' ? atob(tok) : Buffer.from(tok, 'base64').toString('latin1'));
      if(/[a-zA-Z]{4,}/.test(dec) && /^[\x09\x0a\x0d\x20-\x7e]*$/.test(dec)) salidas.push(tikiNorm(dec));
    }catch(e){}
  }
  return salidas;
}

// Marco de la pregunta: protegerse/detectar vs. hacer daño, y a quién.
// "comprob(ar...)" es el verbo (verificar); "comprobante" NO entra acá.
const TIKI_SEG_PROT = /\b(proteg\w*|protej\w*|cuidar\w*|cuido|resguard\w*|defend\w*|evitar|evito|evita|prevenir|previene|detect\w*|reconoc\w*|identific\w*|darme cuenta|darnos cuenta|me doy cuenta|nos damos cuenta|verific\w*|chequear|chequeo|comprob(ar|a|as|e|en|ando|alo|arlo|arla)|asegurar\w*|revisar si|como se si|como saber si|como me doy|saber si es|si es (falso|falsa|trucho|trucha|verdadero|real|confiable|legitim\w*)|me quieren (estafar|robar|hacke\w*)|me estan (estafando|robando|hacke\w*)|no (me )?(estafen|roben|enganen|hacke\w*)|caer en|no caer)\b/;
const TIKI_SEG_OFEN = /\b(hacer|hago|hace|crear|creo|crea|armar|armo|fabricar|fabrico|programar|desarrollar|robar|robo|roba|robarle|robarme|hacke\w*|crack\w*|vulnerar|explotar|falsific\w*|truchar|adulter\w*|clonar|clono|estafar|estafo|enganar|timar|sacarle|sacarse|quedarme con|conseguir las|obtener las|burlar|evadir el control)\b/;
const TIKI_SEG_VICTIMA = /\b(a (un|una|otr[oa]|algun|alguna|mi|el|la) (client\w*|person\w*|usuari\w*|comerciante|vecin\w*|señor\w*|tip[oa]|min[oa]|gente|chab[oó]n)|de (un|una|otr[oa]|algun|alguna) (client\w*|cuenta|person\w*|usuari\w*|comerciante)|a alguien|a otr[oa]|a la gente|ajen[oa]s?)\b/;
// Señales de engaño/robo a alguien (van con victima).
const TIKI_SEG_ENGANO = /\b(sin que se de cuenta|sin que lo note|sin que se avive|de mas|cobrar\w* de mas|afanar\w*|robarle|sacarle (la )?plata|saco plata|sacar\w* plata|quedarme con (la |su )?plata|hacerle (un )?cuento|enganand\w*|enganarl\w*)\b/;
// Engañar escondiéndose, aunque no se nombre a la víctima explícitamente.
const TIKI_SEG_OCULTO = /\b(sin que se de cuenta|sin que lo note|sin que se note|sin que se avive|sin que nadie se entere)\b/;
const TIKI_SEG_COBRO_INDEBIDO = /\b(cobr\w*|saco plata|sacar\w* plata|de mas|el vuelto|afanar\w*|quedarme)\b/;
// Producir algo falso (ofensivo) vs. recibir/dudar de algo (defensivo).
// Los verbos ambiguos (hacer/armar/crear) solo cuentan si van seguidos del
// objeto: "hago UN billete" sí, "¿qué hago con este billete?" no.
const TIKI_SEG_FABRICAR = /\b(falsific\w*|imprim\w*|fabric\w*|truchar|adulter\w*|clonar|clono|inventar)\b|\b(hacer|hago|hace|armar|armo|crear|creo|consigo|conseguir|comprar|compro|vender|vendo) (un|una|uno|unos|unas|billetes?|monedas?|comprobantes?|transferencias?|recibos?|facturas?|boletas?)\b/;
const TIKI_SEG_AUTENT = /\b(fals\w*|truch\w*|adulter\w*|falsific\w*|clonad\w*|no se si (es|sea|son)|sospech\w*|dud\w*|(es|sea|son|será) (real|verdader\w*|autentic\w*|legitim\w*|confiable)|parece (falso|trucho|raro|adulterad\w*))\b/;

// Temas sensibles por co-ocurrencia: un sustantivo del tema + (opcional) un
// calificador en cualquier parte del mensaje (mas robusto que exigir que
// esten pegados). soloDanino = nunca se responde, aunque sea "defensivo".
const TIKI_SEG_FALSO = /\b(fals\w*|truch\w*|adulter\w*|trucad\w*|falsific\w*|clonad\w*)\b/;
const TIKI_SEG_TEMAS = [
  { id: 'arma', soloDanino: true, nombres: /\b(explosiv\w*|bomba casera|bombas?|municion\w*|granada\w*|polvora|arma de fuego|armas de fuego)\b/ },
  // Daño físico claro, sin ambigüedad (envenenar/secuestrar/apuñalar...).
  { id: 'violencia', soloDanino: true, nombres: /\b(envenen\w*|secuestr\w*|asesin\w*|apu(ñ|n)al\w*|acuchill\w*|descuartiz\w*)\b/ },
  { id: 'malware', nombres: /\b(malware|troyan\w*|ransomware|keylogger\w*|spyware|gusano informatic\w*|ciberataque)\b/ },
  // "virus" solo cuenta con contexto tecnico o intencion (no el de un resfrío).
  { id: 'malware', nombres: /\bvirus\b/, calif: /\b(informatic\w*|compu|computador\w*|\bpc\b|celular|telefono|datos|sistema|programa|archivo|hacer|hago|crear|programar|armar|armo|robar|infectar|espiar|antivirus|troyan\w*)\b/ },
  { id: 'phishing', nombres: /\b(phishing|pishing|fishing|correo falso|mail falso|pagina falsa|sitio falso|link falso)\b/ },
  { id: 'hackeo', nombres: /\b(hacke\w*|hackin\w*|crackear|exploit|vulnerar (una |la )?(cuenta|clave|seguridad|contrasen\w*))\b/ },
  { id: 'credenciales', nombres: /\b(credencial\w*|contrasen\w*|password|clave) (de|del|de la|ajen\w*)\b|\b(robar|roba|sacar|conseguir|obtener|hacke\w*|adivinar) (la |las |una )?(credencial\w*|contrasen\w*|password|clave|cuenta|cuentas)\b/ },
  // Protegerse (siempre defensivo): "cómo protejo/cuido mi cuenta/clave".
  { id: 'credenciales', nombres: /\b(proteg\w*|protej\w*|cuidar\w*|cuido|asegurar\w*|resguard\w*) (mi |la |una |mis )?(cuenta|cuentas|clave|claves|contrasen\w*|usuario|acceso)\b|\bcuenta (segura|hacke\w*|robada|comprometida)\b/ },
  { id: 'estafa', nombres: /\b(estaf\w*|timo|timar|chamuyo para|hacer un cuento|cuento del tio)\b/ },
  { id: 'tarjeta', soloDanino: true, nombres: /\b(clon\w*|copiar|duplicar|grabar) (la |una |mi |su |esa |otra )?(tarjeta|banda magnetica|chip)\b|\btarjeta (clonad\w*|duplicad\w*|copiad\w*)\b/ },
  { id: 'evasion', soloDanino: true, nombres: /\b(no pagar impuestos|no declarar|evadir\w*|evasion|vender en negro|facturar menos|esconder (plata|ventas|ingresos)|blanquear plata|lavar plata|que no me (agarr|pesqu|descubr|vea la afip|vea arca))\w*\b/ },
  // billete/comprobante: fabricarlo es peligroso; recibirlo o dudar, defensivo.
  { id: 'dinero_falso', nombres: /\b(billete\w*|moneda\w*)\b/, calif: TIKI_SEG_AUTENT, ofensivo: TIKI_SEG_FABRICAR },
  { id: 'comprobante_falso', nombres: /\b(comprobante\w*|transferencia\w*|recibo\w*|boleta\w*|factura\w*)\b/, calif: TIKI_SEG_AUTENT, ofensivo: TIKI_SEG_FABRICAR },
  { id: 'robo', nombres: /\b(afanar|afanarle|sacarle (la )?plata|quedarme con la plata|vaciar la caja|robarle)\b/ }
];
const TIKI_RE_SECRETO = /\b(api ?key\w*|apikey|token\w*|service.?role|variables? de entorno|secret\w*|clave de (la api|supabase|la base|el servidor|la app|tikera|produccion)|contrasen\w* de (los|las|otr\w*|tod\w*) (usuari\w*|cuentas?|clientes?|comercios?))\b/;

// Devuelve { nivel, tema } o null. nivel: 'peligroso' | 'defensivo' | 'secreto'.
function tikiRiesgoDe(t){
  if(TIKI_RE_SECRETO.test(t)) return { nivel: 'secreto' };
  const prot = TIKI_SEG_PROT.test(t), ofen = TIKI_SEG_OFEN.test(t), victima = TIKI_SEG_VICTIMA.test(t);
  // Hacerle daño físico a alguien: verbo de daño + persona (evita falsos
  // positivos como "matar el tiempo" o "pegar un cartel", que no llevan víctima).
  // El texto ya está normalizado (sin tildes, ñ→n): "daño" se escribe "dano".
  if(victima && /\b(lastim\w*|hacerle? (dano|mal)|hago (le )?dano|danar\w*|golpe\w*|pegarl?e|pegar|mat(ar|o|arlo|arla|arlos|en)|amenaz\w*|lesion\w*|reventar\w*|cagar a (palos|trompadas)|fajar)\b/.test(t)) return { nivel: 'peligroso', tema: 'violencia' };
  // Engañar o robarle a alguien, aunque no se nombre un tema puntual.
  if(victima && TIKI_SEG_ENGANO.test(t)) return { nivel: 'peligroso', tema: 'robo' };
  // Cobrar de más / quedarse con plata escondiéndose (sin víctima explícita).
  if(TIKI_SEG_OCULTO.test(t) && TIKI_SEG_COBRO_INDEBIDO.test(t)) return { nivel: 'peligroso', tema: 'robo' };
  for(const tema of TIKI_SEG_TEMAS){
    if(!tema.nombres.test(t)) continue;
    if(tema.calif && !tema.calif.test(t)) continue;
    if(tema.soloDanino) return { nivel: 'peligroso', tema: tema.id };
    // Si el tema distingue "fabricar" (ofensivo) de "recibir/dudar", eso manda.
    const ofensivo = tema.ofensivo ? tema.ofensivo.test(t) : (ofen || victima);
    if(ofensivo && !(prot && !tema.ofensivo)) return { nivel: 'peligroso', tema: tema.id };
    // Protegerse/detectar, recibir, o para uno mismo: defensivo, se ayuda.
    return { nivel: 'defensivo', tema: tema.id };
  }
  return null;
}

// Rechazo natural y corto, con una alternativa legitima cuando existe.
// Nada de sermones. Si el usuario insiste, mas firme y mas breve.
function tikiRechazoPeligroso(tema){
  const alt = {
    malware: { pregunta: '¿Cómo detecto si tengo malware en la compu?', label: 'Cómo protegerme del malware' },
    phishing: { pregunta: '¿Cómo me protejo del phishing?', label: 'Cómo protegerme del phishing' },
    hackeo: { pregunta: '¿Cómo protejo mi cuenta?', label: 'Cómo proteger mi cuenta' },
    credenciales: { pregunta: '¿Cómo protejo mi cuenta?', label: 'Cómo proteger mi cuenta' },
    estafa: { pregunta: '¿Cómo evito que me estafen?', label: 'Cómo evitar que me estafen' },
    dinero_falso: { pregunta: '¿Cómo detecto un billete falso?', label: 'Cómo detectar un billete falso' },
    comprobante_falso: { pregunta: '¿Cómo sé si una transferencia es falsa?', label: 'Cómo detectar una transferencia falsa' },
    robo: { pregunta: '¿Cómo evito que me estafen?', label: 'Cómo cuidar la caja' },
    tarjeta: { pregunta: '¿Cómo evito que me estafen?', label: 'Cómo cuidarme de estafas' }
  }[tema];
  const frase = {
    arma: 'Con eso no te puedo ayudar.',
    violencia: 'Con eso no te puedo ayudar.',
    malware: 'No te puedo ayudar a hacer un virus ni nada para dañar o robar datos.',
    phishing: 'No te puedo ayudar a armar un phishing ni a engañar a nadie.',
    hackeo: 'No te puedo ayudar a entrar en una cuenta que no es tuya.',
    credenciales: 'No te puedo ayudar a robar contraseñas ni a entrar en una cuenta ajena.',
    estafa: 'No te puedo ayudar a estafar ni a engañar a nadie.',
    dinero_falso: 'No te puedo ayudar a falsificar billetes.',
    comprobante_falso: 'No te puedo ayudar a falsificar un comprobante ni una transferencia.',
    tarjeta: 'No te puedo ayudar a clonar ni copiar una tarjeta.',
    robo: 'No te puedo ayudar con eso.'
  }[tema] || 'Con eso no te puedo ayudar.';
  if(tema === 'evasion'){
    return { html: '<p>De eso no te puedo aconsejar. Para ver qué podés hacer dentro de la ley con tus impuestos, lo mejor es hablarlo con un contador.</p>' };
  }
  // Daño físico a una persona: rechazo + ayuda de emergencia.
  if(tema === 'violencia'){
    return { html: '<p>No te puedo ayudar con eso. Si vos o alguien está en peligro, llamá al <strong>911</strong>.</p>' };
  }
  if(tikiManipSeguidas >= 2) return { html: `<p>${frase}</p>` };
  return {
    html: `<p>${frase}${alt ? ' Si lo que querés es cuidarte, sí te puedo dar una mano.' : ''}</p>`,
    acciones: alt ? [{ label: alt.label, pregunta: alt.pregunta }] : undefined
  };
}

// Respuestas de seguridad utiles para un comercio. Generales y defensivas,
// no instrucciones para atacar a nadie.
function tikiSeguridadDefensiva(tema){
  const lista = (items) => `<ul class="tiki-list">${items.map(x => `<li><span>${x}</span></li>`).join('')}</ul>`;
  const nota = '<p class="tiki-soft">Esto es orientativo; soy un asistente del negocio, no un experto en seguridad.</p>';
  switch(tema){
    case 'dinero_falso':
      return { html: `<p>Para darte cuenta si un billete es falso, al cobrar fijate en:</p>${lista(['La marca de agua y el hilo de seguridad mirándolo al trasluz.', 'El relieve: los billetes reales tienen zonas que se sienten al tacto.', 'Que el número cambie de color al moverlo.', 'Comparar con otro billete del mismo valor si tenés dudas.'])}<p>Ante la duda, mejor no aceptarlo. El Banco Central tiene una guía oficial de cada billete.</p>${nota}` };
    case 'comprobante_falso':
      return { html: `<p>Un comprobante de transferencia por foto se falsifica fácil. Para no comerte una trucha:</p>${lista(['No entregues la mercadería hasta ver la plata <strong>acreditada en tu cuenta</strong>, no en la captura del cliente.', 'Abrí tu propia app del banco o billetera y confirmá que entró.', 'Desconfiá si apuran, si el nombre no coincide o si “ya te la mando y no figura”.'])}<p>La captura no es comprobante: el único comprobante es que la veas en tu cuenta.</p>${nota}` };
    case 'phishing':
      return { html: `<p>El phishing es cuando te mandan un mail, WhatsApp o link que se hace pasar por el banco, la billetera o una empresa para robarte los datos. Para cuidarte:</p>${lista(['No entres a links de mensajes; abrí la app o la web del banco vos mismo.', 'Nunca des tu clave, token o código por mensaje o teléfono: el banco no los pide.', 'Desconfiá de premios, urgencias y “verificá tu cuenta o se bloquea”.', 'Mirá bien la dirección: suelen usar una parecida con una letra cambiada.'])}${nota}` };
    case 'malware':
      return { html: `<p>Para la compu o el celular del negocio:</p>${lista(['Tené un antivirus al día y hacé un análisis completo.', 'No instales programas “crackeados” ni abras adjuntos raros.', 'Mantené el sistema y las apps actualizados.', 'Si va lento, aparecen ventanas solas o se reinicia, puede estar infectado: conviene revisarlo.'])}${nota}` };
    case 'estafa':
    case 'robo':
      return { html: `<p>Las estafas más comunes a un comercio:</p>${lista(['El “comprobante de transferencia” por foto que nunca se acredita.', 'Pagar con un billete grande para confundirte con el vuelto: contá la plata con calma.', 'Billetes falsos.', 'Llamados que dicen ser del banco o de la tarjeta pidiéndote datos o códigos.'])}<p>La regla general: no entregues nada hasta tener la plata confirmada, y nunca pases claves ni códigos por teléfono.</p>${nota}` };
    case 'hackeo':
    case 'credenciales':
      return { html: `<p>Para proteger tu cuenta:</p>${lista(['Una contraseña larga y que no uses en otro lado.', 'No la compartas ni la anotes a la vista.', 'Activá el segundo factor donde se pueda.', 'Cerrá sesión en dispositivos que no son tuyos.'])}${nota}` };
    default:
      return { html: `<p>Para cuidarte, lo general es: no compartir claves ni códigos, confirmar la plata en tu cuenta antes de entregar nada, y desconfiar de mensajes con links o apuros.</p>${nota}` };
  }
}

function tikiSecreto(){
  return { html: '<p>No manejo claves, tokens ni contraseñas, ni las mías ni las de nadie, así que no hay nada de eso que pueda mostrarte. Lo único que hago es leer los datos de tu negocio para contestarte.</p>' };
}

// Pasa el mensaje por las tres formas y devuelve el riesgo mas serio.
function tikiClasificarRiesgo(raw, t){
  const variantes = [t, tikiAplanar(t), ...tikiDeBase64(raw)];
  let mejor = null;
  const orden = { peligroso: 3, secreto: 2, defensivo: 1 };
  for(const v of variantes){
    const r = tikiRiesgoDe(v);
    if(r && (!mejor || orden[r.nivel] > orden[mejor.nivel])) mejor = r;
    // meta/ajeno tambien se chequean sobre las variantes (ataques escondidos)
    if(!mejor && (TIKI_RE_META.test(v) || TIKI_RE_AJENO.test(v))){
      mejor = { nivel: TIKI_RE_AJENO.test(v) ? 'ajeno' : 'meta' };
    }
  }
  return mejor;
}

// ---------- Conversacion ----------
// Lo que hace que Tiki se sienta como una charla y no como un formulario,
// sin IA: entiende errores de tipeo, se acuerda de que se estaba hablando
// (tikiCtx) para contestar "¿por que?", "¿y eso es bueno?", "¿y que hago?",
// "contame mas" o "¿y la coca?", ofrece el paso siguiente (tikiSugerencia,
// que se acepta con "si") y pregunta cuando le falta un dato. Todo sale de
// los mismos datos y cuentas que el resto: ninguna respuesta inventa.

// Errores de tipeo comunes de alguien que escribe rapido en el celular
// ("bendi", "sierre", "aller", "ganansia", "provedor"): se corrige solo
// cuando la palabra SUENA exactamente igual que una palabra clave de Tiki
// (b/v, s/c/z, ll/y, h muda, letras repetidas). Nunca se cambia una
// palabra por otra "parecida" -- "cierro" no es "cierre", y "gaseosa" no
// es "gastos" --, ni una palabra conocida o del nombre de un producto o
// proveedor.
const TIKI_CLAVES_TIPEO = ['vendi', 'vendimos', 'vendiste', 'venta', 'ventas', 'gaste', 'gastos', 'cierre', 'cierres', 'cerre', 'caja', 'stock', 'quedan', 'queda', 'reponer', 'proveedor', 'proveedores', 'debo', 'deuda', 'deudas', 'ganancia', 'gane', 'hoy', 'ayer', 'semana', 'mes', 'pasado', 'pasada', 'efectivo', 'producto', 'productos', 'cuanto', 'cuantos', 'cuantas', 'hacemos', 'vengo', 'horario', 'hora', 'precio', 'meta', 'recordas', 'olvidate', 'facture', 'recaude', 'porque', 'explicame', 'recomendas', 'sabado', 'viernes'];
function tikiFonetica(w){
  return w.replace(/h/g, '').replace(/ll/g, 'y').replace(/qu/g, 'k').replace(/c([ei])/g, 's$1').replace(/c/g, 'k')
    .replace(/z/g, 's').replace(/b/g, 'v').replace(/(.)\1+/g, '$1');
}
const TIKI_CLAVES_FONETICA = new Map(TIKI_CLAVES_TIPEO.map(c => [tikiFonetica(c), c]));
function tikiCorregir(t){
  if(!t) return t;
  const nombres = new Set();
  products.concat(proveedores).forEach(x => tikiNorm(x && x.nombre).split(' ').forEach(w => nombres.add(w)));
  return t.split(' ').map(w => {
    if(w.length < 3 || /\d/.test(w) || TIKI_STOP.has(w) || TIKI_CLAVES_TIPEO.includes(w) || nombres.has(w)) return w;
    return TIKI_CLAVES_FONETICA.get(tikiFonetica(w)) || w;
  }).join(' ');
}

// Cuanto se vende un dia como este (mismo dia de la semana, ultimas 8
// semanas, solo los que tuvieron ventas). hastaMin: comparar solo hasta esa
// hora del dia (para el dia en curso).
function tikiPromedioMismoDia(fecha, hastaMin){
  const valores = [];
  for(let k = 1; k <= 8; k++){
    const f = tikiSumarDias(fecha, -7 * k);
    let ventas = tikiMovs(f, f, 'Venta');
    if(!ventas.length) continue;
    if(hastaMin !== undefined) ventas = ventas.filter(e => { const m = String(e.hora || '').match(/^(\d{1,2}):(\d{2})/); return m && Number(m[1]) * 60 + Number(m[2]) <= hastaMin; });
    valores.push(ventas.reduce((s, e) => s + (Number(e.monto) || 0), 0));
  }
  return { prom: valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : 0, n: valores.length };
}
function tikiMinutosAhora(){ const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function tikiPeriodoAnterior(p){
  if(p.dia) return { desde: tikiSumarDias(p.desde, -7), hasta: tikiSumarDias(p.hasta, -7), label: `el ${tikiDiaSemana(tikiSumarDias(p.desde, -7))} anterior` };
  const dias = Math.round((tikiParse(p.hasta) - tikiParse(p.desde)) / 86400000) + 1;
  return { desde: tikiSumarDias(p.desde, -dias), hasta: tikiSumarDias(p.hasta, -dias), label: 'el período anterior' };
}
function tikiTopHoras(n){
  const p = tikiUltimos30();
  const porHora = new Map();
  tikiMovs(p.desde, p.hasta, 'Venta').forEach(e => { const m = String(e.hora || '').match(/^(\d{1,2}):/); if(m) porHora.set(Number(m[1]), (porHora.get(Number(m[1])) || 0) + (Number(e.monto) || 0)); });
  return [...porHora.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([h]) => h).sort((a, b) => a - b);
}
function tikiTopNombres(n){
  const p = tikiUltimos30();
  return tikiAgruparVentas(tikiMovs(p.desde, p.hasta, 'Venta')).sort((a, b) => b.monto - a.monto).slice(0, n).map(g => g.nombre);
}

// "¿Por que?" / "¿como sale eso?": de donde viene lo ultimo que dijo Tiki.
function tikiExplicar(c){
  if(c.tema === 'ventas'){
    const { p, r, foco } = c;
    if(foco === 'ganancia'){
      return { html: `<p>La ganancia real es lo que vendiste, menos lo que te costó esa mercadería, menos los gastos: ${tikiPlata(r.ventas)} − ${tikiPlata(r.costoMerc)} − ${tikiPlata(r.gastos)} = <strong>${tikiPlata(r.ganancia)}</strong>.</p>${r.sinCosto ? `<p class="tiki-soft">${r.sinCosto} ${r.sinCosto === 1 ? 'venta no tiene' : 'ventas no tienen'} el costo cargado, así que ${r.sinCosto === 1 ? 'cuenta' : 'cuentan'} como si no te hubieran costado nada.</p>` : ''}` };
    }
    const ant = tikiPeriodoAnterior(p);
    const ra = tikiResumen(ant.desde, ant.hasta);
    if(!ra.cantVentas) return { html: `<p>No tengo ventas de ${ant.label} para comparar, así que no puedo decirte qué cambió.</p>` };
    const promedio = (x) => (x.cantVentas ? x.ventas / x.cantVentas : 0);
    const a = new Map(tikiAgruparVentas(r.lista).map(g => [tikiNorm(g.nombre), g]));
    const b = new Map(tikiAgruparVentas(ra.lista).map(g => [tikiNorm(g.nombre), g]));
    const difs = [...new Set([...a.keys(), ...b.keys()])]
      .map(k => ({ nombre: (a.get(k) || b.get(k)).nombre, dif: ((a.get(k) || {}).monto || 0) - ((b.get(k) || {}).monto || 0) }))
      .filter(d => Math.abs(d.dif) >= 1).sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif)).slice(0, 3);
    let html = `<p>Contra ${ant.label}: hiciste <strong>${r.cantVentas}</strong> ${r.cantVentas === 1 ? 'venta' : 'ventas'} (antes ${ra.cantVentas}), y cada venta fue de ${tikiPlata(promedio(r))} en promedio (antes ${tikiPlata(promedio(ra))}).</p>`;
    if(difs.length) html += `<p>Lo que más cambió:</p><ul class="tiki-list">${difs.map(d => `<li class="${d.dif > 0 ? 'bien' : 'urgente'}"><span>${escapeHtml(d.nombre)}: <span class="${d.dif > 0 ? 'tiki-pos' : 'tiki-neg'}">${d.dif > 0 ? '+' : ''}${tikiPlata(d.dif)}</span></span></li>`).join('')}</ul>`;
    return { html };
  }
  if(c.tema === 'cierre' || c.tema === 'cierreAbierto'){
    const f = c.fecha;
    const ef = tikiMovs(f, f).filter(e => e.metodoPago === 'Efectivo');
    const suma = (arr) => arr.reduce((s, e) => s + (Number(e.monto) || 0), 0);
    const ventasEf = ef.filter(e => e.tipo === 'Venta'), gastosEf = ef.filter(e => e.tipo === 'Gasto');
    let html = `<p>El efectivo esperado ${tikiDeDia(f)} es lo que entró en efectivo (${tikiPlata(suma(ventasEf))}) menos lo que pagaste con plata de la caja (${tikiPlata(suma(gastosEf))}): <strong>${tikiPlata(suma(ventasEf) - suma(gastosEf))}</strong>.</p>`;
    if(c.dif <= -1){
      html += '<p>Cuando falta plata, lo más común es:</p><ul class="tiki-list"><li><span>un vuelto mal dado,</span></li><li><span>una venta cobrada con tarjeta, QR o transferencia pero cargada como efectivo,</span></li><li><span>o algo pagado con plata de la caja que no se cargó como gasto.</span></li></ul>';
    } else if(c.dif >= 1){
      html += '<p>Cuando sobra, casi siempre es una venta en efectivo que no se cargó, o un gasto cargado como efectivo que en realidad se pagó de otra forma.</p>';
    }
    if(gastosEf.length) html += `<p class="tiki-soft">Gastos en efectivo de ese día: ${tikiListaNombres(gastosEf.map(g => `${escapeHtml(g.descripcion || 'sin nombre')} ${tikiPlata(g.monto)}`), true, 4)}.</p>`;
    return { html };
  }
  if(c.tema === 'stock'){
    const p = (c.prods || [])[0];
    if(p && c.prods.length === 1){
      const rate = ventaDiariaDe(p), stock = Number(p.stock_actual) || 0;
      if(rate > 0) return { html: `<p>En las últimas 2 semanas vendiste unas ${tikiNum(rate * 14)} unidades de ${escapeHtml(p.nombre)}, o sea ~${tikiNum(rate)} por día. Con ${tikiNum(stock)} en stock, eso da ${stock > 0 ? `~${Math.floor(stock / rate)} días` : 'cero días'}.</p>` };
    }
    return { html: '<p>Para cada producto miro cuánto vendiste en las últimas 2 semanas, saco cuánto vendés por día y lo comparo con el stock que te queda. Lo que te digo de reponer es lo que necesitás para cubrir otras 2 semanas.</p>' };
  }
  if(c.tema === 'mes'){
    const r = c.r;
    return { html: `<p>Lo del mes sale de sumar todo lo cargado desde el 1: vendiste ${tikiPlata(r.ventas)}, la mercadería te costó ${tikiPlata(r.costoMerc)} y gastaste ${tikiPlata(r.gastos)}. La ganancia real es la resta: <strong>${tikiPlata(r.ganancia)}</strong>.</p>${r.gastos > r.ventas - r.costoMerc ? '<p>Por eso da negativa: los gastos del mes son más grandes que lo que te deja la mercadería vendida.</p>' : ''}` };
  }
  if(c.tema === 'equilibrio' || c.tema === 'objetivo'){
    return { html: '<p>Lo calculo con dos cosas tuyas: cuánto te deja cada $100 de venta después de pagar la mercadería (tu margen, medido sobre las ventas que tienen el costo cargado), y tus gastos del mes sin contar la compra de mercadería. El punto de equilibrio es gastos dividido margen; para una meta de ganancia, le sumo esa meta a los gastos antes de dividir. Es una estimación con tus números recientes.</p>' };
  }
  const textos = {
    dias: 'Para cada día de la semana sumo lo que vendiste en las últimas 8 semanas y lo divido por la cantidad de veces que hubo ese día. Los días que me dijiste que no abrís no cuentan.',
    horas: 'Sumo las ventas de cada hora según la hora en que se cargaron. Si cargás las ventas todas juntas al final del día, esto no va a ser exacto.',
    deudas: 'Sumo los pedidos que anotaste en Proveedores y todavía no marcaste como pagados.',
    ranking: 'Sumo lo que vendiste de cada producto, agrupando por el nombre con el que se cargó la venta.',
    gastos: 'Sumo los gastos cargados en ese período, agrupados por la categoría que elegiste al cargarlos.',
    plan: 'Lo armo con lo que tenés cargado: cajas sin cerrar, productos que se agotan, deudas, gastos fijos del mes pasado que todavía no cargaste, feriados y precios por debajo del costo.',
    producto: 'El margen es precio menos costo, dividido el precio. El stock y las ventas salen del catálogo y de lo que vendiste en los últimos 30 días.'
  };
  return { html: `<p>${textos[c.tema] || 'Todo lo que te digo sale de lo que cargaste en Tikera: no uso datos de afuera ni estimo números que no tengo.'}</p>` };
}

// "¿Y eso es bueno?": siempre contra la propia historia del comercio.
function tikiEvaluar(c){
  const hoy = todayStr();
  if(c.tema === 'ventas' && c.foco !== 'ganancia'){
    const { p, r } = c;
    if(p.dia){
      const enCurso = p.desde === hoy;
      const { prom, n } = tikiPromedioMismoDia(p.desde, enCurso ? tikiMinutosAhora() : undefined);
      const dia = TIKI_DIAS_PLURAL[tikiParse(p.desde).getDay()];
      if(n < 3 || !prom) return { html: `<p>Todavía tengo pocos ${dia} con ventas para comparar (${n}). En unas semanas te lo puedo decir.</p>` };
      const pct = Math.round((r.ventas - prom) / prom * 100);
      const comparado = enCurso ? `A esta hora, un ${tikiDiaSemana(p.desde)} normal llevás unos ${tikiPlata(prom)}; hoy` : `Un ${tikiDiaSemana(p.desde)} normal vendés unos ${tikiPlata(prom)}; esta vez`;
      const veredicto = pct >= 10 ? `<strong>Sí, ${enCurso ? 'vas bien' : 'fue un buen día'}</strong>` : pct <= -10 ? `<strong>${enCurso ? 'Vas un poco abajo de lo normal' : 'Estuvo abajo de lo normal'}</strong>` : `<strong>${enCurso ? 'Vas normal' : 'Fue un día normal'}</strong>`;
      return { html: `<p>${veredicto}. ${comparado} ${enCurso ? 'llevás' : 'vendiste'} ${tikiPlata(r.ventas)} (${pct > 0 ? '+' : ''}${pct}%).</p><p class="tiki-soft">Lo comparo con los últimos ${n} ${dia} con ventas.</p>` };
    }
    const ant = tikiPeriodoAnterior(p);
    const ra = tikiResumen(ant.desde, ant.hasta);
    if(!ra.ventas) return { html: `<p>No tengo ventas de ${ant.label} para comparar.</p>` };
    const pct = Math.round((r.ventas - ra.ventas) / ra.ventas * 100);
    return { html: `<p><strong>${pct >= 5 ? 'Sí' : pct <= -5 ? 'No tanto' : 'Normal'}</strong>: contra ${ant.label} vendiste ${pct > 0 ? '+' : ''}${pct}% (${tikiPlata(r.ventas)} contra ${tikiPlata(ra.ventas)}).</p>` };
  }
  if(c.tema === 'ventas' || c.tema === 'mes'){
    const r = c.r;
    if(!r.ventas) return { html: '<p>Sin ventas no te puedo decir cómo viene la ganancia.</p>' };
    const margen = Math.round(r.ganancia / r.ventas * 100);
    const finPrev = new Date(tikiParse(hoy).getFullYear(), tikiParse(hoy).getMonth(), 0);
    const rp = tikiResumen(tikiFecha(new Date(finPrev.getFullYear(), finPrev.getMonth(), 1)), tikiFecha(finPrev));
    const margenPrev = rp.ventas ? Math.round(rp.ganancia / rp.ventas * 100) : null;
    let html = `<p>De cada $100 que vendés, te quedan <strong>${tikiPlata(margen)}</strong> de ganancia real.</p>`;
    if(margenPrev !== null) html += `<p>${margen >= margenPrev ? 'Está igual o mejor que' : 'Está peor que'} el mes pasado completo, cuando te quedaban ${tikiPlata(margenPrev)}.</p>`;
    return { html };
  }
  if(c.tema === 'cierre'){
    if(Math.abs(c.dif) < 1) return { html: '<p><strong>Sí</strong>: dio justo, que es lo mejor que puede pasar.</p>' };
    const ultimos = [...cierresCaja].filter(x => x && x.fecha <= c.fecha).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 30);
    const conDif = ultimos.filter(x => Math.abs(Number(x.diferencia) || 0) >= 1);
    const promAbs = conDif.length ? conDif.reduce((s, x) => s + Math.abs(Number(x.diferencia) || 0), 0) / conDif.length : 0;
    return { html: `<p><strong>No es lo ideal</strong>: ${c.dif < 0 ? 'faltaron' : 'sobraron'} ${tikiPlata(Math.abs(c.dif))}. En tus últimos ${ultimos.length} cierres hubo diferencia ${conDif.length} ${conDif.length === 1 ? 'vez' : 'veces'}, de ${tikiPlata(promAbs)} en promedio, así que esta ${Math.abs(c.dif) > promAbs * 1.2 ? 'es más grande de lo habitual' : 'está dentro de lo que te suele pasar'}.</p>` };
  }
  if(c.tema === 'producto' && c.prod){
    const conMargen = products.filter(x => Number(x.precio_venta) > 0 && Number(x.costo_unitario) > 0);
    const m = (x) => (Number(x.precio_venta) - Number(x.costo_unitario)) / Number(x.precio_venta) * 100;
    if(!(Number(c.prod.precio_venta) > 0 && Number(c.prod.costo_unitario) > 0) || conMargen.length < 2) return { html: '<p>Para decirte si el margen es bueno necesito el precio y el costo cargados, en este y en otros productos.</p>' };
    const prom = conMargen.reduce((s, x) => s + m(x), 0) / conMargen.length;
    const este = m(c.prod);
    return { html: `<p>Este producto te deja ${Math.round(este)}% y el promedio de tu catálogo es ${Math.round(prom)}%: ${este >= prom ? '<strong>está por encima</strong>' : '<strong>está por debajo</strong>'} de tus otros productos.</p>` };
  }
  if(c.tema === 'deudas'){
    const viejo = tikiDeudasLista().map(d => d.desde).filter(Boolean).sort()[0];
    if(!viejo) return { html: '<p>Estás al día con todos, así que sí, muy bien.</p>' };
    const dias = Math.round((tikiParse(hoy) - tikiParse(viejo)) / 86400000);
    return { html: dias > 30 ? `<p><strong>Ojo</strong>: el pedido sin pagar más viejo es de hace ${dias} días. Conviene ponerse al día antes de que el proveedor te corte el crédito.</p>` : `<p>Son pedidos recientes (el más viejo es de hace ${dias} ${dias === 1 ? 'día' : 'días'}): nada raro.</p>` };
  }
  return { html: '<p>Para decirte si es bueno necesito compararlo con algo. ¿Querés que veamos cómo venís este mes contra el pasado?</p>', sugerencia: { texto: '', pregunta: '¿Cómo vengo este mes?' } };
}

// "¿Y que hago?": pasos concretos, con los datos del propio negocio.
function tikiRecomendar(c){
  const lista = (items) => `<ul class="tiki-list">${items.map(x => `<li><span>${x}</span></li>`).join('')}</ul>`;
  if(c.tema === 'cierre' && c.dif <= -1){
    return { html: `<p>Te diría, en este orden:</p>${lista(['Volver a contar la caja, sin apuro.', `Revisar en Historial las ventas ${tikiDeDia(c.fecha)} cargadas como efectivo: ¿alguna se cobró con tarjeta, QR o transferencia?`, 'Anotar como gasto cualquier cosa que se haya pagado con plata de la caja.', 'Si se repite, contar la caja en cada cambio de turno para saber en qué turno pasa.'])}`, acciones: [{ label: 'Ir a Historial', view: 'historial' }] };
  }
  if(c.tema === 'cierreAbierto') return { html: '<p>Cerrá la caja contando el efectivo: así cualquier diferencia se detecta hoy y no dentro de una semana.</p>', acciones: [{ label: `Cerrar la caja ${tikiDeDia(c.fecha)}`, view: 'caja', fecha: c.fecha }] };
  if(c.tema === 'stock'){
    const urgentes = tikiParaReponer().filter(r => r.dias !== null && r.dias <= 2);
    if(!urgentes.length) return { html: '<p>No hay nada urgente: podés juntar lo que haga falta para el próximo pedido.</p>' };
    return { html: `<p>Pedí hoy ${tikiListaNombres(urgentes.map(r => `<strong>${escapeHtml(r.nombre)}</strong>`), true, 4)}: ${urgentes.length === 1 ? 'se termina' : 'se terminan'} en un par de días. Lo demás puede ir en el próximo pedido.</p>` };
  }
  if(c.tema === 'deudas'){
    const lista2 = tikiDeudasLista().filter(d => d.desde).sort((a, b) => a.desde.localeCompare(b.desde));
    if(!lista2.length) return { html: '<p>No le debés a nadie, así que nada que hacer por acá.</p>' };
    return { html: `<p>Pagale primero a <strong>${escapeHtml(lista2[0].p.nombre)}</strong>: tiene el pedido sin pagar más viejo (del ${tikiFechaCorta(lista2[0].desde)}). Y cuando pagues, marcalo como pagado en Proveedores así la cuenta queda al día.</p>`, acciones: [{ label: 'Ver proveedores', view: 'catalogo', tab: 'proveedores' }] };
  }
  if(c.tema === 'ranking' && c.menos){
    const top = tikiTopNombres(2);
    return { html: `<p>Algunas ideas para moverlos:</p>${lista([top.length ? `Armar un combo con algo que sí sale${top.length ? ` (${tikiListaNombres(top)})` : ''}.` : 'Armar un combo con algo que sí sale.', 'Ponerlos a la vista, cerca de la caja.', 'Bajarles un poco el precio para recuperar la plata.', 'No volver a pedirlos hasta que se terminen.'])}` };
  }
  if(c.tema === 'ventas' || c.tema === 'dias' || c.tema === 'horas' || c.tema === 'ranking'){
    const horas = tikiTopHoras(2), top = tikiTopNombres(3);
    const items = [];
    if(horas.length) items.push(`Tus horas fuertes son ${horas.map(h => `las ${h}`).join(' y ')} hs: que a esa hora no falte ${top.length ? tikiListaNombres(top) : 'lo que más sale'}.`);
    const prom = tikiPromediosPorDia();
    if(prom){
      const cerrados = (tikiRecuerda('dias_cerrado') || { dias: [] }).dias;
      const orden = prom.filter(x => x.promedio > 0 && !cerrados.includes(x.dia)).sort((a, b) => b.promedio - a.promedio);
      if(orden.length >= 3) items.push(`Reforzá el stock antes de los ${TIKI_DIAS_PLURAL[orden[0].dia]} (tu mejor día) y usá los ${TIKI_DIAS_PLURAL[orden[orden.length - 1].dia]} para ordenar y hacer pedidos.`);
    }
    items.push('Lo que no se mueve, ponelo a la vista o armá un combo con lo que más sale.');
    return { html: `<p>Con lo que veo en tus números:</p>${lista(items)}` };
  }
  if(c.tema === 'mes' && c.r && c.r.ganancia < 0){
    const porCat = {};
    tikiMovs(todayStr().slice(0, 8) + '01', todayStr(), 'Gasto').forEach(e => { const k = e.categoria || 'Sin categoría'; porCat[k] = (porCat[k] || 0) + (Number(e.monto) || 0); });
    const grandes = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 2);
    return { html: `<p>Este mes los gastos son más grandes que lo que te deja la mercadería. Lo primero a mirar son los gastos más grandes${grandes.length ? `: ${grandes.map(([k, v]) => `${escapeHtml(k)} (${tikiPlata(v)})`).join(' y ')}` : ''}. Ojo que los fijos (alquiler, sueldos) suelen caer a principio de mes y se compensan a medida que vendés.</p>` };
  }
  return tikiPlanDelDia();
}

// "Contame mas": la misma respuesta, con mas detalle.
function tikiMas(c){
  if(c.tema === 'ventas'){
    const { p, r } = c;
    const top = tikiAgruparVentas(r.lista).sort((a, b) => b.monto - a.monto).slice(0, 5);
    const porMetodo = {};
    r.lista.forEach(e => { const m = e.metodoPago || 'Otro'; porMetodo[m] = (porMetodo[m] || 0) + (Number(e.monto) || 0); });
    let html = `<p>${tikiCap(p.label)}, en detalle:</p>`;
    if(top.length) html += tikiBarras(top.map((g, i) => ({ label: g.nombre, valor: g.monto, texto: tikiPlata(g.monto), top: i === 0 })), true);
    const metodos = Object.entries(porMetodo).sort((a, b) => b[1] - a[1]);
    if(metodos.length) html += `<p class="tiki-soft">Cobrado: ${metodos.map(([m, v]) => `${escapeHtml(m === m.toUpperCase() ? m : m.toLowerCase())} ${tikiPlata(v)}`).join(', ')}.</p>`;
    return { html };
  }
  if(c.tema === 'ranking') return tikiTopProductos(c.p, c.criterio, c.menos, 10);
  if(c.tema === 'deudas'){
    const pend = pedidosProveedor.filter(x => x && !x.pagado).sort((a, b) => String(a.fecha).localeCompare(String(b.fecha))).slice(0, 8);
    if(!pend.length) return { html: '<p>No hay pedidos sin pagar.</p>' };
    const nombre = (id) => (proveedores.find(p => String(p.id) === String(id)) || {}).nombre || 'Proveedor';
    return { html: `<p>Pedidos sin pagar, del más viejo al más nuevo:</p><ul class="tiki-list">${pend.map(x => `<li class="pronto"><span>${x.fecha ? tikiFechaCorta(x.fecha) : 'sin fecha'} · <strong>${escapeHtml(nombre(x.proveedor_id))}</strong>${x.descripcion ? ` (${escapeHtml(x.descripcion)})` : ''}: ${tikiPlata(x.monto)}</span></li>`).join('')}</ul>` };
  }
  if(c.tema === 'cierre' || c.tema === 'cierreAbierto'){
    const ultimos = [...cierresCaja].filter(Boolean).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
    if(!ultimos.length) return tikiExplicar(c);
    return { html: `<p>Tus últimos cierres:</p><ul class="tiki-list">${ultimos.map(x => { const d = Number(x.diferencia) || 0; return `<li class="${Math.abs(d) < 1 ? 'bien' : d < 0 ? 'urgente' : 'pronto'}"><span>${tikiCap(tikiLabelDia(x.fecha))}: ${Math.abs(d) < 1 ? 'justo' : `${d < 0 ? 'faltaron' : 'sobraron'} ${tikiPlata(Math.abs(d))}`}</span></li>`; }).join('')}</ul>` };
  }
  if(c.tema === 'stock') return tikiReponer();
  return tikiExplicar(c);
}

// Si el usuario no dijo que quiere saber de una fecha, se lo pregunta.
function tikiAclararPeriodo(p){
  const del = p.dia ? tikiDeDia(p.desde) : p.label;
  return {
    html: `<p>¿Qué querés ver de ${p.label}?</p>`,
    acciones: [
      { label: 'Las ventas', pregunta: `¿Cuánto vendí ${p.label}?` },
      { label: 'Los gastos', pregunta: `¿Cuánto gasté ${p.label}?` },
      { label: p.dia ? 'El cierre' : 'Los cierres', pregunta: p.dia ? `¿Cómo fue el cierre ${del}?` : `¿Cómo fueron los cierres ${p.label}?` }
    ]
  };
}

// Repreguntas sobre la respuesta anterior. Devuelve null si no es una.
function tikiSeguimiento(t, sugerida){
  if(tikiPendiente) return null; // un "si" pendiente es para la memoria
  const palabras = t.split(' ').length;
  if(sugerida && /^(si|sii+|dale|ok|okey|obvio|claro|de una|bueno|si dale|si mostrame|mostrame|a ver|si por favor|porfa|si porfa)$/.test(t)){
    const tt = tikiCorregir(tikiNorm(sugerida.pregunta));
    return tikiSeguimiento(tt, null) || tikiRutear(sugerida.pregunta, tt);
  }
  if(sugerida && /^(no|nah|nop|no gracias|despues|mas tarde|dejalo|deja|no por ahora)$/.test(t)) return { html: '<p>Dale. Cuando quieras, preguntame otra cosa.</p>' };
  const c = tikiCtx;
  if(!c || palabras > 6) return null;
  if(/^(y )?(por que|porque|como es eso|como asi|explicame|explicamelo|a que se debe|de donde sale|como lo calculas|como se calcula)( eso)?$/.test(t)) return tikiExplicar(c);
  if(/^(y )?(eso )?(es|esta|fue|estuvo|viene|va) (bueno|bien|malo|mal|mucho|poco|normal)( o (malo|mal|bueno|bien|poco|mucho))?( eso)?$|^(y )?(es )?normal( eso)?$|^(y )?(como lo ves|que opinas|que te parece)$/.test(t)) return tikiEvaluar(c);
  if(/^(y )?(entonces )?(que (hago|puedo hacer|me recomendas|me aconsejas|harias|deberia hacer|hacemos|hago con eso)|alguna (idea|recomendacion)|ideas?|consejos?|recomendaciones?)( entonces| con eso| ahora)?$/.test(t)) return tikiRecomendar(c);
  if(/^(y )?(mas|contame mas|mas detalle|detalle|detallame|ampliame|mostrame mas|que mas|algo mas|mas info)$/.test(t)) return tikiMas(c);
  // "¿y la coca?" / "¿y Arcor?": la misma pregunta, sobre otra cosa.
  if(/^y /.test(t) || palabras <= 3){
    const claves = tikiSobrantes(t).map(tikiRaiz);
    if(!claves.length) return null;
    if(c.tema === 'stock' || c.tema === 'producto'){
      const m = tikiBuscar(claves, products, p => p.nombre);
      if(m.length) return c.tema === 'stock' ? tikiStock(m) : (m.length === 1 ? tikiProducto(m[0]) : tikiVariosProductos(m));
    }
    if(c.tema === 'ventasProducto'){
      const nombres = tikiBuscar(claves, tikiNombresVendidos(), x => x);
      if(nombres.length) return tikiVentasProducto(nombres, c.p);
    }
    if(c.tema === 'deudas'){
      const pv = tikiBuscar(claves, proveedores, p => p.nombre);
      if(pv.length) return tikiDeudas(pv);
    }
  }
  return null;
}

// Despues de cada respuesta: anota de que se hablo y ofrece el paso siguiente.
function tikiCerrarRespuesta(r){
  if(!r) return r;
  if(r.ctx) tikiCtx = { ...r.ctx, ts: Date.now() };
  if(r.sugerencia && r.sugerencia.pregunta){
    tikiSugerencia = { ...r.sugerencia, ts: Date.now() };
    if(r.sugerencia.texto) r.html += `<p class="tiki-sugerencia">${r.sugerencia.texto}</p>`;
    r.acciones = (r.acciones || []).concat([{ label: r.sugerencia.boton || 'Sí, mostrame', pregunta: r.sugerencia.pregunta }]).slice(0, 4);
  }
  delete r.ctx;
  delete r.sugerencia;
  return r;
}

// ---------- Que quiso preguntar ----------
async function tikiConfirmarGuardado(clave, valor){
  const ok = await tikiGuardarMemoria(clave, valor);
  return ok
    ? { html: `<p>Listo: me acuerdo de que ${tikiTextoMemoria(clave, valor)}. Si cambia, decímelo o pedime que me olvide.</p>` }
    : { html: '<p>No pude guardarlo ahora (puede ser la conexión). Probá de nuevo en un rato.</p>' };
}

// Orden: 1) lo que Tiki nunca hace, 2) el "si"/"no" a algo que ofrecio
// recordar, 3) habitos y memoria, 4) pedidos de cambiar datos, 5) las
// preguntas sobre el negocio. Ningun texto (del usuario o de los datos)
// puede cambiar este orden ni lo que hace cada rama: no hay modelo de IA
// que "obedezca" -- las palabras solo eligen que cuenta hacer.
async function tikiResponder(texto){
  const raw = String(texto || '').slice(0, 300);
  const t = tikiCorregir(tikiNorm(raw));
  if(!t) return tikiNoEntendi();
  await tikiCargarMemoria();
  if(tikiCtx && Date.now() - tikiCtx.ts > TIKI_CONTEXTO_MS) tikiCtx = null;
  const sugerida = tikiSugerencia && Date.now() - tikiSugerencia.ts <= TIKI_CONTEXTO_MS ? tikiSugerencia : null;
  tikiSugerencia = null; // la oferta vale solo para la respuesta siguiente
  // Capa de intencion/riesgo, antes que cualquier repregunta. Lo peligroso
  // y la manipulacion se cortan aca; lo defensivo se responde con ayuda.
  const riesgo = tikiClasificarRiesgo(raw, t);
  if(riesgo){
    if(riesgo.nivel === 'defensivo'){
      tikiManipSeguidas = 0;
      return tikiCerrarRespuesta(tikiSeguridadDefensiva(riesgo.tema));
    }
    tikiManipSeguidas++;
    if(riesgo.nivel === 'peligroso') return tikiCerrarRespuesta(tikiRechazoPeligroso(riesgo.tema));
    if(riesgo.nivel === 'secreto') return tikiCerrarRespuesta(tikiSecreto());
    if(riesgo.nivel === 'ajeno') return tikiCerrarRespuesta(tikiFueraDeAlcance('ajeno', t));
    return tikiCerrarRespuesta(tikiFueraDeAlcance('meta', t));
  }
  tikiManipSeguidas = 0;
  const seguimiento = await tikiSeguimiento(t, sugerida);
  return tikiCerrarRespuesta(seguimiento || await tikiRutear(raw, t));
}

async function tikiRutear(raw, t){
  const periodo = tikiPeriodo(t);
  const sobrantes = tikiSobrantes(t);
  const claves = sobrantes.map(tikiRaiz);
  const nPalabras = t.split(' ').length;
  // Las preguntas que dependen de una fecha quedan guardadas para poder
  // repreguntar solo la fecha despues ("¿y ayer?", "¿y el sábado?"), pero
  // solo un rato: pasados 10 minutos, "¿y ayer?" ya no se sabe a que va.
  if(tikiSeguir && Date.now() - tikiSeguirTs > TIKI_CONTEXTO_MS) tikiSeguir = null;
  const seguir = (fn) => { tikiSeguir = fn; tikiSeguirTs = Date.now(); return fn(periodo); };
  const prods = () => tikiBuscar(claves, products, p => p.nombre);
  const provs = () => tikiBuscar(claves, proveedores, p => p.nombre);

  if(TIKI_RE_META.test(t)) return tikiFueraDeAlcance('meta', t);
  if(TIKI_RE_AJENO.test(t)) return tikiFueraDeAlcance('ajeno', t);

  if(tikiPendiente){
    const pend = tikiPendiente;
    tikiPendiente = null; // cualquier otra respuesta hace caducar la oferta
    if(/^(si|sii+|dale|ok|okey|obvio|claro|guardalo|acordate|perfecto|de una|si dale|si acordate)$/.test(t)) return await tikiConfirmarGuardado(pend.clave, pend.valor);
    if(/^(no|nah|nop|deja|dejalo|no gracias|mejor no|no guardes nada)$/.test(t)) return { html: '<p>Listo, no guardo nada.</p>' };
  }

  // Punto de equilibrio y objetivo de GANANCIA (distinto de la meta de
  // ventas de la memoria): va antes de la memoria para que "quiero ganar X"
  // no se guarde como meta de ventas.
  if(/\bpunto de equilibrio\b|\b(cuanto|que).{0,30}\bvender\b.{0,20}\b(cubrir|cubra|tapar|empatar|no perder)\b|\bpara (cubrir|tapar) (mis |los |el )?(gastos|costos)\b|\bcubrir (mis |los )?(gastos|costos)\b|\bcuanto.{0,20}(para no perder|para empatar|para estar en cero)\b/.test(t)){
    return tikiEquilibrio();
  }
  if(/\b(ganar|ganarme|llevarme|que me queden|quedarme con|sacar limpio|ganancia de)\b/.test(t) && /\b(por mes|al mes|mensual|por dia|al dia|diario|por semana|semanal|en el mes|mes)\b/.test(t)){
    const monto = tikiLeerMonto(raw);
    if(monto){
      let mensual = monto;
      if(/\b(por dia|al dia|diario|por jornada)\b/.test(t)) mensual = monto * tikiDiasAbiertosMes();
      else if(/\b(por semana|semanal)\b/.test(t)) mensual = Math.round(monto * 30 / 7);
      return tikiObjetivo(mensual);
    }
    return { html: '<p>¿Cuánto querés ganar? Decime algo como «quiero ganar 500.000 por mes» y te calculo cuánto deberías vender.</p>' };
  }

  // Detección de anomalías ("¿algo raro?", "¿qué mirar?").
  if(/\b(algo raro|algo (que|para) (mirar|revisar|prestar atencion|ver)|que (deberia|tengo que|hay que) (mirar|revisar)|hay algo (raro|mal|para revisar)|anomal\w*|algo extraño|algo que no (cuadre|cierre)|como (esta|anda|viene) (el|mi) negocio)\b/.test(t)) return tikiAnomalias();
  // Proyección de cierre de mes.
  if(/\b(proyecc\w*|proyecta\w*|estima\w*)\b.{0,15}\bmes\b|\b(como (voy a|vas a)|en cuanto|cuanto) (cerra|termina|termino|cierro|voy a cerrar|voy a terminar)\w*\b|\bsi (sigo|seguis|seguimos) (asi|a este ritmo)\b|\b(a este ritmo|al ritmo).{0,20}(mes|cierro|termino)\b|\bcuanto voy a (vender|hacer|facturar) (este |el )?mes\b|\bcomo (voy a|va a) (cerrar|terminar) el mes\b/.test(t)) return tikiProyeccionMes();
  // Categorías.
  if(/\b(que|cual|cuales) categoria\b|\bcategoria (crece|creciendo|sub\w*|baj\w*|cae|cayo)\b/.test(t)) return tikiCategoriaCrece();
  if(/\b(categoria|categorias|rubro|rubros|por rubro)\b/.test(t)){
    if(/\b(crece|creciendo|sub\w*|baj\w*|cae|cayo|evolucion\w*)\b/.test(t)) return tikiCategoriaCrece();
    return seguir(tikiCategorias);
  }
  const catNombrada = tikiCategoriaEnTexto(t);
  if(catNombrada && /\b(vend\w*|factur\w*|gan\w*|deja|margen|como (va|viene|anda)|cuanto)\b/.test(t) && !tikiBuscar(claves, products, p => p.nombre).length){
    return seguir(p => tikiVentasCategoria(catNombrada, p));
  }

  const esPregunta = tikiEsPreguntaDeHabito(raw, t);
  const horario = tikiLeerHorario(t);
  if(/\b(a que hora|que hora|cuando)\b.*\b(cierro|cerramos|cerre|cerrar la caja|cierre la caja)\b/.test(t) && !horario) return tikiHabitoCierre(null);
  if(horario && esPregunta) return tikiHabitoCierre(horario);
  const diasMencionados = tikiLeerDias(t);
  if(esPregunta && diasMencionados.length && /\b(abro|abrimos|cerrado|cerramos|trabajo|trabajamos)\b/.test(t)) return tikiHabitoDias(diasMencionados);
  const mem = tikiMemoriaResponder(raw, t);
  if(mem) return mem;
  if(TIKI_RE_ACCION.test(t)) return tikiFueraDeAlcance('accion', t);

  if(nPalabras <= 4 && /^(gracias|muchas gracias|mil gracias|gracias tiki|buenisimo gracias|genio|crack|grande|sos un genio)\b/.test(t)){
    return { html: `<p>${tikiUnaDe(['De nada.', '¡De nada!', 'Para eso estoy.'])} Cuando quieras, preguntame otra cosa.</p>` };
  }
  if(nPalabras <= 3 && /^(ok|okey|oka|dale|listo|joya|genial|buenisimo|barbaro|perfecto|ah|aha|ya|entiendo|entendi|ya veo|mira vos|uh|uf|uff|si|no)$/.test(t)){
    return { html: `<p>${tikiUnaDe(['Dale.', 'Joya.', 'Listo.'])} Si necesitás algo más, preguntame.</p>` };
  }
  if(nPalabras <= 5 && /^(como (estas|andas|te va|va)|todo bien|que tal)\b/.test(t)){
    return { html: `<p>${tikiUnaDe(['Bien, acá con tus números.', 'Todo bien, acá firme con la caja.'])}</p>`, sugerencia: { texto: '¿Querés que te cuente cómo viene el día?', pregunta: '¿Cuánto vendí hoy?' } };
  }
  if(nPalabras <= 5 && /^(hola|buen dia|buenos dias|buenas|buenas tardes|buenas noches|hey|hola tiki)\b/.test(t)){
    return { html: `<p>${tikiSaludo()}. ¿En qué te ayudo?</p>`, acciones: tikiEjemplos().slice(0, 3).map(q => ({ label: q, pregunta: q })) };
  }
  if(nPalabras <= 5 && /^(chau|chao|adios|nos vemos|hasta (manana|luego|despues|la proxima)|me voy|me fui)\b/.test(t)){
    const hoy = todayStr();
    if(tikiMovs(hoy, hoy).length && !cierreDeFecha(hoy) && new Date().getHours() >= 17){
      return { html: `<p>¡Chau! Antes de irte, acordate de cerrar la caja: tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(hoy))}</strong> en efectivo.</p>`, acciones: [{ label: 'Cerrar la caja de hoy', view: 'caja', fecha: hoy }] };
    }
    return { html: `<p>${tikiUnaDe(['¡Chau! Cualquier cosa, acá estoy.', '¡Nos vemos! Que venga bien la venta.'])}</p>` };
  }
  if(/\b(ayuda|quien sos|que sos|que (podes|sabes|puedo) (hacer|preguntar|preguntarte|responder)|que sabes|como funciona\w*)\b/.test(t)) return tikiAyuda();
  if(/\b(que|q) (hacemos|hago|hacer|tengo que hacer|hay que hacer|hay para hacer)\b|\bpendientes?\b|\btareas?\b|\bpor donde (arranco|empiezo)\b|\bplan del dia\b/.test(t)){
    return await tikiPlanDelDia();
  }
  if(/\b(stock|quedan?|quedo|reponer|repongo|reposicion|agot\w*|faltan?|pedir|comprar)\b/.test(t)){
    const m = prods();
    return m.length ? tikiStock(m) : tikiReponer(sobrantes);
  }
  if(/\b(debo|debemos|debes|deuda|deudas|adeudo|pagarle|pagarles|proveedor|proveedores)\b/.test(t)){
    const m = provs();
    return tikiDeudas(m.length ? m : null, m.length ? null : sobrantes);
  }
  if(/\befectivo\b/.test(t) && /\b(tengo|tendria|deberia|hay|haber|tendriamos)\b/.test(t)){
    tikiSeguir = tikiCierre;
    return tikiCierre(periodo || tikiPeriodo('hoy'));
  }
  if(/\b(cierre|cierres|cerre|cerramos|cerrar|cerro|arqueo|faltante|sobrante|faltaron|sobraron|caja)\b/.test(t)) return seguir(tikiCierre);
  if(/\b(que|cual|en que) dia\b|\bdias? de la semana\b|\bmejor dia\b|\bdias? (mas )?(flojo|fuerte)s?\b/.test(t)) return tikiMejorDia();
  if(/\b(que|a que|cual) hora\b|\bhorarios?\b|\bhora pico\b/.test(t)) return seguir(tikiMejorHora);
  if(/\b(precio|precios|margen|costo|a cuanto)\b|\bcuanto (sale|cuesta|vale|me deja|deja)\b/.test(t)){
    const m = prods();
    if(m.length === 1) return tikiProducto(m[0]);
    if(m.length > 1) return tikiVariosProductos(m);
  }
  // Rentabilidad cruzada (van antes del ranking simple).
  if(/\bdonde (estoy )?(pierdo|perdiendo|perd[ií])\b|\bpierdo plata\b|\bvend\w* a perdida\b|\bperdida\b|\ben que (estoy )?perd/.test(t)) return tikiDondePierdoPlata();
  if(/\b(vend\w*|sale|sal[ei]n)\b.{0,30}\b(poc[oa]|poquito)\b.{0,20}\bmargen\b|\bmucho\b.{0,20}\b(poc[oa] (ganancia|margen|rentab)|me deja poco|dejan poco)\b|\bmucha venta\b.{0,20}\bpoc[oa]\b|\b(vend\w*|sale) mucho (pero|y) (deja|rinde|me deja) poco\b/.test(t)) return tikiMuchoVendePocoMargen();
  if(/\b(buen|lindo|alto) margen\b.{0,30}\b(no (se )?(vend|muev|rot)|poca (rotacion|venta|salida)|casi no|parad|no rot)\w*|\b(no (se )?(vend\w*|mueve\w*|rota\w*)|parado\w*|poca rotacion)\b.{0,30}\b(buen|lindo|alto)? ?margen\b|\bbuen margen pero\b/.test(t)) return tikiBuenMargenPocaRotacion();
  if(/\b(que|cual) (producto|cosa)?.{0,20}\b(deja|rinde) menos\b|\b(peor|menor) margen\b|\bmenos (ganancia|margen|rentab\w*)\b|\bmenos me deja\b/.test(t)) return seguir(p => tikiTopProductos(p, 'ganancia', false, 5, true));
  const menos = /\bmenos vend\w*|\bno (se )?(vend\w*|mueve\w*)\b|\bparados?\b|\bclavados?\b/.test(t);
  if(menos || /\bmas (vend\w*|sale|salio|se vende|me deja|deja|ganancia|rentable|factur\w*)\b|\b(me )?deja(n)? mas\b|\bmejor(es)? productos?\b|\b(que|cual|cuales) (es el |son los )?productos?\b|\btop\b|\branking\b|\bque se vende\b/.test(t)){
    const criterio = /\b(deja|dejan|dejo|ganancia|ganancias|rentable|gano|ganar|margen)\b/.test(t) ? 'ganancia'
      : /\b(unidades|cantidad)\b/.test(t) ? 'cantidad' : 'monto';
    return seguir(p => tikiTopProductos(p, criterio, menos));
  }
  if(/\bque (hice|hicimos|habia hecho|habiamos hecho|paso|hizo|registre|cargue)\b|\bactividad\b|\bque movimientos\b/.test(t)) return seguir(tikiActividad);
  if(/\bcomo (vengo|voy|va|vamos|venimos|viene|vino|estoy|estamos|ando|andamos|esta el negocio|me fue|nos fue|fue|anduvo|anduvimos)\b|\bresumen\b|\bbalance\b|\bnumeros\b/.test(t)){
    if(periodo && !periodo.mes) return seguir(p => tikiVentas(p, 'ventas'));
    tikiSeguir = (p) => tikiVentas(p, 'ventas');
    return tikiComoVengo();
  }
  if(/\b(gaste|gastamos|gasto|gastos|gastado|egresos?|pague|pagamos|pagado|pagar)\b/.test(t)) return seguir(p => tikiGastos(p, claves));
  if(/\b(vendi|vendimos|vendio|vendiste|vende|vendo|venta|ventas|vendido|facture|facturamos|facturado|facturacion|recaude|recaudamos|recaudado|recaudacion|gane|ganamos|ganancia|ganancias|ganado|deja|dejo|ingreso|ingresos|hice|hicimos|saque|sacamos|entro|entraron|plata)\b/.test(t)){
    const nombres = tikiBuscar(claves, tikiNombresVendidos(), n => n);
    if(nombres.length) return seguir(p => tikiVentasProducto(nombres, p));
    const foco = /\b(gane|ganamos|ganancia|ganancias|ganado|deja|dejo)\b/.test(t) ? 'ganancia' : 'ventas';
    return seguir(p => tikiVentas(p, foco));
  }
  // Sin palabra clave: si nombra algo conocido, respondo sobre eso.
  const m = prods();
  if(m.length === 1) return tikiProducto(m[0]);
  if(m.length > 1) return tikiVariosProductos(m);
  const pv = provs();
  if(pv.length) return tikiDeudas(pv);
  if(periodo) return tikiSeguir ? tikiSeguir(periodo) : tikiAclararPeriodo(periodo);
  return tikiNoEntendi();
}

// ---------- Pantalla ----------
function openTikiView(){
  renderTikiSabe();
  tikiCargarMemoria();
  if(!tikiIniciado){
    tikiIniciado = true;
    tikiArrancar();
  }
  // En mobile no: abrir el teclado solo tapa la mitad del chat.
  if(window.matchMedia('(min-width:900px)').matches) document.getElementById('tikiInput').focus({ preventScroll: true });
}
function resetTiki(){
  tikiGen++;
  tikiIniciado = false;
  tikiOcupado = false;
  tikiSeguir = null;
  tikiCtx = null;
  tikiSugerencia = null;
  tikiManipSeguidas = 0;
  tikiPendiente = null;
  tikiMemoria = {};
  tikiMemoriaDe = null;
  tikiMemoriaCarga = null;
  document.getElementById('tikiMessages').innerHTML = '';
  document.getElementById('tikiInput').value = '';
  document.getElementById('tikiRecuerda').innerHTML = '';
}
function renderTikiSabe(){
  const primera = entries.reduce((m,e) => (e.fecha && (!m || e.fecha < m)) ? e.fecha : m, null);
  const desde = primera ? `${TIKI_MESES[tikiParse(primera).getMonth()].slice(0, 3)} ${primera.slice(0, 4)}` : '—';
  const filas = [
    ['Ventas y gastos', entries.length.toLocaleString('es-AR')],
    ['Cargados desde', desde],
    ['Productos', products.length.toLocaleString('es-AR')],
    ['Proveedores', proveedores.length.toLocaleString('es-AR')],
    ['Cierres de caja', cierresCaja.length.toLocaleString('es-AR')]
  ];
  document.getElementById('tikiSabe').innerHTML = filas.map(([k,v]) => `<li><span>${k}</span><strong>${v}</strong></li>`).join('');
  const claves = TIKI_MEMORIA_CLAVES.filter(c => tikiRecuerda(c));
  const lista = document.getElementById('tikiRecuerda');
  lista.innerHTML = claves.length
    ? claves.map(c => `<li><span>Que ${tikiTextoMemoria(c, tikiRecuerda(c))}</span><button type="button" class="tiki-olvidar" data-clave="${c}">Olvidar</button></li>`).join('')
    : '<li class="tiki-recuerda-vacio">Nada todavía. Contale tu horario de cierre, qué días no abrís o tu meta de ventas, y te pregunta antes de guardarlo.</li>';
  lista.querySelectorAll('.tiki-olvidar').forEach(b => b.addEventListener('click', () => {
    const c = b.dataset.clave;
    tikiAccionMemoria({ label: `Olvidate de que ${tikiTextoMemoria(c, tikiRecuerda(c))}`, olvidar: [c] });
  }));
}
function tikiEsperar(ms){ return new Promise(res => setTimeout(res, ms)); }
function tikiAgregarMensaje(rol, contenido){
  const wrap = document.getElementById('tikiMessages');
  const row = document.createElement('div');
  row.className = 'tiki-row' + (rol === 'user' ? ' tiki-row-user' : '');
  if(rol === 'user'){
    const msg = document.createElement('div');
    msg.className = 'tiki-msg tiki-msg-user';
    msg.textContent = contenido;
    row.appendChild(msg);
  } else {
    const acciones = contenido.acciones || [];
    row.innerHTML = `<div class="tiki-avatar" aria-hidden="true">${TIKI_ICON}</div>
      <div class="tiki-msg tiki-msg-tiki tiki-entra">${contenido.html}${acciones.length ? `<div class="tiki-actions">${acciones.map((a,i) => `<button type="button" class="tiki-action" data-i="${i}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}</div>`;
    row.querySelectorAll('.tiki-action').forEach(btn => btn.addEventListener('click', () => {
      const a = acciones[Number(btn.dataset.i)];
      // Guardar/olvidar se puede tocar una sola vez por mensaje: sin esto,
      // dos toques rapidos guardaban dos veces o "Si" y "No" a la vez.
      if(a.guardar || a.descartar || a.olvidar){
        if(tikiOcupado) return;
        row.querySelectorAll('.tiki-action').forEach(b => { b.disabled = true; });
      }
      tikiAccion(a);
    }));
  }
  wrap.appendChild(row);
  // Una charla larga no crece sin limite en pantalla (ni en memoria).
  while(wrap.children.length > 80) wrap.removeChild(wrap.firstChild);
  // Una respuesta larga se muestra desde su comienzo, no desde el final
  // (si no, lo primero que se ve es la ultima linea).
  const alFinal = wrap.scrollHeight - wrap.clientHeight;
  wrap.scrollTop = rol === 'user' ? alFinal : Math.min(row.offsetTop - 16, alFinal);
}
function tikiMostrarEscribiendo(){
  const wrap = document.getElementById('tikiMessages');
  const row = document.createElement('div');
  row.className = 'tiki-row';
  row.innerHTML = `<div class="tiki-avatar" aria-hidden="true">${TIKI_ICON}</div><div class="tiki-msg tiki-msg-tiki tiki-typing" role="status" aria-label="Tiki está escribiendo"><span></span><span></span><span></span></div>`;
  wrap.appendChild(row);
  wrap.scrollTop = wrap.scrollHeight;
  return row;
}
function tikiAccion(a){
  if(!a) return;
  if(a.pregunta){ tikiPreguntar(a.pregunta); return; }
  if(a.guardar || a.descartar || a.olvidar){ tikiAccionMemoria(a); return; }
  if(a.view === 'caja' && a.fecha) cierreCajaFechaActiva = a.fecha;
  switchView(a.view);
  if(a.view === 'catalogo') setCatalogoTab(a.tab || 'productos');
  if(a.view === 'cargar' && a.tipo) setTipo(a.tipo);
}
// Una pausa corta antes de cada respuesta: sin ella la respuesta aparece
// en el mismo instante que la pregunta y cuesta darse cuenta de que es nueva.
async function tikiConPausa(fn){
  const gen = tikiGen;
  const typing = tikiMostrarEscribiendo();
  const inicio = Date.now();
  let r;
  try{ r = await fn(); }
  catch(err){
    console.error(err);
    r = { html: '<p>Uy, algo falló haciendo esa cuenta. Probá preguntarlo de otra forma.</p>' };
  }
  // Una respuesta larga "tarda" un poco mas en escribirse que una corta,
  // como en una charla de verdad (pero nunca mas de un segundo).
  const largo = String((r && r.html) || '').replace(/<[^>]+>/g, '').length;
  const resto = Math.min(950, 350 + largo * 1.5) - (Date.now() - inicio);
  if(resto > 0) await tikiEsperar(resto);
  if(gen !== tikiGen) return;
  typing.remove();
  tikiAgregarMensaje('tiki', r);
}
async function tikiAccionMemoria(a){
  if(tikiOcupado) return;
  tikiOcupado = true;
  const gen = tikiGen;
  tikiPendiente = null;
  tikiAgregarMensaje('user', a.label);
  await tikiConPausa(async () => {
    if(a.guardar) return tikiConfirmarGuardado(a.guardar.clave, a.guardar.valor);
    if(a.olvidar){
      const ok = await tikiOlvidar(a.olvidar);
      return { html: ok ? '<p>Listo, ya me olvidé.</p>' : '<p>No pude borrarlo ahora (puede ser la conexión). Probá de nuevo en un rato.</p>' };
    }
    return { html: '<p>Listo, no guardo nada.</p>' };
  });
  if(gen === tikiGen) tikiOcupado = false;
}
async function tikiArrancar(){
  tikiOcupado = true;
  const gen = tikiGen;
  tikiAgregarMensaje('tiki', { html: `<p>${tikiSaludo()}. Soy Tiki: te ayudo con los números del negocio usando lo que cargás en Tikera.</p>` });
  await tikiConPausa(async () => { await tikiCargarMemoria(); return (!entries.length && !products.length)
    ? { html: '<p>Todavía no cargaste ventas ni productos, así que no tengo mucho para contarte. Cuando cargues tus primeras ventas, te voy a poder decir cómo venís.</p>', acciones: [{ label: 'Cargar una venta', view: 'cargar' }] }
    : tikiPlanDelDia(); });
  if(gen === tikiGen) tikiOcupado = false;
}
async function tikiPreguntar(texto){
  if(tikiOcupado) return;
  tikiOcupado = true;
  const gen = tikiGen;
  tikiAgregarMensaje('user', texto);
  await tikiConPausa(() => tikiResponder(texto));
  if(gen === tikiGen) tikiOcupado = false;
}
document.getElementById('tikiForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('tikiInput');
  const texto = input.value.trim();
  if(!texto || tikiOcupado) return;
  input.value = '';
  tikiPreguntar(texto);
});
document.getElementById('tikiChips').innerHTML = TIKI_CHIPS.map((q,i) => `<button type="button" class="tiki-chip" data-i="${i}">${escapeHtml(q)}</button>`).join('');
document.querySelectorAll('#tikiChips .tiki-chip').forEach(b => b.addEventListener('click', () => tikiPreguntar(TIKI_CHIPS[Number(b.dataset.i)])));
