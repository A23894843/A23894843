import { getServerClient, json, method } from '../lib/admin-server.js';

function clean(value,max){return String(value??'').trim().slice(0,max)}
function validEmail(email){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}

export default async function handler(req,res){
  if(!method(req,res,['POST'])) return;
  const {name,email,subject,message,turnstileToken,website}=req.body||{};
  if(clean(website,100)) return json(res,200,{ok:true,message:'Thank you.'});
  if(!turnstileToken) return json(res,400,{error:'CAPTCHA verification is required.'});
  const secret=process.env.TURNSTILE_SECRET_KEY;
  if(!secret) return json(res,503,{error:'CAPTCHA is not configured on the server.'});
  const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,response:turnstileToken,remoteip:req.headers['x-forwarded-for']?.split(',')[0]?.trim()})}).catch(()=>null);
  const result=verification?await verification.json().catch(()=>null):null;
  if(!result?.success || (result.action && result.action!=='contact')) return json(res,403,{error:'CAPTCHA verification failed. Please try again.'});
  const n=clean(name,100),e=clean(email,320),s=clean(subject,160),m=clean(message,8000);
  if(!n||!validEmail(e)||!s||!m) return json(res,400,{error:'Please complete all fields with valid information.'});
  const client=getServerClient();
  const windowStart=new Date(Date.now()-10*60*1000).toISOString();
  const {count:recentCount}=await client.from('queries').select('id',{count:'exact',head:true}).eq('email',e).gte('created_at',windowStart);
  if((recentCount||0)>=5) return json(res,429,{error:'Too many messages from this email. Please try again later.'});
  const {data,error}=await client.from('queries').insert({name:n,email:e,subject:s,message:m}).select('id').single();
  if(error){console.error(error);return json(res,500,{error:'Unable to store your query.'});}
  return json(res,201,{ok:true,id:data.id,message:'Your query has been received. Thank you.'});
}
