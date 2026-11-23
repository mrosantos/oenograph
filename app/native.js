import {registerPlugin} from '@capacitor/core';
// Only loaded inside the iPhone/iPad app (added by app/build.mjs).
// The website shows bottle photos through its service worker ("_blob/<id>" links).
// The app has no service worker, so this file turns those links into local photo links.
(function(){
  var cache={};
  function photo(id){
    if(cache[id])return cache[id];
    return cache[id]=new Promise(function(ok){
      var r=indexedDB.open('oeno-photos',1);
      r.onupgradeneeded=function(){r.result.createObjectStore('p',{keyPath:'id'})};
      r.onerror=function(){ok(null)};
      r.onsuccess=function(){var d=r.result,q=d.transaction('p').objectStore('p').get(id);
        q.onsuccess=function(){d.close();ok(q.result&&q.result.blob?q.result.blob:null)};
        q.onerror=function(){d.close();ok(null)}};
    }).then(function(b){if(!b)delete cache[id];return b});
  }
  function idOf(v){var m=/(?:^|\/)_blob\/([0-9a-f]+)$/.exec(String(v||''));return m&&m[1]}
  var urls={};
  function urlFor(id){return photo(id).then(function(b){if(!b)return null;return urls[id]||(urls[id]=URL.createObjectURL(b))})}

  // fetch('_blob/<id>')
  var realFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    var id=idOf(typeof input==='string'?input:input&&input.url);
    if(!id)return realFetch(input,init);
    return photo(id).then(function(b){return b?new Response(b,{headers:{'content-type':b.type||'image/jpeg'}}):new Response('',{status:404})});
  };

  // img.src='_blob/<id>' set from code
  var d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');
  Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,enumerable:true,
    get:function(){return d.get.call(this)},
    set:function(v){var id=idOf(v),img=this;if(!id)return d.set.call(this,v);
      img.setAttribute('data-blob',id);
      urlFor(id).then(function(u){if(img.getAttribute('data-blob')!==id)return;d.set.call(img,u||'data:,')})}});

  // <img src="_blob/<id>"> written into the page
  function fix(img){var a=img.getAttribute('src'),id=idOf(a);if(id)img.src=a}
  function scan(n){if(n.nodeType!==1)return;if(n.tagName==='IMG')fix(n);else if(n.querySelectorAll)n.querySelectorAll('img[src*="_blob/"]').forEach(fix)}
  new MutationObserver(function(ms){ms.forEach(function(m){
    if(m.type==='attributes')fix(m.target);else m.addedNodes.forEach(scan)})})
    .observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
})();

// iPhone Duo, closed: the outer screen is about 466 points wide and short, with the clock strip on the right.
(function(){
  var q=matchMedia('(min-width:450px) and (max-width:480px) and (max-height:720px) and (orientation:portrait) and (hover:none)');
  function set(){document.documentElement.classList.toggle('duo-rail',q.matches)}
  set();(q.addEventListener?q.addEventListener('change',set):q.addListener(set));
})();

