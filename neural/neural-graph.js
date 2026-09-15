/* Tikera Neural Activity — Canvas Renderer
 *
 * Dibuja la red (nodos, conexiones, particulas) sobre un <canvas> 2D.
 * Se eligio Canvas 2D (sin librerias) porque la red tiene ~11 nodos y un
 * puñado de eventos por minuto: WebGL/Three.js/D3 agregarian peso y
 * complejidad sin ninguna ganancia real a esta escala, y el proyecto no
 * tiene bundler para integrar limpiamente una libreria de grafos.
 */
(function(){
  'use strict';

  var COLORS = {
    sales:     '#4CAF80',
    expenses:  '#B85B5D',
    catalog:   '#B98B3E',
    analytics: '#547096',
    ai:        '#8B7FD1',
    system:    '#9BA3A6',
    error:     '#D2585A',
    warning:   '#C9A227'
  };

  var RADIUS = { normal: 20, core: 27, reserved: 15, brand: 24 };
  var BRAND_ACCENT = '#3E5670';

  function lerp(a,b,t){ return a + (b-a)*t; }

  function quadPoint(p0, p1, p2, t){
    var mt = 1 - t;
    return {
      x: mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x,
      y: mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y
    };
  }

  function NeuralGraph(canvas, engine, opts){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.engine = engine;
    this.opts = opts || {};
    this.reducedMotion = !!this.opts.reducedMotion;

    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.width = 0;
    this.height = 0;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);

    this.hoveredNode = null;
    this.selectedNode = null;
    this.filter = 'all';

    this._raf = null;
    this._running = false;
    this._drag = null;
    this._seeds = {};

    this._onResize = this._resize.bind(this);
    this._onMouseMove = this._handleMove.bind(this);
    this._onMouseDown = this._handleDown.bind(this);
    this._onMouseUp = this._handleUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onLeave = this._handleLeave.bind(this);
    this._onClick = this._handleClick.bind(this);

    this.onHover = null;   // cb(nodeId|null)
    this.onSelect = null;  // cb(nodeId)

    this._bindEvents();
    this._resize();
  }

  NeuralGraph.prototype._bindEvents = function(){
    window.addEventListener('resize', this._onResize);
    this.canvas.addEventListener('mousemove', this._onMouseMove);
    this.canvas.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.canvas.addEventListener('wheel', this._onWheel, { passive:false });
    this.canvas.addEventListener('mouseleave', this._onLeave);
    this.canvas.addEventListener('click', this._onClick);
    // Touch basico: un dedo para pan, tap para seleccionar.
    this.canvas.addEventListener('touchstart', this._handleTouchStart.bind(this), { passive:true });
    this.canvas.addEventListener('touchmove', this._handleTouchMove.bind(this), { passive:false });
    this.canvas.addEventListener('touchend', this._handleTouchEnd.bind(this));
  };

  NeuralGraph.prototype.destroy = function(){
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.canvas.removeEventListener('mousemove', this._onMouseMove);
    this.canvas.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('mouseleave', this._onLeave);
    this.canvas.removeEventListener('click', this._onClick);
  };

  NeuralGraph.prototype._resize = function(){
    var rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(240, rect.width);
    this.height = Math.max(260, rect.height);
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  };

  NeuralGraph.prototype.resetView = function(){
    this.scale = 1; this.offsetX = 0; this.offsetY = 0;
  };

  NeuralGraph.prototype._worldPos = function(node){
    var pad = 46;
    var x = pad + node.x * (this.width - pad*2);
    var y = pad + node.y * (this.height - pad*2);
    if(!this.reducedMotion){
      var seed = this._seeds[node.id] || (this._seeds[node.id] = Math.random()*1000);
      var t = performance.now();
      x += Math.sin(t*0.0006 + seed) * 3;
      y += Math.cos(t*0.0005 + seed*1.3) * 3;
    }
    return { x:x, y:y };
  };

  NeuralGraph.prototype._screenPos = function(world){
    return { x: world.x*this.scale + this.offsetX, y: world.y*this.scale + this.offsetY };
  };

  NeuralGraph.prototype._toWorld = function(sx, sy){
    return { x: (sx - this.offsetX)/this.scale, y: (sy - this.offsetY)/this.scale };
  };

  NeuralGraph.prototype._curveFor = function(edge){
    var a = this.engine.nodesById[edge.from];
    var b = this.engine.nodesById[edge.to];
    var p0 = this._worldPos(a), p2 = this._worldPos(b);
    var mx = (p0.x+p2.x)/2, my = (p0.y+p2.y)/2;
    var dx = p2.x-p0.x, dy = p2.y-p0.y;
    var seed = this._seeds['e_'+edge.id] || (this._seeds['e_'+edge.id] = (Math.random()-0.5));
    var curveAmt = 0.16 * Math.sqrt(dx*dx+dy*dy) * seed * 2;
    var nx = -dy, ny = dx;
    var len = Math.sqrt(nx*nx+ny*ny) || 1;
    var p1 = { x: mx + (nx/len)*curveAmt, y: my + (ny/len)*curveAmt };
    return [p0, p1, p2];
  };

  NeuralGraph.prototype._radiusFor = function(node){
    if(node.reserved) return RADIUS.reserved;
    if(node.brand) return RADIUS.brand;
    return node.core ? RADIUS.core : RADIUS.normal;
  };

  NeuralGraph.prototype._nodeMatchesFilter = function(node){
    if(this.filter === 'all') return true;
    if(node.brand) return true; // Tikera es el nodo raiz: siempre visible, no se filtra.
    return node.category === this.filter;
  };

  NeuralGraph.prototype._hitTestNode = function(sx, sy){
    var world = this._toWorld(sx, sy);
    var found = null, best = Infinity;
    this.engine.nodes.forEach(function(node){
      var p = this._worldPos(node);
      var r = this._radiusFor(node) + 10;
      var d = Math.hypot(world.x-p.x, world.y-p.y);
      if(d < r && d < best){ best = d; found = node.id; }
    }, this);
    return found;
  };

  NeuralGraph.prototype._handleMove = function(e){
    var rect = this.canvas.getBoundingClientRect();
    var sx = e.clientX-rect.left, sy = e.clientY-rect.top;
    if(this._drag){
      this.offsetX = this._drag.ox + (sx - this._drag.sx);
      this.offsetY = this._drag.oy + (sy - this._drag.sy);
      return;
    }
    var hit = this._hitTestNode(sx, sy);
    if(hit !== this.hoveredNode){
      this.hoveredNode = hit;
      this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      if(this.onHover) this.onHover(hit, { x:e.clientX, y:e.clientY });
    }else if(hit && this.onHover){
      this.onHover(hit, { x:e.clientX, y:e.clientY });
    }
  };

  NeuralGraph.prototype._handleDown = function(e){
    this._drag = { sx:e.clientX - this.canvas.getBoundingClientRect().left, sy:e.clientY - this.canvas.getBoundingClientRect().top, ox:this.offsetX, oy:this.offsetY, moved:false };
    this.canvas.style.cursor = 'grabbing';
  };

  NeuralGraph.prototype._handleUp = function(){
    this._drag = null;
    this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
  };

  NeuralGraph.prototype._handleLeave = function(){
    this.hoveredNode = null;
    if(this.onHover) this.onHover(null);
  };

  NeuralGraph.prototype._handleClick = function(e){
    var rect = this.canvas.getBoundingClientRect();
    var hit = this._hitTestNode(e.clientX-rect.left, e.clientY-rect.top);
    if(hit){
      this.selectedNode = hit;
      if(this.onSelect) this.onSelect(hit);
    }
  };

  NeuralGraph.prototype._handleWheel = function(e){
    e.preventDefault();
    var rect = this.canvas.getBoundingClientRect();
    var sx = e.clientX-rect.left, sy = e.clientY-rect.top;
    var before = this._toWorld(sx, sy);
    var delta = e.deltaY > 0 ? 0.92 : 1.08;
    this.scale = Math.max(0.6, Math.min(2.2, this.scale*delta));
    var after = this._toWorld(sx, sy);
    this.offsetX += (after.x-before.x)*this.scale;
    this.offsetY += (after.y-before.y)*this.scale;
  };

  NeuralGraph.prototype._handleTouchStart = function(e){
    if(e.touches.length !== 1) return;
    var t = e.touches[0];
    var rect = this.canvas.getBoundingClientRect();
    this._drag = { sx:t.clientX-rect.left, sy:t.clientY-rect.top, ox:this.offsetX, oy:this.offsetY };
    this._touchStart = { x:t.clientX, y:t.clientY, time:Date.now() };
  };

  NeuralGraph.prototype._handleTouchMove = function(e){
    if(!this._drag || e.touches.length !== 1) return;
    e.preventDefault();
    var t = e.touches[0];
    var rect = this.canvas.getBoundingClientRect();
    var sx = t.clientX-rect.left, sy = t.clientY-rect.top;
    this.offsetX = this._drag.ox + (sx - this._drag.sx);
    this.offsetY = this._drag.oy + (sy - this._drag.sy);
  };

  NeuralGraph.prototype._handleTouchEnd = function(e){
    if(this._touchStart){
      var dt = Date.now() - this._touchStart.time;
      var moved = this._drag ? Math.hypot(this._drag.sx - (this._touchStart.x - this.canvas.getBoundingClientRect().left), 0) : 0;
      if(dt < 300){
        var rect = this.canvas.getBoundingClientRect();
        var hit = this._hitTestNode(this._touchStart.x-rect.left, this._touchStart.y-rect.top);
        if(hit){ this.selectedNode = hit; if(this.onSelect) this.onSelect(hit); }
      }
    }
    this._drag = null;
    this._touchStart = null;
  };

  // ---- Render loop ----------------------------------------------------------
  NeuralGraph.prototype.start = function(){
    if(this._running) return;
    this._running = true;
    var self = this;
    function frame(){
      if(!self._running) return;
      self.engine.tick();
      self._draw();
      self._raf = requestAnimationFrame(frame);
    }
    this._raf = requestAnimationFrame(frame);
  };

  NeuralGraph.prototype.stop = function(){
    this._running = false;
    if(this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  };

  NeuralGraph.prototype._draw = function(){
    var ctx = this.ctx;
    ctx.clearRect(0,0,this.width,this.height);
    var engine = this.engine;
    var highlight = engine.highlight;
    var filterActive = this.filter !== 'all';

    ctx.save();

    // Conexiones
    engine.edges.forEach(function(edge){
      if(edge.reserved) return;
      var pts = this._curveFor(edge);
      var dim = (filterActive && !this._edgeMatchesFilter(edge)) ||
                (highlight && !highlight.edgeIds[edge.id]);
      var activity = edge.activity;
      var color = COLORS[this._edgeCategory(edge)] || COLORS.system;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
      ctx.lineWidth = 1 + edge.weight*2.4 + activity*1.2;
      ctx.strokeStyle = this._withAlpha(color, dim ? 0.08 : (0.18 + activity*0.5));
      ctx.stroke();
    }, this);

    // Particulas (informacion viajando)
    var now = performance.now();
    engine.particles.forEach(function(p){
      var edge = engine.edgesById[p.edgeId];
      if(!edge) return;
      var pts = this._curveFor(edge);
      var t = Math.min(1, (now - p.startedAt)/p.duration);
      var pos = quadPoint(pts[0], pts[1], pts[2], t);
      var color = COLORS[this._edgeCategory(edge)] || COLORS.system;
      var alpha = 1 - Math.pow(t, 2);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, p.demo ? 2.2 : 3, 0, Math.PI*2);
      ctx.fillStyle = this._withAlpha(color, alpha);
      if(p.demo){
        ctx.setLineDash([1,2]);
        ctx.strokeStyle = this._withAlpha(color, alpha*0.6);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fill();
    }, this);

    // Nodos
    engine.nodes.forEach(function(node){
      this._drawNode(node, filterActive, highlight);
    }, this);

    ctx.restore();
  };

  NeuralGraph.prototype._edgeCategory = function(edge){
    var from = this.engine.nodesById[edge.from];
    var to = this.engine.nodesById[edge.to];
    // Las conexiones que llegan a Tikera conservan el color de su origen,
    // para que se vea que es la confluencia de todo lo demas.
    if(to && to.brand) return from ? from.category : 'system';
    return to ? to.category : 'system';
  };

  NeuralGraph.prototype._edgeMatchesFilter = function(edge){
    var a = this.engine.nodesById[edge.from], b = this.engine.nodesById[edge.to];
    if(b && b.brand) return true;
    return (a && a.category === this.filter) || (b && b.category === this.filter);
  };

  NeuralGraph.prototype._withAlpha = function(hex, alpha){
    alpha = Math.max(0, Math.min(1, alpha));
    var r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+','+alpha.toFixed(3)+')';
  };

  var STATE_COLOR = {
    IDLE: 'system', PROCESSING: 'analytics', ACTIVE: null /* usa categoria */,
    WARNING: 'warning', SUCCESS: null, ERROR: 'error', LEARNING: 'ai', RESERVED: 'system'
  };

  NeuralGraph.prototype._drawNode = function(node, filterActive, highlight){
    var ctx = this.ctx;
    var pos = this._worldPos(node);
    var r = this._radiusFor(node);
    var dim = (filterActive && !this._nodeMatchesFilter(node)) || (highlight && !highlight.nodeIds[node.id]);
    var baseColor = COLORS[node.category] || COLORS.system;
    var stateColorKey = STATE_COLOR[node.state];
    var color = stateColorKey ? COLORS[stateColorKey] : baseColor;

    if(node.reserved){
      ctx.beginPath();
      ctx.setLineDash([3,4]);
      ctx.arc(pos.x, pos.y, r, 0, Math.PI*2);
      ctx.strokeStyle = this._withAlpha(COLORS.system, 0.3);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.setLineDash([]);
      this._drawLabel(node, pos, r, 0.35);
      return;
    }

    var activity = node.activity/100;
    var glowAlpha = dim ? 0.05 : (0.12 + activity*0.35);
    var glowR = r + 8 + activity*(node.core?16:10);
    var grad = ctx.createRadialGradient(pos.x,pos.y,r*0.3,pos.x,pos.y,glowR);
    grad.addColorStop(0, this._withAlpha(node.brand ? BRAND_ACCENT : color, glowAlpha));
    grad.addColorStop(1, this._withAlpha(node.brand ? BRAND_ACCENT : color, 0));
    ctx.beginPath();
    ctx.fillStyle = grad;
    ctx.arc(pos.x, pos.y, glowR, 0, Math.PI*2);
    ctx.fill();

    if(node.brand){
      // Insignia de marca: cuadrado redondeado con "T", como el badge de Tikera.
      var s = r * 1.15;
      var rr = s * 0.28;
      ctx.beginPath();
      this._roundRect(pos.x - s/2, pos.y - s/2, s, s, rr);
      ctx.fillStyle = this._withAlpha(BRAND_ACCENT, dim ? 0.55 : 0.96);
      ctx.fill();
      ctx.font = '700 ' + Math.round(s*0.6) + 'px "Space Grotesk", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this._withAlpha('#FFFFFF', dim ? 0.55 : 1);
      ctx.fillText('T', pos.x, pos.y + 1);
    }else{
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI*2);
      ctx.fillStyle = this._withAlpha('#12171A', dim ? 0.6 : 0.92);
      ctx.fill();
      ctx.lineWidth = node.core ? 2.2 : 1.6;
      ctx.strokeStyle = this._withAlpha(color, dim ? 0.25 : (0.55 + activity*0.4));
      ctx.stroke();

      if(node.state === 'ACTIVE' || node.state === 'LEARNING'){
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, r*0.42, 0, Math.PI*2);
        ctx.fillStyle = this._withAlpha(color, dim ? 0.2 : 0.85);
        ctx.fill();
      }
    }

    this._drawLabel(node, pos, r, dim ? 0.35 : 0.92);
  };

  NeuralGraph.prototype._roundRect = function(x, y, w, h, r){
    var ctx = this.ctx;
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y, x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x, y+h, r);
    ctx.arcTo(x, y+h, x, y, r);
    ctx.arcTo(x, y, x+w, y, r);
    ctx.closePath();
  };

  NeuralGraph.prototype._drawLabel = function(node, pos, r, alpha){
    var ctx = this.ctx;
    ctx.font = (node.core ? '700 11px' : '600 10px') + ' "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = this._withAlpha('#F4F2ED', alpha);
    ctx.fillText(node.label, pos.x, pos.y + r + 6);
  };

  window.TikeraNeuralGraph = NeuralGraph;
})();
