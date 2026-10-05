// Kiosco de prueba determinista, con filas en la misma forma en que las
// devuelve Supabase (snake_case). Lo usan los tests y tambien sirve para
// probar la app a mano en el navegador sin una cuenta real:
//   const { generarKiosco } = await import('/tests/fixtures/kiosco.mjs');
//   const k = generarKiosco({ hoy: todayStr(), userId: 'demo' });
//   entries = k.movements.map(mapRowToEntry); products = k.products; ...

const PRODUCTOS = [
  { nombre: 'Coca Cola 500ml', precio_venta: 1800, costo_unitario: 1100, stock_actual: 6, stock_minimo: 12, categoria: 'Bebidas', peso: 9 },
  { nombre: 'Coca Cola 1.5L', precio_venta: 3200, costo_unitario: 2100, stock_actual: 14, stock_minimo: 6, categoria: 'Bebidas', peso: 5 },
  { nombre: 'Agua Villavicencio 500ml', precio_venta: 1200, costo_unitario: 650, stock_actual: 30, stock_minimo: 10, categoria: 'Bebidas', peso: 6 },
  { nombre: 'Alfajor Jorgito', precio_venta: 900, costo_unitario: 520, stock_actual: 4, stock_minimo: 10, categoria: 'Golosinas', peso: 8 },
  { nombre: 'Alfajor Guaymallén', precio_venta: 500, costo_unitario: 280, stock_actual: 40, stock_minimo: 15, categoria: 'Golosinas', peso: 6 },
  { nombre: 'Marlboro Box 20', precio_venta: 4200, costo_unitario: 3700, stock_actual: 18, stock_minimo: 10, categoria: 'Cigarrillos', peso: 7 },
  { nombre: 'Chicles Beldent', precio_venta: 700, costo_unitario: 390, stock_actual: 25, stock_minimo: null, categoria: 'Golosinas', peso: 4 },
  { nombre: 'Galletitas Oreo', precio_venta: 1500, costo_unitario: 980, stock_actual: 9, stock_minimo: 5, categoria: 'Almacén', peso: 3 },
  { nombre: 'Turrón Arcor', precio_venta: 400, costo_unitario: null, stock_actual: 22, stock_minimo: null, categoria: 'Golosinas', peso: 3 },
  { nombre: 'Cerveza Quilmes 1L', precio_venta: 2900, costo_unitario: 3000, stock_actual: 12, stock_minimo: 6, categoria: 'Bebidas', peso: 4 },
  { nombre: 'Pilas Duracell AA', precio_venta: 3500, costo_unitario: 2200, stock_actual: 15, stock_minimo: null, categoria: 'Varios', peso: 0 },
  { nombre: 'Caramelos Sugus', precio_venta: 150, costo_unitario: 70, stock_actual: 120, stock_minimo: null, categoria: 'Golosinas', peso: 2 }
];

