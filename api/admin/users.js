import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['GET','POST'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});
  if(!hasPermission(ctx,'MANAGE_ADMINS')) return json(res,403,{error:'Admin management permission required.'});
  if(req.method==='GET'){
    const {data,error}=await ctx.client.rpc('admin_list_users');
    if(error) return json(res,500,{error:error.message});
    return json(res,200,{users:data||[]});
  }
  const action=String(req.body?.action||'');
  const userId=String(req.body?.user_id||'');
  if(!userId) return json(res,400,{error:'User ID is required.'});
  if(action==='status'){
    if(!hasPermission(ctx,'APPROVE_ADMINS')) return json(res,403,{error:'Approval permission required.'});
    const status=String(req.body?.status||'');
    const {error}=await ctx.client.rpc('admin_set_status',{p_user:userId,p_status:status});
    if(error) return json(res,400,{error:error.message});
    return json(res,200,{ok:true});
  }
  if(action==='permissions'){
    const permissions=Array.isArray(req.body?.permissions)?req.body.permissions:[];
    const {error}=await ctx.client.rpc('admin_set_permissions',{p_user:userId,p_permissions:permissions});
    if(error) return json(res,400,{error:error.message});
    return json(res,200,{ok:true});
  }
  return json(res,400,{error:'Unknown admin action.'});
}
