import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['GET','POST'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});
  if(req.method==='GET'){
    const {data,error}=await ctx.client.rpc('admin_my_profile');
    if(error) return json(res,500,{error:error.message});
    return json(res,200,{profile:data?.[0]||null});
  }
  if(!hasPermission(ctx,'MANAGE_PROFILE')) return json(res,403,{error:'Profile management permission required.'});
  const displayName=String(req.body?.display_name??'').trim().slice(0,80);
  const phone=String(req.body?.phone??'').trim().slice(0,40);
  const {error}=await ctx.client.rpc('admin_update_profile',{p_display_name:displayName,p_phone:phone});
  if(error) return json(res,400,{error:error.message});
  return json(res,200,{ok:true});
}
