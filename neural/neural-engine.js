/* Tikera Neural Activity — Neural Engine
 *
 * Mantiene el estado de la red (nodos, conexiones, pulsos) y traduce eventos
 * reales de Tikera (ventas, gastos, catalogo, sync, analytics) en actividad
 * visual. No calcula nada de negocio: solo escucha lo que ya calculo la app
 * y lo representa.
 *
 * IMPORTANTE: "AI CORE" y el estado LEARNING son una capa de simulacion /
 * visualizacion de procesamiento. Tikera todavia no entrena ningun modelo
 * real — ver disclaimer en NEURAL_ACTIVITY.md. El nodo "forecast" queda
 * reservado (nunca se activa) para cuando exista un modelo predictivo real.
 */
(function(){
  'use strict';

  var STATES = ['IDLE','PROCESSING','ACTIVE','WARNING','SUCCESS','ERROR','LEARNING'];
  var STATE_TTL_MS = 1300; // tiempo antes de volver a IDLE si no hay nueva actividad

  // ---- Topologia de la red (posiciones normalizadas 0..1) -----------------
  var NODES = [
    { id:'sales',      label:'VENTAS',       layer:'input',    category:'sales',     x:0.20, y:0.11 },
    { id:'expenses',   label:'GASTOS',       layer:'input',    category:'expenses',  x:0.50, y:0.09 },
    { id:'frequent',   label:'CATALOGO',     layer:'input',    category:'catalog',   x:0.80, y:0.11 },
    { id:'dataInput',  label:'DATA INPUT',   layer:'data',     category:'system',    x:0.50, y:0.27 },
    { id:'processing', label:'PROCESSING',   layer:'process',  category:'system',    x:0.50, y:0.43 },
    { id:'analytics',  label:'ANALYTICS',    layer:'analysis', category:'analytics', x:0.32, y:0.59 },
    { id:'patterns',   label:'PATTERNS',     layer:'analysis', category:'analytics', x:0.68, y:0.59 },
    { id:'aiCore',     label:'AI CORE',      layer:'core',     category:'ai',        x:0.50, y:0.75, core:true },
    { id:'insight',    label:'INSIGHT',      layer:'output',   category:'ai',        x:0.20, y:0.90 },
    { id:'sync',       label:'SYNC',         layer:'output',   category:'system',    x:0.44, y:0.93 },
    { id:'forecast',   label:'FORECAST',     layer:'output',   category:'ai',        x:0.68, y:0.90, reserved:true },
    { id:'tikera',     label:'TIKERA',       layer:'root',     category:'system',    x:0.50, y:1.0, brand:true }
  ];

  var EDGES = [
    ['sales','dataInput'], ['expenses','dataInput'], ['frequent','dataInput'],
    ['dataInput','processing'],
    ['processing','analytics'], ['processing','patterns'],
    ['analytics','aiCore'], ['patterns','aiCore'],
    ['aiCore','insight'], ['aiCore','sync'], ['aiCore','forecast'],
    ['insight','tikera'], ['sync','tikera'], ['forecast','tikera']
  ];

  var NODE_LABELS = {
    sales:'Ventas', expenses:'Gastos', frequent:'Catalogo', dataInput:'Data Input',
    processing:'Processing', analytics:'Analytics', patterns:'Patterns',
    aiCore:'AI Core', insight:'Insight', sync:'Sync', forecast:'Forecast',
    tikera:'Tikera'
  };

  function now(){ return performance.now(); }

  function makeNode(def){
    return {
      id: def.id, label: def.label, layer: def.layer, category: def.category,
      x: def.x, y: def.y, core: !!def.core, reserved: !!def.reserved, brand: !!def.brand,
      state: 'IDLE', stateUntil: 0,
      activity: 0, baseline: 0,
      eventCount: 0, lastEventType: null, lastEventAt: 0,
      recentTimestamps: []
    };
  }

  function makeEdge(from, to){
    var reserved = (from === 'aiCore' && to === 'forecast') || (from === 'forecast' && to === 'tikera');
    return {
      id: from + '->' + to, from: from, to: to,
      weight: reserved ? 0 : 0.45,
      activity: 0, activityUntil: 0,
      reserved: reserved
    };
  }

  function NeuralEngine(){
    this.nodes = NODES.map(makeNode);
    this.nodesById = {};
    var self = this;
    this.nodes.forEach(function(n){ self.nodesById[n.id] = n; });
    this.edges = EDGES.map(function(pair){ return makeEdge(pair[0], pair[1]); });
    this.edgesById = {};
    this.edges.forEach(function(e){ self.edgesById[e.id] = e; });

    this.particles = []; // {edgeId, startedAt, duration, category, demo}
    this.eventLog = []; // bounded, mas reciente primero
    this.maxLog = 40;

    this.mode = 'live'; // 'live' | 'pause' | 'demo'
    this.filter = 'all';
    this.highlight = null; // {nodeIds:Set, edgeIds:Set, until}

    this.analyticsRunCount = 0;
    this.pipelineActiveUntil = 0;
    this.lastErrorAt = -Infinity; // ningun error todavia (0 quedaba "cerca" de now() recien arrancado)

    this._eventListeners = [];
    this._seq = 0;

    this._unsubscribers = [];
  }

  NeuralEngine.prototype.onEvent = function(cb){
    this._eventListeners.push(cb);
    var self = this;
    return function(){
      var i = self._eventListeners.indexOf(cb);
      if(i !== -1) self._eventListeners.splice(i,1);
    };
  };

  NeuralEngine.prototype._notify = function(evt){
    this._eventListeners.forEach(function(cb){
      try{ cb(evt); }catch(e){ console.error('[TikeraNeural] listener error', e); }
    });
  };

  // ---- Activacion de un pipeline (ruta de nodos) ---------------------------
  // steps: array de ids de nodo en orden. stateMap: id -> estado forzado (opcional).
  NeuralEngine.prototype._activatePath = function(steps, opts){
    opts = opts || {};
    var self = this;
    var t = now();
    var stepDelay = 130;
    var stateMap = opts.stateMap || {};
    var demo = !!opts.demo;

    steps.forEach(function(nodeId, idx){
      var node = self.nodesById[nodeId];
      if(!node || node.reserved) return;
      var delay = idx * stepDelay;
      var state = stateMap[nodeId] || (idx === steps.length - 1 ? 'SUCCESS' : (idx === 0 ? 'ACTIVE' : 'PROCESSING'));
      setTimeout(function(){
        self._setNodeState(node, state, t + delay);
      }, delay);

      if(idx > 0){
        var prev = steps[idx-1];
        var edge = self.edgesById[prev + '->' + nodeId];
        if(edge && !edge.reserved){
          setTimeout(function(){
            self._pulseEdge(edge, demo);
          }, Math.max(0, delay - stepDelay * 0.6));
        }
      }
    });

    if(opts.errorAt){
      var errNode = this.nodesById[opts.errorAt];
      var errIdx = steps.indexOf(opts.errorAt);
      var errDelay = Math.max(0, errIdx) * stepDelay + stepDelay;
      setTimeout(function(){
        if(errNode) self._setNodeState(errNode, 'ERROR', now());
        self.lastErrorAt = now();
      }, errDelay);
    }
  };

  NeuralEngine.prototype._setNodeState = function(node, state, ts){
    node.state = state;
    node.stateUntil = now() + STATE_TTL_MS;
    node.activity = 100;
    node.eventCount += 1;
    node.lastEventAt = ts || now();
    node.recentTimestamps.push(node.lastEventAt);
    if(node.recentTimestamps.length > 20) node.recentTimestamps.shift();
  };

  NeuralEngine.prototype._pulseEdge = function(edge, demo){
    edge.activity = 1;
    edge.activityUntil = now() + 900;
    this.particles.push({
      edgeId: edge.id, startedAt: now(), duration: 480 / (0.5 + edge.weight),
      demo: !!demo
    });
    if(this.particles.length > 60) this.particles.shift();
  };

  NeuralEngine.prototype._reinforce = function(edgeId, amount){
    var edge = this.edgesById[edgeId];
    if(!edge || edge.reserved) return;
    edge.weight = Math.max(0.15, Math.min(1, edge.weight + amount));
  };

  NeuralEngine.prototype._pushLog = function(entry){
    entry.id = 'evt_' + (++this._seq);
    entry.timestamp = Date.now();
    this.eventLog.unshift(entry);
    if(this.eventLog.length > this.maxLog) this.eventLog.length = this.maxLog;
    this._notify(entry);
  };

  // ---- Handlers de eventos reales / demo -----------------------------------
  NeuralEngine.prototype.handle = function(type, payload, demo){
    payload = payload || {};
    var isDemo = !!demo;
    if(this.mode === 'pause') return;
    if(this.mode === 'live' && isDemo) return;
    if(this.mode === 'demo' && !isDemo) return; // en modo demo no se mezclan eventos reales

    switch(type){
      case 'movement:created': this._onMovement(payload, 'CREATED', isDemo); break;
      case 'movement:updated': this._onMovement(payload, 'UPDATED', isDemo); break;
      case 'movement:deleted': this._onMovement(payload, 'DELETED', isDemo); break;
      case 'movement:error': this._onMovementError(payload, isDemo); break;
      case 'frequent:added': this._onFrequent(payload, 'ADDED', isDemo); break;
      case 'frequent:removed': this._onFrequent(payload, 'REMOVED', isDemo); break;
      case 'frequent:error': this._onFrequentError(payload, isDemo); break;
      case 'data:synced': this._onDataSynced(payload, isDemo); break;
      case 'analytics:calculated': this._onAnalytics(payload, isDemo); break;
      default: break;
    }
  };

  NeuralEngine.prototype._onMovement = function(payload, action, demo){
    var isVenta = payload.tipo === 'Venta';
    var origin = isVenta ? 'sales' : 'expenses';
    var label = (isVenta ? 'SALE_' : 'EXPENSE_') + action;
    var category = isVenta ? 'sales' : 'expenses';
    var desc = payload.descripcion ? (': ' + payload.descripcion) : '';

    this.pipelineActiveUntil = now() + 900;

    var steps, stateMap;
    if(action === 'DELETED'){
      steps = [origin, 'dataInput', 'processing', 'sync', 'tikera'];
      stateMap = {}; stateMap[origin] = 'WARNING';
    }else if(action === 'CREATED' && isVenta){
      steps = ['sales','dataInput','processing','analytics','patterns','aiCore','insight','sync','tikera'];
      stateMap = {};
    }else{
      steps = [origin,'dataInput','processing','analytics','aiCore','sync','tikera'];
      stateMap = {};
    }

    this._activatePath(steps, { stateMap: stateMap, demo: demo });
    this._reinforce('processing->analytics', 0.01);

    this._pushLog({
      type: label, category: category, source: isVenta ? 'Sales System' : 'Expenses System',
      label: (isVenta ? 'Venta' : 'Gasto') + desc,
      path: steps.slice(), status: 'COMPLETED', demo: demo
    });
  };

  NeuralEngine.prototype._onMovementError = function(payload, demo){
    var origin = payload.tipo === 'Venta' ? 'sales' : 'expenses';
    this._activatePath([origin, 'dataInput', 'processing'], { errorAt: 'processing', demo: demo });
    this._pushLog({
      type: 'MOVEMENT_ERROR', category: 'system', source: 'Supabase',
      label: 'Error al ' + (payload.action || 'procesar') + ' movimiento',
      path: [origin,'dataInput','processing'], status: 'ERROR', demo: demo
    });
  };

  NeuralEngine.prototype._onFrequent = function(payload, action, demo){
    var steps = ['frequent','dataInput','processing','sync','tikera'];
    var stateMap = {};
    if(action === 'REMOVED') stateMap.frequent = 'WARNING';
    this._activatePath(steps, { stateMap: stateMap, demo: demo });
    this._pushLog({
      type: 'CATALOG_' + action, category: 'catalog', source: 'Catalog System',
      label: 'Item frecuente' + (payload.nombre ? (': ' + payload.nombre) : ''),
      path: steps, status: 'COMPLETED', demo: demo
    });
  };

  NeuralEngine.prototype._onFrequentError = function(payload, demo){
    this._activatePath(['frequent','processing'], { errorAt: 'processing', demo: demo });
    this._pushLog({
      type: 'CATALOG_ERROR', category: 'system', source: 'Supabase',
      label: 'Error en catalogo', path: ['frequent','processing'], status: 'ERROR', demo: demo
    });
  };

  NeuralEngine.prototype._onDataSynced = function(payload, demo){
    var steps = ['dataInput','processing','analytics','patterns','aiCore','sync','tikera'];
    this._activatePath(steps, { demo: demo });
    this._pushLog({
      type: 'DATA_SYNCED', category: 'system', source: 'Sync',
      label: 'Sincronizacion inicial' + (typeof payload.count === 'number' ? (' (' + payload.count + ' movimientos)') : ''),
      path: steps, status: 'COMPLETED', demo: demo
    });
  };

  NeuralEngine.prototype._onAnalytics = function(payload, demo){
    var partOfPipeline = now() < this.pipelineActiveUntil;
    if(partOfPipeline){
      // Ya se muestra como parte del pipeline de la venta/gasto que la disparo.
      var an = this.nodesById.analytics, pt = this.nodesById.patterns;
      an.activity = Math.max(an.activity, 60);
      pt.activity = Math.max(pt.activity, 40);
      return;
    }
    var steps = ['analytics','patterns','aiCore','insight','tikera'];
    this.analyticsRunCount += 1;
    var learningPulse = (this.analyticsRunCount % 5 === 0);
    var stateMap = {};
    if(learningPulse){
      stateMap.aiCore = 'LEARNING';
      this._reinforce('analytics->aiCore', 0.03);
      this._reinforce('patterns->aiCore', 0.02);
    }
    this._activatePath(steps, { stateMap: stateMap, demo: demo });
    this._pushLog({
      type: learningPulse ? 'AI_REINFORCEMENT' : 'ANALYTICS_CALCULATED',
      category: 'analytics', source: 'Analytics Engine',
      label: learningPulse
        ? 'Simulacion visual de refuerzo (no es entrenamiento real)'
        : 'Metricas recalculadas',
      path: steps, status: 'COMPLETED', demo: demo
    });
  };

  // ---- Ciclo de vida / decaimiento -----------------------------------------
  NeuralEngine.prototype.tick = function(){
    var t = now();
    this.nodes.forEach(function(node){
      if(node.state !== 'IDLE' && t > node.stateUntil){
        node.state = 'IDLE';
      }
      // Decaimiento exponencial de actividad hacia el baseline reciente.
      var recent = node.recentTimestamps.filter(function(ts){ return t - ts < 60000; });
      node.recentTimestamps = recent;
      node.baseline = Math.min(30, recent.length * 4);
      node.activity += (node.baseline - node.activity) * 0.03;
      if(node.activity < 0.5) node.activity = node.baseline;
    });
    this.edges.forEach(function(edge){
      if(t > edge.activityUntil) edge.activity *= 0.92;
      if(edge.activity < 0.01) edge.activity = 0;
    });
    this.particles = this.particles.filter(function(p){
      return (t - p.startedAt) < p.duration;
    });
    if(this.highlight && t > this.highlight.until){
      this.highlight = null;
    }
  };

  // ---- Consultas para la UI -------------------------------------------------
  NeuralEngine.prototype.getNodeInfo = function(nodeId){
    var node = this.nodesById[nodeId];
    if(!node) return null;
    var t = now();
    return {
      id: node.id, label: node.label, category: node.category,
      state: node.reserved ? 'RESERVED' : node.state,
      activity: Math.round(node.activity),
      eventCount: node.eventCount,
      lastEventAt: node.lastEventAt || null,
      secondsSinceLastEvent: node.lastEventAt ? Math.round((t - node.lastEventAt) / 1000) : null,
      reserved: node.reserved
    };
  };

  NeuralEngine.prototype.setMode = function(mode){
    this.mode = mode;
  };

  NeuralEngine.prototype.setFilter = function(filter){
    this.filter = filter;
  };

  // Resalta temporalmente el recorrido de un evento ya ocurrido (desde el feed).
  NeuralEngine.prototype.highlightEvent = function(eventId){
    var evt = this.eventLog.find(function(e){ return e.id === eventId; });
    if(!evt) return;
    var nodeIds = {}; var edgeIds = {};
    evt.path.forEach(function(id, idx){
      nodeIds[id] = true;
      if(idx > 0) edgeIds[evt.path[idx-1] + '->' + id] = true;
    });
    this.highlight = { nodeIds: nodeIds, edgeIds: edgeIds, until: now() + 1800, eventId: eventId };
  };

  NeuralEngine.prototype.systemStatus = function(){
    var t = now();
    if(t - this.lastErrorAt < 5000) return 'ERROR';
    var anyProcessing = this.nodes.some(function(n){ return n.state === 'PROCESSING' || n.state === 'ACTIVE' || n.state === 'LEARNING'; });
    if(anyProcessing) return 'PROCESSING';
    return 'ONLINE';
  };

  window.TikeraNeuralEngine = NeuralEngine;
  window.TIKERA_NODE_LABELS = NODE_LABELS;
})();