function fecha(d){
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(f){ const [y, m, d] = f.split('-').map(Number); return new Date(y, m - 1, d); }
function sumar(f, n){ const d = parse(f); d.setDate(d.getDate() + n); return fecha(d); }
function uuid(n, pref){ return `${pref}${String(n).padStart(12, '0')}`; }

/**
 * @param {object} o
 * @param {string} o.hoy        fecha "YYYY-MM-DD" que se toma como hoy
 * @param {number} [o.horaActual=23] hasta que hora de hoy hay ventas
 * @param {string} o.userId
 * @param {number} [o.dias=60]  dias de historial
 * @param {number} [o.seed=7]
 * @param {string} [o.prefijo]  prefijo de ids (para que dos cuentas no compartan ids)
 */
export function generarKiosco({ hoy, horaActual = 23, userId, dias = 60, seed = 7, prefijo = 'aaaaaaaa-0000-0000-0000-' }){
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = (arr, w) => { let t = w.reduce((a, b) => a + b, 0) * rnd(); for(let i = 0; i < arr.length; i++){ t -= w[i]; if(t <= 0) return arr[i]; } return arr[arr.length - 1]; };
  const mult = [0.8, 0.6, 0.8, 0.9, 1.0, 1.3, 1.5];
  const horas = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const hPeso = [2, 3, 3, 4, 6, 6, 3, 3, 4, 6, 9, 9, 7, 4, 2];
  let id = 1;
  const created = (f, h, m) => { const d = parse(f); d.setHours(h, m, 0, 0); return d.toISOString(); };

  const products = PRODUCTOS.map((p, i) => {
    const { peso, ...resto } = p;
    return { id: 1000 + i, user_id: userId, ...resto, created_at: created(sumar(hoy, -(dias + 5)), 9, 0) };
  });
  const movements = [];
  for(let back = dias; back >= 0; back--){
    const f = sumar(hoy, -back);
    const n = Math.round(22 * mult[parse(f).getDay()] * (0.85 + rnd() * 0.3));
    for(let i = 0; i < n; i++){
      const h = pick(horas, hPeso);
      const min = Math.floor(rnd() * 60);
      if(back === 0 && h > horaActual) continue;
      const libre = rnd() < 0.06;
      const p = libre ? null : pick(PRODUCTOS, PRODUCTOS.map(x => x.peso));
      const cant = libre ? 1 : (rnd() < 0.7 ? 1 : rnd() < 0.7 ? 2 : 3);
      const monto = libre ? 1000 + Math.round(rnd() * 4) * 500 : p.precio_venta * cant;
      const costo = !libre && p.costo_unitario ? p.costo_unitario * cant : null;
      movements.push({
        id: uuid(id++, prefijo), user_id: userId, fecha: f, hora: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        tipo: 'Venta', descripcion: libre ? 'Carga SUBE' : p.nombre, cantidad: cant,
        precio_unitario: libre ? monto : p.precio_venta, costo_unitario: libre ? null : p.costo_unitario,
        costo_total: costo, ganancia: costo !== null ? monto - costo : null, monto,
        metodo_pago: pick(['Efectivo', 'Transferencia', 'Tarjeta', 'QR'], [55, 25, 15, 5]), nota: null,
        categoria: null, proveedor_id: null, es_fijo: false, created_at: created(f, h, min)
      });
    }
  }
  const gasto = (f, descripcion, monto, categoria, es_fijo, metodo_pago = 'Transferencia', proveedor_id = null) => movements.push({
    id: uuid(id++, prefijo), user_id: userId, fecha: f, hora: '09:15', tipo: 'Gasto', descripcion, cantidad: null,
    precio_unitario: null, costo_unitario: null, costo_total: null, ganancia: null, monto, metodo_pago, nota: null,
    categoria, proveedor_id, es_fijo, created_at: created(f, 9, 15)
  });
  const d = parse(hoy);
  for(let m = 2; m >= 1; m--){
    const ym = (dia) => fecha(new Date(d.getFullYear(), d.getMonth() - m, dia));
    gasto(ym(1), 'Sueldo Juan', 250000, 'Sueldos', true);
    gasto(ym(5), 'Alquiler', 180000, 'Alquiler', true);
    gasto(ym(10), 'Luz', 32000 + m * 1500, 'Servicios', true);
    gasto(ym(12), 'Internet', 15000, 'Servicios', true);
    gasto(ym(20), 'Monotributo', 41000, 'Impuestos', true);
    [3, 10, 17, 24].forEach(dd => gasto(ym(dd), 'Mercadería Arcor', 55000 + Math.round(rnd() * 20000), 'Mercadería', false, 'Efectivo', 1));
  }
  gasto(fecha(new Date(d.getFullYear(), d.getMonth(), 2)) <= hoy ? fecha(new Date(d.getFullYear(), d.getMonth(), 2)) : sumar(hoy, -1), 'Mercadería Coca-Cola', 88000, 'Mercadería', false, 'Transferencia', 2);
  gasto(sumar(hoy, -1), 'Bolsas y servilletas', 6500, 'Otro', false, 'Efectivo');
  movements.sort((a, b) => a.created_at.localeCompare(b.created_at));

  const proveedores = [
    { id: 1, user_id: userId, nombre: 'Arcor', contacto: '11 5555-0001', notas: null },
    { id: 2, user_id: userId, nombre: 'Coca-Cola FEMSA', contacto: null, notas: null },
    { id: 3, user_id: userId, nombre: 'Distribuidora El Sol', contacto: null, notas: null }
  ];
  const pedidos_proveedor = [
    { id: 1, user_id: userId, proveedor_id: 1, fecha: sumar(hoy, -14), descripcion: 'Golosinas surtidas', cantidad: null, monto: 45000, pagado: false },
    { id: 2, user_id: userId, proveedor_id: 1, fecha: sumar(hoy, -6), descripcion: 'Alfajores', cantidad: null, monto: 38000, pagado: false },
    { id: 3, user_id: userId, proveedor_id: 2, fecha: sumar(hoy, -3), descripcion: 'Gaseosas', cantidad: null, monto: 92000, pagado: false },
    { id: 4, user_id: userId, proveedor_id: 3, fecha: sumar(hoy, -10), descripcion: 'Varios', cantidad: null, monto: 20000, pagado: true }
  ];

  // Cierres de los ultimos 30 dias (menos anteayer-7 y ayer, que quedan sin
  // cerrar), casi todos guardados el mismo dia cerca de las 20:00.
  const efectivoEsperado = (f) => movements.filter(m => m.fecha === f && m.metodo_pago === 'Efectivo')
    .reduce((acc, m) => acc + (m.tipo === 'Venta' ? m.monto : -m.monto), 0);
  const difs = { 2: -1200, 4: -500, 6: -800, 11: 300, 15: -200 };
  const cierres_caja = [];
  for(let back = 30; back >= 2; back--){
    if(back === 9) continue;
    const f = sumar(hoy, -back);
    const esperado = efectivoEsperado(f);
    const dif = difs[back] || 0;
    // dos cierres cargados al dia siguiente: no cuentan para el horario
    const tarde = back === 20 || back === 21;
    const minutos = 20 * 60 + Math.round((rnd() - 0.5) * 50);
    cierres_caja.push({
      id: 500 + back, user_id: userId, fecha: f, efectivo_esperado: esperado, efectivo_contado: esperado + dif, diferencia: dif,
      notas: back === 2 ? 'Faltó vuelto, revisar con Juan' : null,
      created_at: tarde ? created(sumar(f, 1), 10, 0) : created(f, Math.floor(minutos / 60), minutos % 60)
    });
  }
  cierres_caja.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return { movements, products, proveedores, pedidos_proveedor, cierres_caja };
}
