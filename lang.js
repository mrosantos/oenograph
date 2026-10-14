/* Oenograph language layer: swaps English UI text for the chosen language. */
(function(){
var LG=window.LANGS=window.LANGS||{},cur=null,code='en',obs=null,memo={};
try{code=(JSON.parse(localStorage.getItem('oenoS')||'{}').lang)||'en'}catch(e){}
var ATTR=['placeholder','aria-label','title','alt'];
function tc(c){
  if(!cur)return c;
  if(memo.hasOwnProperty(c))return memo[c];
  var d=cur.d,r=c;
  if(d.hasOwnProperty(c))r=d[c];
  else{
    var done=false,P=cur.p||[];
    for(var i=0;i<P.length&&!done;i++){var m=c.match(P[i][0]);if(m){var o=P[i][1].apply(null,m);if(o!=null){r=o;done=true}}}
    if(!done){
      var m2;
      if(c.indexOf(' · ')>0){r=c.split(' · ').map(tc).join(' · ')}
      else if((m2=c.match(/^(.+?)(\s*[·›])$/))&&tc(m2[1])!==m2[1]){r=tc(m2[1])+m2[2]}
      else if(cur.g&&c.indexOf(', ')>0&&(function(){var ps=c.split(', '),ch=false,o=ps.map(function(x){if(cur.g.hasOwnProperty(x)){ch=true;return cur.g[x]}return x});if(ch)r=o.join(', ');return ch})()){}
      else if((m2=c.match(/^([‹+]\s*)(.+)$/))&&tc(m2[2])!==m2[2]){r=m2[1]+tc(m2[2])}
    }
  }
  if(c.length<160)memo[c]=r;
  return r;
}
function tx(s){if(!cur)return s;var m=s.match(/^(\s*)([\s\S]*?)(\s*)$/);if(!m[2])return s;var r=tc(m[2]);return r===m[2]?s:m[1]+r+m[3]}
function skip(el){var t=el&&el.tagName;return t==='SCRIPT'||t==='STYLE'||t==='TEXTAREA'||t==='NOSCRIPT'}
function fixText(n){
  if(skip(n.parentNode))return;
  var v=n.nodeValue;if(n.__t===v)return;
  var t=cur?tx(v):v;
  if(t!==v){n.__o=v;n.__t=t;n.nodeValue=t}else{n.__o=n.__t=undefined}
}
function fixAttr(el,a){
  var v=el.getAttribute(a);if(v==null)return;
  var s=el.__a||(el.__a={}),r=s[a];
  if(r&&r.t===v)return;
  var t=cur?tx(v):v;
  if(t!==v){s[a]={o:v,t:t};el.setAttribute(a,t)}else if(r)delete s[a];
}
function walk(root){
  if(!root)return;
  if(root.nodeType===3){fixText(root);return}
  if(root.nodeType!==1||skip(root))return;
  var w=document.createTreeWalker(root,5,null),n=root;
  while(n){
    if(n.nodeType===3)fixText(n);
    else if(n.nodeType===1&&!skip(n)){for(var i=0;i<ATTR.length;i++)if(n.hasAttribute(ATTR[i]))fixAttr(n,ATTR[i])}
    n=w.nextNode();
  }
}
function restore(root){
  var w=document.createTreeWalker(root,5,null),n=root;
  while(n){
    if(n.nodeType===3){if(n.__o!==undefined){n.nodeValue=n.__o;n.__o=n.__t=undefined}}
    else if(n.nodeType===1&&n.__a){for(var a in n.__a){n.setAttribute(a,n.__a[a].o)}n.__a=null}
    n=w.nextNode();
  }
}
function start(){
  if(obs||!document.body)return;
  obs=new MutationObserver(function(rs){
    for(var i=0;i<rs.length;i++){
      var r=rs[i];
      if(r.type==='childList'){for(var j=0;j<r.addedNodes.length;j++)walk(r.addedNodes[j])}
      else if(r.type==='characterData')fixText(r.target);
      else if(r.type==='attributes'&&r.target.nodeType===1)fixAttr(r.target,r.attributeName);
    }
  });
  obs.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTR});
}
function apply(c){
  code=c||'en';memo={};
  document.documentElement.lang=code;
  var was=cur;cur=code!=='en'&&LG[code]?LG[code]:null;
  if(document.body){if(was)restore(document.body);if(cur)walk(document.body);start()}
}
var DEF_M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
window.OL={
  get code(){return cur?code:'en'},
  f:function(k){var a=[].slice.call(arguments,1);return cur&&cur.f&&cur.f[k]?cur.f[k].apply(null,a):null},
  t:tc,apply:apply,
  months:function(){return cur&&cur.months||DEF_M},
  loc:function(){return cur&&cur.loc||'en-US'},
  wd:function(){return cur&&cur.wd||['S','M','T','W','T','F','S']},
  ai:function(){return cur&&cur.ai||''}
};
['confirm','alert'].forEach(function(k){var o=window[k];window[k]=function(m){return o.call(window,tc(String(m)))}});
document.documentElement.lang=code;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){apply(code)});else apply(code);
})();
