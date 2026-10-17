// Oenograph standalone layer: accounts, cloud sync, photos, optional Claude key.
// It provides the same small "window.claude" surface the app was written against,
// so the app code itself barely changes.
import {initializeApp} from 'firebase/app';
import {getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,sendPasswordResetEmail,signOut,deleteUser,reauthenticateWithCredential,EmailAuthProvider} from 'firebase/auth';
import {initializeFirestore,persistentLocalCache,persistentMultipleTabManager,doc,getDoc,getDocFromCache,setDoc,deleteDoc,collection,getDocs,writeBatch,terminate,clearIndexedDbPersistence} from 'firebase/firestore';

const firebaseConfig={
  apiKey:"AIzaSyCrJ_OyhjxzG5rQa8gzwT2hM5u14FeJJzI",
  authDomain:"oenograph.firebaseapp.com",
  projectId:"oenograph",
  storageBucket:"oenograph.firebasestorage.app",
  messagingSenderId:"966833982974",
  appId:"1:966833982974:web:9c969e10c02904894ac4af"
};

const DATA_KEYS=['oeno','oenoC','oenoP','oenoX','oenoI','oenoD','oenoL','oenoW'];
const LS={
  get:k=>{try{return localStorage.getItem(k)}catch(e){return null}},
  set:(k,v)=>{try{localStorage.setItem(k,v)}catch(e){}},
  del:k=>{try{localStorage.removeItem(k)}catch(e){}}
};
// Start on the Cellar tab after signing in, signing out or creating an account.
const homeTab=()=>{try{sessionStorage.setItem('oenoT','cellar')}catch(e){}};
const timeout=(ms,msg)=>new Promise((_,no)=>setTimeout(()=>no(new Error(msg||'timeout')),ms));

/* ---------- local photo store (IndexedDB), also read by the service worker ---------- */
const idb=()=>new Promise((ok,no)=>{const r=indexedDB.open('oeno-photos',1);r.onupgradeneeded=()=>r.result.createObjectStore('p',{keyPath:'id'});r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error)});
const tx=async(mode,fn)=>{const d=await idb();return new Promise((ok,no)=>{const t=d.transaction('p',mode),s=t.objectStore('p'),r=fn(s);t.oncomplete=()=>{d.close();ok(r&&r.result)};t.onerror=()=>{d.close();no(t.error)}})};
const photoPut=(id,blob)=>tx('readwrite',s=>s.put({id,blob}));
const photoGet=id=>tx('readonly',s=>s.get(id));
const photoDel=id=>tx('readwrite',s=>s.delete(id));
const photoClear=()=>tx('readwrite',s=>s.clear());
const photoHas=async id=>!!(await photoGet(id));
const toDataURL=b=>new Promise((ok,no)=>{const f=new FileReader();f.onload=()=>ok(f.result);f.onerror=()=>no(f.error);f.readAsDataURL(b)});
const hex=()=>[...crypto.getRandomValues(new Uint8Array(16))].map(x=>x.toString(16).padStart(2,'0')).join('');

/* ---------- boot ---------- */
let resolveReady;
const ready=window.claudeReady||new Promise(r=>{resolveReady=r});
if(window.__cr)resolveReady=window.__cr;
const finish=v=>{(resolveReady||(()=>{}))(v);document.documentElement.classList.remove('gate')};