// Real iOS Liquid Glass menu and buttons (drawn by ios/App/App/GlassBar.swift).
// The page's own menu and round buttons stay in place, invisible, and the glass ones press them.
(function(){
  if(location.protocol!=='capacitor:')return;
  var GlassBar=registerPlugin('GlassBar');
  var html=document.documentElement;
  var ICON={cellar:'waterbottle',drink:'wineglass',log:'list.bullet.rectangle',map:'safari'};
  var upright=matchMedia('(max-width:600px) and (orientation:portrait)');
  function mode(){return html.classList.contains('duo-rail')?'duo':upright.matches?'bottom':'off'}
  function tabsOf(){var n=document.querySelector('nav');return n?Array.prototype.slice.call(n.querySelectorAll(':scope > button[data-t]')):[]}
  function top(l){return document.querySelector('.top .plus[aria-label="'+l+'"]')}
  var last='',queued=false,failed=false;
  // The app's own line icons, drawn as pictures so the glass menu matches the rest of œnograph.
  var IMG={},pending={};
  function img(key,svg){
    if(!svg)return '';
    if(IMG[key])return IMG[key];
    if(!pending[key]){
      pending[key]=1;
      var c=svg.cloneNode(true);if(c.getAttribute('stroke-width'))c.setAttribute('stroke-width','1.7');c.setAttribute('width','72');c.setAttribute('height','72');c.setAttribute('xmlns','http://www.w3.org/2000/svg');
      var src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(c).replace(/currentColor/g,'#000'));
      var im=new Image();im.onload=function(){try{var cv=document.createElement('canvas');cv.width=cv.height=72;cv.getContext('2d').drawImage(im,0,0,72,72);IMG[key]=cv.toDataURL('image/png').split(',')[1];soon()}catch(e){}};im.src=src;
    }
    return '';
  }
  // "•••" drawn in the same style as the other icons.
  var MORE=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>','image/svg+xml').documentElement;
  function topSvg(l){var b=top(l);return b&&b.querySelector('svg')}
  // Big page title: when it changes (Drink to Log to Map), the old word slides out and the new one slides in.
  var lastTitle='',lastHTML='',lastIdx=-1;
  function titleAnim(){
    var h=document.querySelector('.top h1:not(.tghost)');if(!h)return;
    var t=h.textContent,idx=tabsOf().findIndex(function(b){return b.classList.contains('on')});
    if(lastTitle&&t!==lastTitle&&h.animate&&h.parentNode){
      var d=idx>=lastIdx?1:-1,p=h.parentNode,ez='cubic-bezier(.33,.1,.25,1)';
      if(getComputedStyle(p).position==='static')p.style.position='relative';
      var g=document.createElement('h1');g.className='tghost';g.setAttribute('aria-hidden','true');g.innerHTML=lastHTML;
      g.style.cssText='position:absolute;margin:0;left:'+h.offsetLeft+'px;top:'+h.offsetTop+'px;white-space:nowrap;pointer-events:none';
      p.appendChild(g);
      g.animate([{opacity:1,transform:'none'},{opacity:0,transform:'translateX('+(-28*d)+'px)'}],{duration:200,easing:ez,fill:'forwards'}).onfinish=function(){g.remove()};
      h.animate([{opacity:0,transform:'translateX('+(28*d)+'px)'},{opacity:1,transform:'none'}],{duration:360,delay:110,easing:ez,fill:'backwards'});
    }
    lastTitle=t;lastIdx=idx;lastHTML=h.innerHTML;
  }
  function send(){
    queued=false;
    try{titleAnim()}catch(e){}
    var m=mode();if(m==='off'||failed)html.classList.remove('native-glass');
    var nav=document.querySelector('nav');if(!nav)return;
    var nb=tabsOf();
    var tabs=nb.map(function(b){var s=b.querySelector('span');return {id:'tab:'+b.dataset.t,icon:ICON[b.dataset.t]||'circle',img:img('t'+b.dataset.t,b.querySelector('svg')),label:(s?s.textContent:b.textContent).trim()}});
    var active=nb.findIndex(function(b){return b.classList.contains('on')});
    var actions=[];
    // The same three glass buttons on every page: + , Search and ••• (Settings).
    actions.push({id:'add',icon:'plus',img:img('add',topSvg('Add wine')),label:'Add wine'});
    actions.push({id:'search',icon:'magnifyingglass',img:img('search',topSvg('Search')),label:'Search'});
    actions.push({id:'settings',icon:'ellipsis',img:img('more',MORE),label:'Settings'});
    var hidden=nav.classList.contains('hide')||document.body.classList.contains('kbd');
    var accent=getComputedStyle(html).getPropertyValue('--acc').trim();
    var spec=JSON.stringify({mode:m,hidden:hidden,active:active,tabs:tabs,actions:actions,search:false,top:!!(document.getElementById('fbtt')&&document.getElementById('fbtt').classList.contains('on')),accent:accent});
    if(failed||spec===last)return;
    last=spec;
    GlassBar.update({spec:spec}).then(function(r){
      // Only hide the page's own buttons once iOS confirms it is drawing the glass ones.
      if(m!=='off')html.classList.add('native-glass');
    }).catch(function(e){
      failed=true;html.classList.remove('native-glass');
      var msg='Glass menu error: '+((e&&(e.message||e.code))||e);
      console.error(msg);if(typeof window.toast==='function')window.toast(msg,15000);
    });
  }
  function soon(){if(!queued){queued=true;requestAnimationFrame(send)}}
  GlassBar.addListener('tap',function(e){
    var id=e&&e.id||'';
    if(id.indexOf('tab:')===0){var b=document.querySelector('nav > button[data-t="'+id.slice(4)+'"]');if(b)b.click()}
    else if(id==='add'){var a=top('Add wine');if(a)a.click();else if(window.newW)window.newW()}
    else if(id==='search'){var s=top('Search');if(s)s.click();else{var c=document.querySelector('nav > button[data-t="cellar"]');if(c)c.click();setTimeout(function(){var s2=top('Search');if(s2)s2.click();else if(window.openSearch)window.openSearch()},350)}}
    else if(id==='top'){if(typeof window.backTop==='function')window.backTop();else{var f=document.getElementById('fbtt');if(f)f.click()}}
    else if(id==='settings'){var t=top('Settings');if(t)t.click();else if(window.openSettings)window.openSettings()}
    soon();
  });
  function start(){
    new MutationObserver(soon).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    addEventListener('resize',soon);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',soon);
    send();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
