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
  var last='',queued=false,failed=false,shown=false;
  function send(){
    queued=false;
    var m=mode();if(m==='off'||failed)html.classList.remove('native-glass');
    var nav=document.querySelector('nav');if(!nav)return;
    var nb=tabsOf();
    var tabs=nb.map(function(b){var s=b.querySelector('span');return {id:'tab:'+b.dataset.t,icon:ICON[b.dataset.t]||'circle',label:(s?s.textContent:b.textContent).trim()}});
    var active=nb.findIndex(function(b){return b.classList.contains('on')});
    var actions=[];
    if(top('Add wine'))actions.push({id:'add',icon:'plus',label:'Add wine'});
    if(top('Settings')||typeof window.openSettings==='function')actions.push({id:'settings',icon:'gearshape',label:'Settings'});
    var hidden=nav.classList.contains('hide')||document.body.classList.contains('kbd');
    var accent=getComputedStyle(html).getPropertyValue('--acc').trim();
    var spec=JSON.stringify({mode:m,hidden:hidden,active:active,tabs:tabs,actions:actions,search:!!top('Search'),accent:accent});
    if(failed||spec===last)return;
    last=spec;
    GlassBar.update({spec:spec}).then(function(r){
      // Only hide the page's own buttons once iOS confirms it is drawing the glass ones.
      if(m!=='off')html.classList.add('native-glass');
      // Temporary: show what iOS drew, to check placement on the real phone.
      if(!shown&&r&&r.info&&typeof window.toast==='function'){shown=true;window.toast('Glass: '+r.info,12000)}
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
    else if(id==='add'){var a=top('Add wine');if(a)a.click()}
    else if(id==='search'){var s=top('Search');if(s)s.click()}
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
