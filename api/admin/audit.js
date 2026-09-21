import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['GET'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});
  if(!hasPermission(ctx,'VIEW_AUDIT_LOG')) return json(res,403,{error:'Audit log permission required.'});
  const {data,error}=await ctx.client.from('audit_logs').select('id,actor_id,action,target_type,target_id,metadata,created_at').order('created_at',{ascending:false}).limit(200);
  if(error) return json(res,500,{error:error.message});
  return json(res,200,{logs:data||[]});
}
