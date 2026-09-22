import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['GET','POST'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});

  if(req.method==='GET'){
    const {data:permissions,error:permError}=await ctx.client.from('admin_permissions').select('permission').eq('user_id',ctx.user.id);
    if(permError) return json(res,500,{error:permError.message});
    return json(res,200,{profile:{...ctx.profile,email:ctx.user.email||'',permissions:(permissions||[]).map(x=>x.permission)}});
  }

  if(!hasPermission(ctx,'MANAGE_PROFILE')) return json(res,403,{error:'Profile management permission required.'});
  const displayName=String(req.body?.display_name??'').trim().slice(0,80);
  const phone=String(req.body?.phone??'').trim().slice(0,40);
  if(!displayName) return json(res,400,{error:'Display name is required.'});
  const {error}=await ctx.client.from('profiles').update({display_name:displayName,phone:phone||null}).eq('id',ctx.user.id);
  if(error) return json(res,400,{error:error.message});
  return json(res,200,{ok:true});
}
