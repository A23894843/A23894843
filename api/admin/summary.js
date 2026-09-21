import { getAdminContext, json, method, hasPermission } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['GET'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});

  const out={role:ctx.profile.role,status:ctx.profile.status,permissions:ctx.isOwner?['ALL']:ctx.permissions,counts:{}};
  const jobs=[];
  if(hasPermission(ctx,'MANAGE_ADMINS')) jobs.push(ctx.client.from('profiles').select('id',{count:'exact',head:true}).then(r=>out.counts.admins=r.count||0));
  if(hasPermission(ctx,'MANAGE_DOCUMENTS')) jobs.push(ctx.client.from('documents').select('id',{count:'exact',head:true}).then(r=>out.counts.documents=r.count||0));
  if(hasPermission(ctx,'VIEW_QUERIES')) jobs.push(ctx.client.from('queries').select('id',{count:'exact',head:true}).eq('status','open').then(r=>out.counts.openQueries=r.count||0));
  if(hasPermission(ctx,'VIEW_AUDIT_LOG')) jobs.push(ctx.client.from('audit_logs').select('id',{count:'exact',head:true}).then(r=>out.counts.auditLogs=r.count||0));
  await Promise.all(jobs);
  return json(res,200,out);
}
