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
  // Colours for iOS as #rrggbb (the page may give rgb(...)).
  function hex(c){c=(c||'').trim();var m=/rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);if(!m)return c;return '#'+[m[1],m[2],m[3]].map(function(n){return ('0'+(+n).toString(16)).slice(-2)}).join('')}
  function tabsOf(){var n=document.querySelector('nav');return n?Array.prototype.slice.call(n.querySelectorAll(':scope > button[data-t]')):[]}
  // The page's own top buttons, found by what they do (their labels change with the language).
  var DO={'Add wine':'newW()','Search':'openSearch()','Settings':'openSettings()'};
  function top(l){return document.querySelector('.top .plus[onclick="'+DO[l]+'"]')}
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
    var sheet=['info','info2','info3'].some(function(i){var e=document.getElementById(i);return e&&e.style.display&&e.style.display!=='none'});
    var hidden=nav.classList.contains('hide')||document.body.classList.contains('kbd')||sheet;
    var accent=settled(function(){return hex(getComputedStyle(html).getPropertyValue('--acc'))});
    var theme=(typeof PF!=='undefined'&&PF.theme)||'auto';
    var spec=JSON.stringify({mode:m,theme:theme,hidden:hidden,active:active,tabs:tabs,actions:actions,search:false,top:!!(document.getElementById('fbtt')&&document.getElementById('fbtt').classList.contains('on')),accent:accent});
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
  // ---- Native Settings card ----
  // The page still builds its Settings card (so every option, language and rule stays the same);
  // it is kept invisible, read here, and shown by iOS instead. Taps press the page's own controls.
  var REFS=[],setOn=false,lastSet='',setT=0;
  function txt(e){return e?e.textContent.replace(/\s+/g,' ').trim():''}
  function own(span){return span?Array.prototype.filter.call(span.childNodes,function(n){return !(n.classList&&n.classList.contains('m'))}).map(function(n){return n.textContent}).join('').replace(/\s+/g,' ').trim():''}
  function selOf(seg,bs){
    var i=Array.prototype.findIndex.call(bs,function(b){return b.classList.contains('on')});
    if(i<0&&seg.dataset.k==='lang'){var l=(typeof PF!=='undefined'&&PF.lang)||(html.lang||'en').slice(0,2);i=Array.prototype.findIndex.call(bs,function(b){return b.dataset.v===l});if(i<0)i=0}
    return i;
  }
  // The page fades its colours over 0.6s when the theme changes; read the end colours, not a mid-fade value.
  function settled(f){var t=html.style.transition;html.style.transition='none';void html.offsetWidth;try{return f()}finally{html.style.transition=t}}
  function cols(){return settled(function(){var cs=getComputedStyle(document.body),o={};['paper','card','fg','mut'].forEach(function(k){var v=cs.getPropertyValue('--'+k).trim();if(v)o[k]=hex(v)});o.acc=hex(getComputedStyle(html).getPropertyValue('--acc'));return o})}
  function settingsSpec(bd){
    REFS=[];var secs=[],cur=null,title='Settings',sub='';
    function sec(h){cur={header:h||'',footer:'',rows:[]};secs.push(cur);return cur}
    function ref(e){REFS.push(e);return String(REFS.length-1)}
    Array.prototype.forEach.call(bd.children,function(e){
      if(e.classList.contains('ttl')){title=txt(e);return}
      if(e.classList.contains('sub')&&!cur){sub=txt(e);return}
      if(e.tagName==='H2'){sec(txt(e));return}
      if(!cur)sec('');
      if(e.classList.contains('seg')){var bs=e.querySelectorAll('button');cur.rows.push({kind:'seg',id:ref(e),options:Array.prototype.map.call(bs,txt),selected:selOf(e,bs)});return}
      if(e.tagName==='LABEL'&&e.querySelector('input[type=checkbox]')){var sp=e.querySelector('span');cur.rows.push({kind:'toggle',id:ref(e.querySelector('input')),title:own(sp),subtitle:txt(sp&&sp.querySelector('.m')),on:e.querySelector('input').checked});return}
      if(e.classList.contains('srow')){var s1=e.querySelector('span');var info=e.style.cursor==='default'||!e.getAttribute('onclick');cur.rows.push({kind:info?'info':'row',id:ref(e),title:own(s1),subtitle:txt(s1&&s1.querySelector('.m')),danger:e.classList.contains('dng')});return}
      if(e.classList.contains('okl')){cur.rows.push({kind:'row',id:ref(e),title:txt(e)});return}
      if(e.id==='okey'){if(e.hidden)return;var m=e.querySelector('.m'),inp=e.querySelector('input'),b=e.querySelector('button');cur.footer=txt(m);cur.rows.push({kind:'field',id:ref(e),placeholder:inp?inp.placeholder:'',button:txt(b)});return}
      if(e.classList.contains('m')){var cl=e.cloneNode(true);Array.prototype.forEach.call(cl.querySelectorAll('br'),function(b){b.replaceWith('\n')});var t=cl.textContent.split('\n').map(function(x){return x.replace(/\s+/g,' ').trim()}).join('\n');cur.footer=(cur.footer?cur.footer+'\n':'')+t.trim();return}
    });
    secs=secs.filter(function(x){return x.rows.length||x.footer});
    var c=cols();
    return {title:title,subtitle:sub,sections:secs,theme:(typeof PF!=='undefined'&&PF.theme)||'auto',ts:(typeof PF!=='undefined'&&+PF.ts)||1,accent:c.acc,colors:c};
  }
  function syncSettings(){
    if(failed)return;
    var I=document.getElementById('info'),open=I&&I.style.display==='block'&&I.classList.contains('setw');
    var bd=open&&I.querySelector('.ibody');
    if(open&&bd&&bd.children.length){
      html.classList.add('native-settings');
      var spec=JSON.stringify(settingsSpec(bd));
      if(spec!==lastSet||!setOn){lastSet=spec;setOn=true;GlassBar.settings({spec:spec}).catch(function(){})}
    }else if(setOn){
      setOn=false;lastSet='';html.classList.remove('native-settings');
      GlassBar.settings({spec:''}).catch(function(){});
    }
  }
  GlassBar.addListener('settings',function(e){
    var id=e&&e.id,v=e&&e.value;
    if(id==='close'){setOn=false;lastSet='';html.classList.remove('native-settings');if(typeof window.closeInfo==='function')window.closeInfo();return}
    var el=REFS[+id];if(!el)return;
    if(el.classList&&el.classList.contains('seg')){var b=el.querySelectorAll('button')[+v];if(b)b.click()}
    else if(el.tagName==='INPUT'){el.checked=v==='1';el.dispatchEvent(new Event('change',{bubbles:true}))}
    else if(el.id==='okey'){var i=el.querySelector('input'),k=el.querySelector('button');if(i)i.value=v;if(k)k.click()}
    else if(/#csv/.test(el.getAttribute('onclick')||'')){if(window.closeInfo)window.closeInfo();setTimeout(function(){var f=document.getElementById('csv');if(f)f.click()},450)}
    else el.click();
    setTimeout(syncSettings,60);setTimeout(syncSettings,320);soon();
  });
  function start(){
    new MutationObserver(soon).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
    ['info','info2','info3'].forEach(function(i){var e=document.getElementById(i);if(e)new MutationObserver(soon).observe(e,{attributes:true,attributeFilter:['style','class']})});
    var I=document.getElementById('info');if(I)new MutationObserver(function(){clearTimeout(setT);setT=setTimeout(syncSettings,30)}).observe(I,{attributes:true,attributeFilter:['style','class'],childList:true,subtree:true,characterData:true});
    addEventListener('resize',soon);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',soon);
    send();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
