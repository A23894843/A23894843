import { json, method } from '../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['POST'])) return;
  const secret=process.env.TURNSTILE_SECRET_KEY;
  if(!secret) return json(res,503,{error:'CAPTCHA is not configured on the server.'});
  const token=typeof req.body?.token==='string'?req.body.token.trim():'';
  const action=typeof req.body?.action==='string'?req.body.action.trim():'';
  if(!token) return json(res,400,{error:'CAPTCHA verification is required.'});
  try{
    const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret,response:token,remoteip:req.headers['x-forwarded-for']?.split(',')[0]?.trim()})});
    const result=await response.json();
    if(!result.success) return json(res,403,{error:'CAPTCHA verification failed.',codes:result['error-codes']||[]});
    if(process.env.TURNSTILE_HOSTNAME && result.hostname && result.hostname!==process.env.TURNSTILE_HOSTNAME) return json(res,403,{error:'CAPTCHA hostname mismatch.'});
    if(action && result.action && result.action!==action) return json(res,403,{error:'CAPTCHA action mismatch.'});
    return json(res,200,{ok:true});
  }catch(error){console.error('Turnstile verification:',error);return json(res,502,{error:'CAPTCHA service unavailable.'});}
}
