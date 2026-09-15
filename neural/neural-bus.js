/* Tikera Neural Activity — Event Bus
 * Bus de eventos minimo (pub/sub) que desacopla los eventos reales de la app
 * (ventas, gastos, sync con Supabase) del motor de visualizacion.
 * Sin dependencias externas.
 */
(function(){
  'use strict';

  var listeners = Object.create(null);

  function on(type, handler){
    if(!listeners[type]) listeners[type] = [];
    listeners[type].push(handler);
    return function off(){
      var arr = listeners[type];
      if(!arr) return;
      var idx = arr.indexOf(handler);
      if(idx !== -1) arr.splice(idx, 1);
    };
  }

  function off(type, handler){
    var arr = listeners[type];
    if(!arr) return;
    var idx = arr.indexOf(handler);
    if(idx !== -1) arr.splice(idx, 1);
  }

  function emit(type, payload){
    var arr = listeners[type];
    if(!arr || arr.length === 0) return;
    // Copia para que un handler que se desuscribe a si mismo no rompa el loop.
    arr.slice().forEach(function(handler){
      try{
        handler(payload, type);
      }catch(err){
        // Un error en el motor de visualizacion nunca debe afectar a Tikera.
        console.error('[TikeraNeural] handler error for', type, err);
      }
    });
  }

  window.TikeraBus = { on: on, off: off, emit: emit };
})();
