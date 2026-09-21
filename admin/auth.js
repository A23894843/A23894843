/* =========================================================
   SUPABASE AUTH + ADMIN CONTROL
   Do not put secrets in this file. /admin/config.js remains untouched.
========================================================= */
let sb=null;
function setMessage(text,type='error'){const el=document.getElementById('message')||document.getElementById('msg');if(!el)return;el.textContent=text;el.className=`message ${type}`.trim();}
function init(){
  if(!window.supabase){setMessage('Supabase library could not be loaded.');return false;}
  if(typeof SUPABASE_URL==='undefined'||typeof SUPABASE_ANON_KEY==='undefined'||!SUPABASE_URL||!SUPABASE_ANON_KEY){setMessage('Supabase configuration is unavailable.');return false;}
  if(!sb) sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY);
  return true;
}
async function verifyCaptcha(token,action){
  if(!token) throw new Error('Complete the CAPTCHA verification.');
  const r=await fetch('/api/turnstile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,action})});
  const data=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(data.error||'CAPTCHA verification failed.');
  return true;
}
async function login(email,password,turnstileToken){
  if(!init())return false;
  try{
    await verifyCaptcha(turnstileToken,'login');
    const result=await sb.auth.signInWithPassword({email:String(email).trim().toLowerCase(),password});
    if(result.error)throw result.error;
    const user=result.data.user;if(!user)throw new Error('Unable to retrieve user account.');
    const profile=await sb.from('profiles').select('role,status').eq('id',user.id).single();
    if(profile.error)throw profile.error;
    if(profile.data.status!=='approved'||!['owner','admin','support'].includes(profile.data.role)){await sb.auth.signOut();throw new Error('Account is pending, disabled, or not authorized.');}
    window.location.href='/admin/dashboard.html';return true;
  }catch(error){setMessage(error.message||'Unable to sign in.');return false;}
}
async function requestPasswordReset(email,turnstileToken){
  if(!init())return false;
  try{
    await verifyCaptcha(turnstileToken,'password-reset');
    const result=await sb.auth.resetPasswordForEmail(String(email||'').trim().toLowerCase(),{redirectTo:`${window.location.origin}/reset-password.html`});
    if(result.error)throw result.error;return true;
  }catch(error){setMessage(error.message||'Unable to send reset link.');return false;}
}
window.requestPasswordReset=requestPasswordReset;
async function signup(name,email,password,confirmPassword,turnstileToken){
  if(!init())return false;
  if(password!==confirmPassword){setMessage('Passwords do not match.');return false;}
  if(password.length<15){setMessage('Use at least 15 characters.');return false;}
  try{
    await verifyCaptcha(turnstileToken,'signup');
    const result=await sb.auth.signUp({email:String(email).trim().toLowerCase(),password,options:{data:{display_name:String(name).trim().slice(0,80)}}});
    if(result.error)throw result.error;
    if(!result.data.user)throw new Error('Account could not be created.');
    setMessage('Registration submitted. Verify your email if required, then wait for admin approval.','success');return true;
  }catch(error){setMessage(error.message||'Unable to create account.');return false;}
}
async function getCurrentUser(){if(!init())return null;const r=await sb.auth.getUser();return r.data?.user||null;}
async function getAdminContext(){
  if(!init())return null;
  const user=await getCurrentUser();if(!user)return null;
  const p=await sb.from('profiles').select('id,display_name,phone,role,status,created_at,updated_at').eq('id',user.id).single();
  if(p.error||!p.data||p.data.status!=='approved')return null;
  const perms=await sb.from('admin_permissions').select('permission').eq('user_id',user.id);
  return {user,profile:p.data,permissions:(perms.data||[]).map(x=>x.permission),isOwner:p.data.role==='owner'};
}
async function guard(){const ctx=await getAdminContext();if(!ctx){await logout(false);return false;}return true;}
async function requirePermission(permission){const ctx=await getAdminContext();if(!ctx){await logout(false);return false;}if(!ctx.isOwner&&!ctx.permissions.includes(permission)){window.location.href='/admin/dashboard.html';return false;}return true;}
async function logout(redirect=true){try{if(!sb)init();if(sb)await sb.auth.signOut();}finally{if(redirect)window.location.href='/admin/login.html';}}
async function docs(){if(!init())throw new Error('Supabase is not configured.');const r=await sb.from('documents').select('*').order('created_at',{ascending:false});if(r.error)throw r.error;return r.data||[];}
async function uploadDoc(title,type,file,downloadAllowed=false,visibility='public'){
  if(!init())throw new Error('Supabase is not configured.');if(!title.trim())throw new Error('Document title is required.');if(!file)throw new Error('Please select a file.');
  if(visibility==='private')downloadAllowed=false;if(!['cv','report','certificate'].includes(type))throw new Error('Invalid document type.');
  const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=crypto.randomUUID()+'-'+safe;
  const up=await sb.storage.from('documents').upload(path,file,{upsert:false,contentType:file.type||'application/octet-stream'});if(up.error)throw up.error;
  try{const u=await sb.auth.getUser();if(!u.data?.user)throw new Error('Authentication session expired.');const r=await sb.from('documents').insert({title:title.trim(),type,storage_path:path,download_allowed:Boolean(downloadAllowed),visibility,created_by:u.data.user.id});if(r.error)throw r.error;return true;}catch(e){await sb.storage.from('documents').remove([path]);throw e;}
}
async function getAdminDocumentPreviewUrl(path){if(!init())throw new Error('Supabase is not configured.');const r=await sb.storage.from('documents').createSignedUrl(path,300);if(r.error)throw r.error;return r.data.signedUrl;}
async function updateDocAccess(id,downloadAllowed){if(!init())throw new Error('Supabase is not configured.');const r=await sb.from('documents').update({download_allowed:Boolean(downloadAllowed)}).eq('id',id);if(r.error)throw r.error;return true;}
async function deleteDoc(id,path){if(!init())throw new Error('Supabase is not configured.');const r=await sb.from('documents').delete().eq('id',id);if(r.error)throw r.error;if(path){const s=await sb.storage.from('documents').remove([path]);if(s.error)throw s.error;}return true;}
window.verifyCaptcha=verifyCaptcha;window.getAdminContext=getAdminContext;window.requirePermission=requirePermission;window.guard=guard;window.logout=logout;window.docs=docs;window.uploadDoc=uploadDoc;window.getAdminDocumentPreviewUrl=getAdminDocumentPreviewUrl;window.updateDocAccess=updateDocAccess;window.deleteDoc=deleteDoc;