let app,auth,fs,user=null;
const OENO=window.OENO={
  local:LS.get('oenoLocal')==='1',
  get email(){return user?user.email:''},
  get signedIn(){return !!user},
  hasKey:()=>!!LS.get('oenoKey'),
  get hasServer(){return srvOK},
  async setKey(k){
    k=(k||'').trim();
    if(!/^sk-ant-/.test(k))throw new Error('That doesn’t look like an Anthropic key. It should start with sk-ant-');
    await callClaude('Reply with the single word: ok',{modelTier:'quick',maxTokens:8,key:k});
    LS.set('oenoKey',k);location.reload()
  },
  clearKey(){LS.del('oenoKey');location.reload()},
  async signOut(){
    try{if(auth)await signOut(auth)}catch(e){}
    // Keep the local copy so nothing is lost if the cloud copy was never saved.
    // It is only cleared when a different account signs in.
    LS.del('oenoLocal');LS.del('oenoSrv');homeTab();
    location.reload()
  },
  goLogin(){LS.del('oenoLocal');location.reload()},
  // Permanently delete the signed-in account and everything stored for it.
  async deleteAccount(password){
    if(!user)throw {code:'no-user',message:'You are not signed in.'};
    try{await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,password||''))}
    catch(e){throw {code:e.code||'auth',message:ERR[e.code]||'That password isn’t right.'}}
    const uid=user.uid;
    for(const sub of ['data','photos']){
      const snap=await getDocs(collection(fs,'users',uid,sub));
      let b=writeBatch(fs),n=0;
      for(const d of snap.docs){b.delete(d.ref);if(++n===400){await b.commit();b=writeBatch(fs);n=0}}
      if(n)await b.commit();
    }
    await deleteUser(user);
    DATA_KEYS.concat(['oenoUid','oenoLocal','oenoKey','oenoAIok','oenoSrv']).forEach(LS.del);
    try{await photoClear()}catch(e){}
    try{await terminate(fs);await clearIndexedDbPersistence(fs)}catch(e){}
    homeTab();location.reload();
  }
};

