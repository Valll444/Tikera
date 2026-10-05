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
    acciones: acciones.slice(0, 3)
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
    return { html: `<p>${tikiCap(label)} todavía no cerraste la caja. Según lo cargado, tendría que haber <strong>${tikiPlata(efectivoEsperadoDe(fecha))}</strong> en efectivo.${vendido}</p>`, acciones: [irACaja(fecha)] };
  }

  const dif = Number(c.diferencia) || 0;
  const resultado = Math.abs(dif) < 1 ? '<span class="tiki-pos">dio justo</span>'
    : dif < 0 ? `<span class="tiki-neg">faltaron ${tikiPlata(-dif)}</span>`
    : `<strong>sobraron ${tikiPlata(dif)}</strong>`;
  let html = `<p>${tikiCap(label)} esperabas <strong>${tikiPlata(c.efectivo_esperado)}</strong> en efectivo y contaste <strong>${tikiPlata(c.efectivo_contado)}</strong>: ${resultado}.</p>`;
  if(dif >= 1) html += '<p class="tiki-soft">Cuando sobra plata, muchas veces es una venta que no se cargó.</p>';
  if(c.notas) html += `<p class="tiki-soft">Anotaste: “${escapeHtml(c.notas)}”</p>`;

  const r = tikiResumen(fecha, fecha);
  if(r.cantVentas){
    html += `<p>Ese día vendiste <strong>${tikiPlata(r.ventas)}</strong> en ${r.cantVentas} ${r.cantVentas === 1 ? 'venta' : 'ventas'}${r.gastos ? `, gastaste ${tikiPlata(r.gastos)}` : ''} y la ganancia real fue de <strong>${tikiPlata(r.ganancia)}</strong>.`;
    const ant = tikiSumarDias(fecha, -7);
    const v = tikiVariacion(r.ventas, tikiResumen(ant, ant).ventas);
    if(v) html += ` Vendiste ${v} el ${tikiDiaSemana(ant)} anterior.`;
    html += '</p>';
  }

  const acciones = [];
  const ultimos = ordenados.filter(x => x.fecha <= fecha).slice(0, 7);
  const faltantes = ultimos.filter(x => (Number(x.diferencia) || 0) <= -1).length;
  const avisoFaltantes = dif <= -1 && faltantes >= 3;
  if(avisoFaltantes){
    html += `<p>Ojo: es el faltante número ${faltantes} en tus últimos ${ultimos.length} cierres. Conviene revisar si quedan ventas sin cargar o cómo se está dando el vuelto.</p>`;
  }
  if(!periodo){
    const ayer = tikiSumarDias(hoy, -1);
    if(fecha < ayer && tikiMovs(ayer, ayer).length && !cierreDeFecha(ayer)){
      html += `<p>${avisoFaltantes ? 'Además, la' : 'Ojo: la'} caja de ayer todavía no la cerraste.</p>`;
      acciones.push(irACaja(ayer));
    }
  }
  return { html, acciones };
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
      acciones: accion
    };
  }
  const aviso = sobrantes && sobrantes.length ? `<p class="tiki-soft">No encontré a «${escapeHtml(sobrantes.join(' '))}» entre tus proveedores, así que te paso todos.</p>` : '';
  if(!lista.length) return { html: `${aviso}<p>No le debés nada a ningún proveedor: todos los pedidos están pagados.</p>`, acciones: accion };
  const total = lista.reduce((s,d) => s + d.total, 0);
  return {
    html: `${aviso}<p>En total le debés <strong>${tikiPlata(total)}</strong> a ${lista.length === 1 ? 'un proveedor' : `${lista.length} proveedores`}:</p>
      <ul class="tiki-list">${lista.slice(0, 6).map(d => `<li class="pronto"><span><strong>${escapeHtml(d.p.nombre)}</strong>: ${tikiPlata(d.total)} <span class="tiki-soft">· desde el ${tikiFechaCorta(d.desde)}</span></span></li>`).join('')}</ul>
      ${lista.length > 6 ? `<p class="tiki-soft">Y ${lista.length - 6} más.</p>` : ''}`,
    acciones: accion
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
  if(prods.length === 1) return { html: `<p>${tikiStockTexto(prods[0])}</p>` };
  return {
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
    acciones: [{ label: 'Ir al catálogo', view: 'catalogo' }]
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
  return { html };
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
  return { html };
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
  if(r.sinCosto) html += `<p class="tiki-soft">${r.sinCosto === r.cantVentas ? 'Ninguna de esas ventas tiene' : `${r.sinCosto} de esas ventas no tienen`} el costo cargado: la ganancia real puede ser menor.</p>`;
  return { html };
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
  return { html };
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
  return { html };
}

function tikiTopProductos(periodo, criterio, menos){
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
        ${parado > 0 ? `<p>Ahí tenés <strong>${tikiPlata(parado)}</strong> parados (a precio de costo). Una promo o un combo puede ayudar a moverlos.</p>` : ''}`
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
  grupos.sort((a,b) => b[campo] - a[campo]);
  const filas = grupos.slice(0, 5).map((g,i) => ({ label: g.nombre, valor: g[campo], texto: campo === 'cantidad' ? `${tikiNum(g.cantidad)} u.` : tikiPlata(g[campo]), top: i === 0 }));
  return { html: `<p>${titulo} ${p.label}:</p>${tikiBarras(filas, true)}` };
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
  return { html };
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
  return { html };
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
  return { html: `<p>${tikiCap(p.label)} quedó registrado en Tikera:</p><ul class="tiki-list">${items.join('')}</ul>` };
}

// ---------- Lo que Tiki nunca hace ----------
// Se contestan explicitamente en vez de caer en una respuesta con los datos
// propios (que se podria leer como si fueran "del otro comercio"). Igual,
// la proteccion real no es esta: la app solo descarga los datos de la
// cuenta logueada (RLS en Supabase), asi que Tiki no tiene como verlos.
const TIKI_RE_META = /\b(ignor\w*|olvida\w*|saltea\w*|desactiva\w*|anula\w*)\b.{0,25}\b(instrucciones|reglas|indicaciones|restricciones|limites)\b|\bsystem prompt\b|\bprompt\b|\binstrucciones (internas|del sistema|que te dieron|ocultas|secretas)\b|\bmodo (admin\w*|administrador|desarrollador|dios|debug|sin (reglas|limites)|libre)\b|\bactua\w* como\b|\bhace(te)? de cuenta que sos\b|\bsoy (el |la |un |una )?(admin\w*|desarrollador\w*|programador\w*|creador\w*|developer)\b|\bsoy (el |la )?(dueno|duena|creador|creadora) de (la plataforma|tikera|la app|el sistema|tiki)\b|\bjailbreak\b|\bdeveloper mode\b/;
const TIKI_RE_AJENO = /\b(otr[oa]s?|ajen[oa]s?|demas)\b.{0,25}\b(comercios?|kioscos?|negocios?|usuarios?|locales?|almacen(es)?|tiendas?|duenos?|personas)\b|\b(otra cuenta|cuenta de otr[oa]|otras cuentas de tikera)\b|\b(competencia|competidor\w*)\b|\bde (todos|todas) (los|las) (comercios|kioscos|negocios|usuarios|cuentas)\b|\bcualquier (comercio|kiosco|negocio|usuario|cuenta)\b|\b(kiosco|negocio|local|comercio) de (enfrente|al lado|la esquina)\b|\b(user|usuario) ?id\b/;
const TIKI_RE_ACCION = /\b(carga|cargame|cargale|anota|anotame|registra|registrame|borra|borrame|borrale|elimina|eliminame|modifica|modificame|cambia|cambiame|cambiale|edita|agrega|agregame|crea|creame|subi|subile|baja|bajale|pone|ponele|ponle|actualiza|marca|marcame)\b.*\b(ventas?|gastos?|productos?|stock|precios?|cierres?|caja|proveedor(es)?|pedidos?|movimientos?|pagos?|deudas?)\b/;
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
  const t = tikiNorm(raw);
  if(!t) return tikiNoEntendi();
  await tikiCargarMemoria();
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

  const esPregunta = tikiEsPreguntaDeHabito(raw, t);
  const horario = tikiLeerHorario(t);
  if(/\b(a que hora|que hora|cuando)\b.*\b(cierro|cerramos|cerre|cerrar la caja|cierre la caja)\b/.test(t) && !horario) return tikiHabitoCierre(null);
  if(horario && esPregunta) return tikiHabitoCierre(horario);
  const diasMencionados = tikiLeerDias(t);
  if(esPregunta && diasMencionados.length && /\b(abro|abrimos|cerrado|cerramos|trabajo|trabajamos)\b/.test(t)) return tikiHabitoDias(diasMencionados);
  const mem = tikiMemoriaResponder(raw, t);
  if(mem) return mem;
  if(TIKI_RE_ACCION.test(t)) return tikiFueraDeAlcance('accion', t);

  if(nPalabras <= 4 && /^(gracias|muchas gracias|genial|joya|buenisimo|barbaro|dale|ok|okey|perfecto|listo|buenisimo gracias)\b/.test(t)){
    return { html: '<p>De nada. Cuando quieras, preguntame otra cosa.</p>' };
  }
  if(nPalabras <= 5 && /^(hola|buen dia|buenos dias|buenas|buenas tardes|buenas noches|que tal|como andas|como estas|hey)\b/.test(t)){
    return { html: `<p>${tikiSaludo()}. ¿En qué te ayudo?</p>`, acciones: tikiEjemplos().slice(0, 3).map(q => ({ label: q, pregunta: q })) };
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
  if(periodo) return tikiSeguir ? tikiSeguir(periodo) : tikiVentas(periodo, 'ventas');
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
      <div class="tiki-msg tiki-msg-tiki">${contenido.html}${acciones.length ? `<div class="tiki-actions">${acciones.map((a,i) => `<button type="button" class="tiki-action" data-i="${i}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}</div>`;
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
  const resto = 380 - (Date.now() - inicio);
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
