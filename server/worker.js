// Oenograph server: serves the app's files and runs a small Claude relay for invited friends.
// The owner's Anthropic key lives in the ANTHROPIC_KEY secret; the invite list in ALLOWED_EMAILS.
import {DurableObject} from 'cloudflare:workers';

const PROJECT='oenograph';                 // Firebase project id
const DAILY_CAP=30;                        // Claude requests per person per day
const MAX_TOKENS=4096;
const MODELS={quick:'claude-haiku-4-5-20251001',default:'claude-sonnet-5-5'}; // no Opus on the shared key
const JWKS_URL='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

const json=(o,s=200)=>new Response(JSON.stringify(o),{status:s,headers:{'content-type':'application/json','cache-control':'no-store'}});

/* ---------- Firebase sign-in check (RS256 ID token) ---------- */
let jwks=null,jwksAt=0;
async function keys(env){
  if(env&&env.TEST_JWKS)return JSON.parse(env.TEST_JWKS).keys; // local testing only
  if(jwks&&Date.now()-jwksAt<3600e3)return jwks;
  const r=await fetch(JWKS_URL);if(!r.ok)throw new Error('jwks');
  jwks=(await r.json()).keys||[];jwksAt=Date.now();return jwks;
}
const b64u=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
async function verify(token,env){
  const p=String(token||'').split('.');if(p.length!==3)return null;
  let h,c;try{h=JSON.parse(new TextDecoder().decode(b64u(p[0])));c=JSON.parse(new TextDecoder().decode(b64u(p[1])))}catch(e){return null}
  if(h.alg!=='RS256'||!h.kid)return null;
  const now=Date.now()/1000;
  if(c.aud!==PROJECT||c.iss!=='https://securetoken.google.com/'+PROJECT||!c.sub||c.exp<now||c.iat>now+300)return null;
  const jwk=(await keys(env)).find(k=>k.kid===h.kid);if(!jwk)return null;
  const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
  const ok=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64u(p[2]),new TextEncoder().encode(p[0]+'.'+p[1]));
  return ok?{uid:c.sub,email:String(c.email||'').toLowerCase()}:null;
}
const invited=(env,email)=>!!email&&String(env.ALLOWED_EMAILS||'').toLowerCase().split(/[\s,;]+/).filter(Boolean).includes(email);

/* ---------- daily counter, one per person ---------- */
export class Usage extends DurableObject{
  async hit(day,cap){
    const n=(await this.ctx.storage.get(day))||0;
    if(n>=cap)return {ok:false,used:n};
    await this.ctx.storage.put(day,n+1);
    if(n===0){const all=await this.ctx.storage.list();for(const k of all.keys())if(k!==day)await this.ctx.storage.delete(k)}
    return {ok:true,used:n+1};
  }
  async peek(day){return (await this.ctx.storage.get(day))||0}
}
const today=()=>new Date().toISOString().slice(0,10);

async function api(req,env,path){
  const who=await verify((req.headers.get('authorization')||'').replace(/^Bearer\s+/i,''),env);
  if(!who)return json({error:'signin',message:'Please sign in again.'},401);
  if(!invited(env,who.email))return json({error:'not_invited',message:'Claude features aren’t turned on for this account.'},403);
  if(!env.ANTHROPIC_KEY)return json({error:'not_setup',message:'Claude features aren’t set up yet.'},503);
  const stub=env.USAGE.get(env.USAGE.idFromName(who.uid));
  if(path==='/api/claude/status'&&req.method==='GET'){const used=await stub.peek(today());return json({ok:true,cap:DAILY_CAP,used})}
  if(path!=='/api/claude'||req.method!=='POST')return json({error:'not_found'},404);
  // The body is the "messages" array as text; model and size are always chosen here, not by the app.
  const raw=await req.text();
  if(raw.length>8e6||raw[0]!=='[')return json({error:'bad_request',message:'That request couldn’t be sent.'},400);
  const u=new URL(req.url),model=MODELS[u.searchParams.get('tier')]||MODELS.default,mt=Math.min(MAX_TOKENS,Math.max(1,+u.searchParams.get('max')||MAX_TOKENS));
  const h=await stub.hit(today(),DAILY_CAP);
  if(!h.ok)return json({error:'daily_limit',message:'You’ve reached today’s Claude limit. It resets tomorrow.'},429);
  const body='{"messages":'+raw+',"model":'+JSON.stringify(model)+',"max_tokens":'+mt+'}'; // later keys win
  const r=await fetch(env.TEST_UPSTREAM||'https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':env.ANTHROPIC_KEY,'anthropic-version':'2023-06-01'},body});
  return new Response(r.body,{status:r.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
}

export default {
  async fetch(req,env){
    const path=new URL(req.url).pathname;
    if(path.startsWith('/api/')){
      try{return await api(req,env,path)}catch(e){return json({error:'server',message:'Something went wrong on the server.'},500)}
    }
    return env.ASSETS.fetch(req);
  }
};