/* ---------- Claude (user's own key) ---------- */
const MODELS={quick:'claude-haiku-4-5-20251001',default:'claude-sonnet-5-5',complex:'claude-opus-5-5'};
const b64=async b=>(await toDataURL(b)).split(',')[1];
// Claude via the owner's server, for invited accounts without their own key.
let srvOK=LS.get('oenoSrv')==='1';
async function checkServer(){
  if(!user||navigator.onLine===false)return srvOK;
  try{
    const r=await Promise.race([fetch('/api/claude/status',{headers:{authorization:'Bearer '+await user.getIdToken()}}),timeout(5000)]);
    srvOK=r.ok;
    if(r.status===401||r.status===403||r.status===503||r.ok)LS.set('oenoSrv',srvOK?'1':'0');
  }catch(e){}
  return srvOK;
}
async function callClaude(input,opts={}){
  const key=opts.key||LS.get('oenoKey'),viaSrv=!key&&user&&srvOK;
  if(!key&&!viaSrv)throw {code:'not_granted',message:'Add your Claude key in Settings first.'};
  let messages;
  if(Array.isArray(input))messages=input.map(m=>({role:m.role,content:m.content}));
  else{
    const content=[];
    const imgs=opts.images?(Array.isArray(opts.images)?opts.images:[opts.images]):[];
    for(const im of imgs)content.push({type:'image',source:{type:'base64',media_type:im.type||'image/jpeg',data:await b64(im)}});
    content.push({type:'text',text:String(input)});
    messages=[{role:'user',content}];
  }
  let r;
  if(viaSrv){
    try{
      r=await fetch('/api/claude?tier='+encodeURIComponent(opts.modelTier||'default')+'&max='+(opts.maxTokens||4096),{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+await user.getIdToken()},body:JSON.stringify(messages)});
    }catch(e){throw {code:'network',message:'Couldn’t reach Claude. Check your connection.'}}
    if(!r.ok){
      let j={};try{j=await r.json()}catch(e){}
      if(j.error==='daily_limit')throw {code:'rate_limited',message:j.message};
      if(j.error==='not_invited'||j.error==='signin'){if(j.error==='not_invited')LS.set('oenoSrv','0');throw {code:'not_granted',message:j.message}}
      if(r.status===429)throw {code:'rate_limited',message:'Claude is busy. Try again shortly.'};
      throw {code:'error',message:(j.error&&j.error.message)||j.message||('Claude error '+r.status)};
    }
    const j=await r.json();
    return {text:(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''),truncated:j.stop_reason==='max_tokens'};
  }
  try{
    r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{
      'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model:MODELS[opts.modelTier]||MODELS.default,max_tokens:opts.maxTokens||4096,messages})});
  }catch(e){throw {code:'network',message:'Couldn’t reach Claude. Check your connection.'}}
  if(!r.ok){
    let m='';try{m=(await r.json()).error.message||''}catch(e){}
    if(r.status===401||r.status===403)throw {code:'not_granted',message:'Your Claude key was rejected. Check it in Settings.'};
    if(r.status===429)throw {code:'rate_limited',message:'Claude is busy or your limit was reached. Try again shortly.'};
    if(/credit balance/i.test(m))throw {code:'billing',message:'Your Anthropic account is out of credit.'};
    throw {code:'error',message:m||('Claude error '+r.status)};
  }
  const j=await r.json();
  return {text:(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''),truncated:j.stop_reason==='max_tokens'};
}
function parseJSON(t){
  t=String(t).replace(/```(?:json)?/gi,'').trim();
  const a=t.search(/[\[{]/),z=Math.max(t.lastIndexOf('}'),t.lastIndexOf(']'));
  if(a<0||z<a)throw {code:'parse',message:'Claude’s answer couldn’t be read. Try again.'};
  try{return JSON.parse(t.slice(a,z+1))}catch(e){throw {code:'parse',message:'Claude’s answer couldn’t be read. Try again.'}}
}
// Ask once before anything is sent to Anthropic (Apple guideline 5.1.2).
async function aiConsent(){
  if(LS.get('oenoAIok')==='1')return;
  const ask=window.choose;
  if(typeof ask!=='function')return;
  const v=await ask('Send to Claude?','To suggest pairings, drink windows and notes, Oenograph sends details of the wines involved (producer, name, vintage, region, grapes and similar) to Anthropic’s Claude. When you scan a label, the photo is sent too. Your email, account and location are never shared.',[['ok','Allow',1],['no','Don’t allow']]);
  if(v!=='ok')throw {code:'declined',message:'Nothing was sent to Claude.'};
  LS.set('oenoAIok','1');
}
function makeSample(){
  const s=async(i,o)=>{await aiConsent();return callClaude(i,o||{})};
  s.json=async(i,o)=>{await aiConsent();return parseJSON((await callClaude(i,o||{})).text)};
  s.limits=async()=>({images:{mediaTypes:['image/jpeg','image/png','image/gif','image/webp'],maxInputBytes:3500000}});
  return s;
}

/* ---------- cloud database (one document per account) ---------- */
function makeDb(){
  const ref=p=>{const name=p.split('/').pop();return doc(fs,'users',user.uid,'data',name)};
  return {doc:p=>({
    async get(){
      const r=ref(p);let s;
      if(navigator.onLine===false){s=await getDocFromCache(r)}
      else{try{s=await Promise.race([getDoc(r),timeout(9000)])}catch(e){try{s=await getDocFromCache(r)}catch(e2){throw e}}}
      return {exists:s.exists(),data:()=>s.data()};
    },
    async set(data){
      if(navigator.onLine===false)throw new Error('offline');
      await Promise.race([setDoc(ref(p),data),timeout(20000,'sync timed out (can\u2019t reach the database)')]);
    }
  })};
}

/* ---------- photos ---------- */
const photoDoc=id=>doc(fs,'users',user.uid,'photos',id);
function makeAssets(){
  return {
    async upload(blob){
      const id=hex();
      await photoPut(id,blob);
      if(user){
        toDataURL(blob).then(d=>{
          if(d.length>900000)return; // too big for one cloud document: stays on this device
          return setDoc(photoDoc(id),{d,ct:blob.type||'image/jpeg',t:Date.now()});
        }).catch(()=>{});
      }
      return {id,url:'_blob/'+id,sizeBytes:blob.size,contentType:blob.type};
    },
    async delete(id){
      try{await photoDel(id)}catch(e){}
      if(user)deleteDoc(photoDoc(id)).catch(()=>{});
    }
  };
}
async function pullPhotos(ids){
  if(!user||!ids||!ids.length||navigator.onLine===false)return 0;
  let n=0;const q=ids.slice();
  const worker=async()=>{while(q.length){
    const id=q.shift();
    try{
      if(await photoHas(id))continue;
      const s=await getDoc(photoDoc(id));
      if(s.exists()){const b=await (await fetch(s.data().d)).blob();await photoPut(id,b);n++}
    }catch(e){}
  }};
  await Promise.all([worker(),worker(),worker()]);
  return n;
}
// Push any local photos the cloud doesn't have yet (e.g. added while offline).
async function pushPhotos(ids){
  if(!user||!ids||navigator.onLine===false)return;
  for(const id of ids){
    try{
      const s=await getDoc(photoDoc(id));
      if(s.exists())continue;
      const row=await photoGet(id);if(!row)continue;
      const d=await toDataURL(row.blob);if(d.length>900000)continue;
      await setDoc(photoDoc(id),{d,ct:row.blob.type||'image/jpeg',t:Date.now()});
    }catch(e){}
  }
}

/* ---------- downloads ---------- */
const downloads={
  async save({filename,data}){
    const blob=data instanceof Blob?data:new Blob([data],{type:/\.json$/.test(filename)?'application/json':'text/plain'});
    const file=new File([blob],filename,{type:blob.type});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      try{await navigator.share({files:[file]});return}
      catch(e){if(e&&e.name==='AbortError')throw {code:'declined'}}
    }
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;
    document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},4000);
  }
};

/* ---------- login screen ---------- */
function injectStyle(){
  const s=document.createElement('style');
  s.textContent=`
  html.gate #app{visibility:hidden}
  #gate{position:fixed;inset:0;z-index:99999;background:var(--bg,#faf8f5);color:var(--fg,#1f1b18);display:flex;align-items:center;justify-content:center;padding:24px;overflow:auto;font:16px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif}
  #gate .gc{width:100%;max-width:340px;text-align:center}
  #gate h1{font:400 46px/1.1 Italiana,Georgia,serif;margin:0 0 6px;letter-spacing:.6px}
  #gate h1 .oo{letter-spacing:-.11em}
  #gate p{margin:0 0 22px;color:var(--mut,#8a817a);font-size:15px}
  #gate input{display:block;width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:13px 14px;margin:0 0 10px;border:1px solid var(--line,#e8e2db);border-radius:12px;background:var(--card,#fff);color:inherit;outline:none;-webkit-appearance:none}
  #gate input:focus{border-color:var(--acc,#7a2e3b)}
  #gate button{font:inherit;font-size:16px;cursor:pointer;border:0;border-radius:12px;padding:13px 14px;width:100%}
  #gate .pri{background:var(--acc,#7a2e3b);color:#fff;font-weight:600;margin-top:2px}
  #gate .pri:disabled{opacity:.6}
  #gate .lnk{background:none;color:var(--acc,#7a2e3b);padding:10px 4px;width:auto;font-size:15px}
  #gate .mut{background:none;color:var(--mut,#8a817a);padding:8px;font-size:14px;width:auto}
  #gate .err{min-height:20px;margin:2px 0 8px;color:#b3261e;font-size:14px}
  #gate .ok{color:var(--acc,#7a2e3b)}
  #gate .row{display:flex;justify-content:space-between;align-items:center}
  @media (prefers-color-scheme:dark){#gate .err{color:#ff8a80}}`;
  document.head.appendChild(s);
}
const ERR={
  'auth/invalid-credential':'That email or password isn’t right.',
  'auth/wrong-password':'That email or password isn’t right.',
  'auth/user-not-found':'That email or password isn’t right.',
  'auth/invalid-email':'That email address doesn’t look right.',
  'auth/email-already-in-use':'An account with that email already exists. Try signing in.',
  'auth/weak-password':'Please use at least 6 characters.',
  'auth/network-request-failed':'Can’t reach the server. Check your connection.',
  'auth/too-many-requests':'Too many attempts. Wait a moment and try again.',
  'auth/missing-password':'Please enter your password.'
};
function showGate(){
  return new Promise(done=>{
    injectStyle();
    const g=document.createElement('div');g.id='gate';
    let mode='in';
    const draw=()=>{
      g.innerHTML=`<div class="gc"><h1><span class="oo">o</span>enograph</h1>
      <p>${mode==='in'?'Sign in to open your cellar on any device.':'Create an account to keep your cellar safe and in sync.'}</p>
      <form id="gf" novalidate>
        <input id="ge" type="email" inputmode="email" autocomplete="email" autocapitalize="none" autocorrect="off" placeholder="Email" aria-label="Email">
        <input id="gp" type="password" autocomplete="${mode==='in'?'current-password':'new-password'}" placeholder="Password" aria-label="Password">
        <div class="err" id="gerr" role="alert"></div>
        <button class="pri" id="gb" type="submit">${mode==='in'?'Sign in':'Create account'}</button>
      </form>
      <div class="row" style="margin-top:6px">
        <button class="lnk" id="gt" type="button">${mode==='in'?'Create an account':'I have an account'}</button>
        ${mode==='in'?'<button class="lnk" id="gr" type="button">Forgot password?</button>':''}
      </div>
      <button class="mut" id="gl" type="button" style="margin-top:14px">Use without an account<br><span style="font-size:12px">Everything stays on this device</span></button></div>`;
      const E=g.querySelector('#ge'),P=g.querySelector('#gp'),X=g.querySelector('#gerr'),B=g.querySelector('#gb');
      g.querySelector('#gt').onclick=()=>{mode=mode==='in'?'up':'in';draw()};
      const gr=g.querySelector('#gr');
      if(gr)gr.onclick=async()=>{
        X.className='err';
        if(!E.value.trim()){X.textContent='Enter your email above first.';return}
        try{await sendPasswordResetEmail(auth,E.value.trim());X.className='err ok';X.textContent='Reset link sent. Check your email.'}
        catch(e){X.textContent=ERR[e.code]||'Couldn’t send the reset email.'}
      };
      g.querySelector('#gl').onclick=()=>{LS.set('oenoLocal','1');homeTab();location.reload()};
      g.querySelector('#gf').onsubmit=async ev=>{
        ev.preventDefault();X.className='err';X.textContent='';
        if(!E.value.trim()||!P.value){X.textContent='Enter your email and password.';return}
        B.disabled=true;window.__loggingIn=1;
        try{
          if(mode==='in')await signInWithEmailAndPassword(auth,E.value.trim(),P.value);
          else await createUserWithEmailAndPassword(auth,E.value.trim(),P.value);
          const u=auth.currentUser,prev=LS.get('oenoUid');
          if(prev&&u&&prev!==u.uid){DATA_KEYS.forEach(LS.del);try{await photoClear()}catch(e){}}
          if(u)LS.set('oenoUid',u.uid);
          LS.del('oenoLocal');LS.del('oenoSrv');homeTab();
          location.reload();
        }catch(e){X.textContent=ERR[e.code]||('Something went wrong ('+(e.code||e.message||'unknown')+').');B.disabled=false;window.__loggingIn=0}
      };
    };
    draw();document.body.appendChild(g);
  });
}

/* ---------- service worker ---------- */
if('serviceWorker' in navigator){
  addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

/* ---------- start ---------- */
addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
(async()=>{
  try{
    app=initializeApp(firebaseConfig);
    auth=getAuth(app);
    fs=initializeFirestore(app,{experimentalAutoDetectLongPolling:true,localCache:persistentLocalCache({tabManager:persistentMultipleTabManager()})});
    user=await new Promise(ok=>{let d=0;const off=onAuthStateChanged(auth,u=>{if(!d){d=1;off();ok(u)}});setTimeout(()=>{if(!d){d=1;ok(auth.currentUser)}},5000)});
    if(!user&&!OENO.local){
      // If a saved sign-in turns up late, don't leave the login screen up.
      onAuthStateChanged(auth,u=>{if(u&&!window.__loggingIn){LS.set('oenoUid',LS.get('oenoUid')||u.uid);homeTab();location.reload()}});
      await showGate();return} // page reloads after sign-in
    if(user&&!LS.get('oenoUid'))LS.set('oenoUid',user.uid);
    if(user&&!LS.get('oenoKey')){const known=LS.get('oenoSrv')!==null,p=checkServer();if(!known)await Promise.race([p,new Promise(r=>setTimeout(r,2500))])}
    const sample=(LS.get('oenoKey')||(user&&srvOK))?makeSample():null,assets=makeAssets(),db=user?makeDb():null;
    const namespaces={
      user:user?{id:async()=>user.uid,isOwner:()=>true,canEdit:()=>true}:null,
      db,sample,downloads,assets
    };
    finish({use:async n=>namespaces[n]||null,pullPhotos,pushPhotos});
  }catch(e){
    console.error('Standalone layer failed',e);
    finish({use:async n=>({downloads,assets:makeAssets()}[n]||null),pullPhotos:async()=>0,pushPhotos:async()=>{}});
  }
})();
