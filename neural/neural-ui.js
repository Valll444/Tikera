/* Tikera Neural Activity — UI Controller
 *
 * Conecta el motor (NeuralEngine) y el renderer (NeuralGraph) con el DOM:
 * controles de modo, filtros, tooltip, Event Inspector y Live Activity.
 * Tambien escucha el bus de eventos reales de Tikera y alimenta al motor.
 */
(function(){
  'use strict';

  var STATUS_LABEL = { ONLINE:'ONLINE', PROCESSING:'PROCESSING', ERROR:'ERROR', OFFLINE:'OFFLINE / SIMULATION' };
  var CATEGORY_LABEL = { all:'Todo', sales:'Ventas', expenses:'Gastos', catalog:'Catalogo', analytics:'Analytics', ai:'AI', system:'System' };

  var DEMO_EVENTS = [
    { type:'movement:created', payload:{ tipo:'Venta', descripcion:'Gaseosa 500ml' } },
    { type:'movement:created', payload:{ tipo:'Venta', descripcion:'Alfajor' } },
    { type:'movement:created', payload:{ tipo:'Gasto', descripcion:'Proveedor de bebidas' } },
    { type:'frequent:added', payload:{ nombre:'Agua mineral' } },
    { type:'movement:updated', payload:{ tipo:'Venta', descripcion:'Cigarrillos' } },
    { type:'analytics:calculated', payload:{} },
    { type:'movement:created', payload:{ tipo:'Gasto', descripcion:'Alquiler' } },
    { type:'frequent:removed', payload:{ nombre:'Producto descontinuado' } }
  ];

  function fmtClock(ts){
    return new Date(ts).toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  }

  function fmtRelative(ms){
    if(ms == null) return 'sin actividad';
    var s = Math.max(0, ms);
    if(s < 60) return 'hace ' + s + 's';
    var m = Math.round(s/60);
    return 'hace ' + m + 'm';
  }

  function TikeraNeuralUI(root){
    this.root = root;
    this.engine = new window.TikeraNeuralEngine();
    this.canvas = root.querySelector('#neuralCanvas');
    this.reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.graph = new window.TikeraNeuralGraph(this.canvas, this.engine, { reducedMotion: this.reducedMotion });

    this.mounted = false;
    this.demoTimer = null;
    this.statusTimer = null;
    this._busUnsubs = [];
    this._selectedNodeId = null;

    this._bindGraph();
    this._bindControls();
    this._bindBus();

    this.engine.onEvent(this._onEngineEvent.bind(this));
  }

  TikeraNeuralUI.prototype._bindGraph = function(){
    var self = this;
    this.graph.onHover = function(nodeId, pos){
      self._renderTooltip(nodeId, pos);
    };
    this.graph.onSelect = function(nodeId){
      self._selectedNodeId = nodeId;
      self._renderInspectorForNode(nodeId);
    };
  };

  TikeraNeuralUI.prototype._bindBus = function(){
    if(!window.TikeraBus) return;
    var self = this;
    var types = ['movement:created','movement:updated','movement:deleted','movement:error',
      'frequent:added','frequent:removed','frequent:error','data:synced','analytics:calculated'];
    types.forEach(function(type){
      self._busUnsubs.push(window.TikeraBus.on(type, function(payload){
        self.engine.handle(type, payload, false);
      }));
    });
  };

  TikeraNeuralUI.prototype._bindControls = function(){
    var self = this;
    var root = this.root;

    root.querySelectorAll('.neural-mode-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var mode = btn.getAttribute('data-mode');
        self._setMode(mode);
      });
    });

    root.querySelectorAll('.neural-filter-chip').forEach(function(btn){
      btn.addEventListener('click', function(){
        root.querySelectorAll('.neural-filter-chip').forEach(function(b){ b.classList.remove('active'); });
        btn.classList.add('active');
        var filter = btn.getAttribute('data-filter');
        self.engine.setFilter(filter);
        self.graph.filter = filter;
      });
    });

    var resetBtn = root.querySelector('#neuralResetView');
    if(resetBtn) resetBtn.addEventListener('click', function(){ self.graph.resetView(); });

    var sideToggle = root.querySelector('#neuralSideToggle');
    var sideContent = root.querySelector('#neuralSideContent');
    if(sideToggle && sideContent){
      sideToggle.addEventListener('click', function(){
        var isOpen = sideContent.classList.toggle('open');
        sideToggle.textContent = isOpen ? 'Ocultar detalles' : 'Ver detalles';
      });
    }
  };

  TikeraNeuralUI.prototype._setMode = function(mode){
    this.engine.setMode(mode);
    var root = this.root;
    root.querySelectorAll('.neural-mode-btn').forEach(function(btn){
      btn.classList.toggle('active', btn.getAttribute('data-mode') === mode);
    });
    var badge = root.querySelector('#neuralDemoBadge');
    if(badge) badge.hidden = mode !== 'demo';
    this._stopDemoGenerator();
    if(mode === 'demo') this._startDemoGenerator();
  };

  TikeraNeuralUI.prototype._startDemoGenerator = function(){
    var self = this;
    function fireOne(){
      var pick = DEMO_EVENTS[Math.floor(Math.random()*DEMO_EVENTS.length)];
      self.engine.handle(pick.type, pick.payload, true);
      self.demoTimer = setTimeout(fireOne, 1400 + Math.random()*2200);
    }
    fireOne();
  };

  TikeraNeuralUI.prototype._stopDemoGenerator = function(){
    if(this.demoTimer){ clearTimeout(this.demoTimer); this.demoTimer = null; }
  };

  // ---- Tooltip ---------------------------------------------------------
  TikeraNeuralUI.prototype._renderTooltip = function(nodeId, pos){
    var tip = this.root.querySelector('#neuralTooltip');
    if(!tip) return;
    if(!nodeId){ tip.hidden = true; return; }
    var info = this.engine.getNodeInfo(nodeId);
    if(!info) { tip.hidden = true; return; }

    var lines = [
      '<strong>' + info.label + '</strong>',
      'Status: ' + info.state
    ];
    if(info.reserved){
      lines.push('Reservado para un futuro modelo predictivo.');
      lines.push('Todavia no implementado.');
    }else{
      lines.push('Actividad: ' + info.activity + '%');
      lines.push('Eventos: ' + info.eventCount);
      lines.push('Ultimo evento: ' + fmtRelative(info.secondsSinceLastEvent));
      if(info.id === 'aiCore'){
        lines.push('<span class="neural-disclaimer">Simulacion de procesamiento — no hay modelo de IA real todavia.</span>');
      }
    }
    tip.innerHTML = lines.join('<br>');
    tip.hidden = false;
    var wrap = this.root.querySelector('#neuralGraphWrap');
    var wrapRect = wrap.getBoundingClientRect();
    var left = pos ? (pos.x - wrapRect.left + 14) : 0;
    var top = pos ? (pos.y - wrapRect.top + 14) : 0;
    left = Math.min(left, wrapRect.width - 190);
    tip.style.left = Math.max(6, left) + 'px';
    tip.style.top = Math.max(6, top) + 'px';
  };

  // ---- Event Inspector ---------------------------------------------------
  TikeraNeuralUI.prototype._renderInspectorForNode = function(nodeId){
    var info = this.engine.getNodeInfo(nodeId);
    if(!info) return;
    var lastEvent = this.engine.eventLog.find(function(e){ return e.path.indexOf(nodeId) !== -1; });
    var html = '<div class="neural-inspector-node">' + info.label + '</div>' +
      '<div class="neural-kv"><span>Status</span><span>' + info.state + '</span></div>';
    if(!info.reserved){
      html += '<div class="neural-kv"><span>Actividad</span><span>' + info.activity + '%</span></div>' +
        '<div class="neural-kv"><span>Eventos</span><span>' + info.eventCount + '</span></div>';
    }
    if(lastEvent){
      html += '<div class="neural-kv"><span>Ultimo evento</span><span>' + lastEvent.type + '</span></div>' +
        '<div class="neural-path">' + lastEvent.path.map(function(id){ return id; }).join(' &rarr; ') + '</div>';
    }
    this._setInspectorHTML(html);
  };

  TikeraNeuralUI.prototype._renderInspectorForEvent = function(evt){
    var html = '<div class="neural-inspector-node">' + evt.type + (evt.demo ? ' <span class="neural-demo-tag">DEMO</span>' : '') + '</div>' +
      '<div class="neural-kv"><span>Source</span><span>' + evt.source + '</span></div>' +
      '<div class="neural-kv"><span>Timestamp</span><span>' + fmtClock(evt.timestamp) + '</span></div>' +
      '<div class="neural-kv"><span>Status</span><span class="neural-status-' + evt.status.toLowerCase() + '">' + evt.status + '</span></div>' +
      '<div class="neural-path">' + evt.path.join(' &rarr; ') + '</div>';
    this._setInspectorHTML(html);
  };

  TikeraNeuralUI.prototype._setInspectorHTML = function(html){
    var el = this.root.querySelector('#neuralInspector');
    if(el) el.innerHTML = html;
  };

  // ---- Activity feed ------------------------------------------------------
  TikeraNeuralUI.prototype._onEngineEvent = function(evt){
    var feed = this.root.querySelector('#neuralFeed');
    if(!feed) return;
    var empty = feed.querySelector('.neural-empty');
    if(empty) empty.remove();
    var row = document.createElement('div');
    row.className = 'neural-feed-row' + (evt.demo ? ' demo' : '') + (evt.status === 'ERROR' ? ' is-error' : '');
    row.setAttribute('data-event-id', evt.id);
    row.innerHTML =
      '<span class="neural-feed-dot cat-' + evt.category + '"></span>' +
      '<span class="neural-feed-label">' + evt.type + '</span>' +
      '<span class="neural-feed-time">' + fmtClock(evt.timestamp) + '</span>';
    row.addEventListener('click', (function(self){
      return function(){ self._selectEvent(evt.id); };
    })(this));
    feed.insertBefore(row, feed.firstChild);
    while(feed.children.length > 20) feed.removeChild(feed.lastChild);
  };

  TikeraNeuralUI.prototype._selectEvent = function(eventId){
    this.engine.highlightEvent(eventId);
    var evt = this.engine.eventLog.find(function(e){ return e.id === eventId; });
    if(evt) this._renderInspectorForEvent(evt);
    this.root.querySelectorAll('.neural-feed-row').forEach(function(r){
      r.classList.toggle('selected', r.getAttribute('data-event-id') === eventId);
    });
  };

  // ---- System status --------------------------------------------------
  TikeraNeuralUI.prototype._tickStatus = function(){
    var dot = this.root.querySelector('#neuralStatusDot');
    var label = this.root.querySelector('#neuralStatusLabel');
    if(!dot || !label) return;
    var status = (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'OFFLINE' : this.engine.systemStatus();
    dot.className = 'neural-status-dot status-' + status.toLowerCase();
    label.textContent = STATUS_LABEL[status] || status;
  };

  // ---- Mount / unmount (llamado desde switchView) --------------------------
  TikeraNeuralUI.prototype.mount = function(){
    if(this.mounted) return;
    this.mounted = true;
    this.graph._resize();
    this.graph.resetView();
    this.graph.start();
    this._tickStatus();
    var self = this;
    this.statusTimer = setInterval(function(){ self._tickStatus(); }, 800);
  };

  TikeraNeuralUI.prototype.unmount = function(){
    if(!this.mounted) return;
    this.mounted = false;
    this.graph.stop();
    if(this.statusTimer){ clearInterval(this.statusTimer); this.statusTimer = null; }
  };

  window.TikeraNeuralUI = TikeraNeuralUI;

  function init(){
    var root = document.getElementById('viewNeural');
    if(root) window.tikeraNeural = new TikeraNeuralUI(root);
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  }else{
    init();
  }
})();
