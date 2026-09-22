import { getAdminContext, json, method, hasPermission, writeAudit } from '../../lib/admin-server.js';

const ALLOWED_PERMISSIONS = [
  'VIEW_DASHBOARD','MANAGE_PROFILE','MANAGE_DOCUMENTS','VIEW_QUERIES',
  'REPLY_QUERIES','MANAGE_ADMINS','APPROVE_ADMINS','VIEW_AUDIT_LOG'
];

export default async function handler(req,res){
  if(!method(req,res,['GET','POST'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});
  if(!hasPermission(ctx,'MANAGE_ADMINS')) return json(res,403,{error:'Admin management permission required.'});

  if(req.method==='GET'){
    const [{data:profiles,error:profileError},{data:authData,error:authError}]=await Promise.all([
      ctx.client.from('profiles').select('id,display_name,phone,role,status,created_at,updated_at').order('created_at',{ascending:false}),
      ctx.client.auth.admin.listUsers({page:1,perPage:1000})
    ]);
    if(profileError) return json(res,500,{error:profileError.message});
    if(authError) return json(res,500,{error:authError.message});
    const emailById=new Map((authData?.users||[]).map(u=>[u.id,u.email||'']));
    const permissionRows=await ctx.client.from('admin_permissions').select('user_id,permission');
    if(permissionRows.error) return json(res,500,{error:permissionRows.error.message});
    const permissionsById={};
    for(const row of permissionRows.data||[])(permissionsById[row.user_id]??=[]).push(row.permission);
    const users=(profiles||[]).map(p=>({
      ...p,email:emailById.get(p.id)||'',permissions:permissionsById[p.id]||[]
    }));
    return json(res,200,{users});
  }

  const action=String(req.body?.action||'');
  const userId=String(req.body?.user_id||'');
  if(!userId) return json(res,400,{error:'User ID is required.'});
  if(userId===ctx.user.id) return json(res,400,{error:'You cannot modify your own account here.'});

  const target=await ctx.client.from('profiles').select('id,role,status').eq('id',userId).single();
  if(target.error||!target.data) return json(res,404,{error:'Admin profile not found.'});
  if(target.data.role==='owner') return json(res,403,{error:'Owner account is protected.'});

  if(action==='status'){
    if(!hasPermission(ctx,'APPROVE_ADMINS')) return json(res,403,{error:'Approval permission required.'});
    const status=String(req.body?.status||'');
    if(!['pending','approved','rejected','suspended'].includes(status)) return json(res,400,{error:'Invalid account status.'});
    const {error}=await ctx.client.from('profiles').update({status}).eq('id',userId);
    if(error) return json(res,400,{error:error.message});
    if(status==='approved'){
      await ctx.client.from('admin_permissions').upsert([
        'VIEW_DASHBOARD','MANAGE_PROFILE','MANAGE_DOCUMENTS','VIEW_QUERIES','REPLY_QUERIES'
      ].map(permission=>({user_id:userId,permission})),{onConflict:'user_id,permission'});
    }
    await writeAudit(ctx.client,ctx.user.id,'ADMIN_STATUS_CHANGED','profile',userId,{status});
    return json(res,200,{ok:true});
  }

  if(action==='permissions'){
    const permissions=Array.isArray(req.body?.permissions)?req.body.permissions.filter(p=>ALLOWED_PERMISSIONS.includes(p)):[];
    const {error:deleteError}=await ctx.client.from('admin_permissions').delete().eq('user_id',userId);
    if(deleteError) return json(res,400,{error:deleteError.message});
    if(permissions.length){
      const {error:insertError}=await ctx.client.from('admin_permissions').insert(permissions.map(permission=>({user_id:userId,permission})));
      if(insertError) return json(res,400,{error:insertError.message});
    }
    await writeAudit(ctx.client,ctx.user.id,'ADMIN_PERMISSIONS_CHANGED','profile',userId,{permissions});
    return json(res,200,{ok:true,permissions});
  }

  return json(res,400,{error:'Unknown admin action.'});
}
