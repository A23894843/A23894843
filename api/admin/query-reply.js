import { getAdminContext, json, method, hasPermission, writeAudit } from '../../lib/admin-server.js';

export default async function handler(req,res){
  if(!method(req,res,['POST'])) return;
  const ctx=await getAdminContext(req);
  if(!ctx) return json(res,401,{error:'Admin authorization required.'});
  if(!hasPermission(ctx,'REPLY_QUERIES')) return json(res,403,{error:'Reply permission required.'});
  const id=String(req.body?.id||'');
  const message=String(req.body?.message||'').trim().slice(0,8000);
  if(!id||!message) return json(res,400,{error:'Query ID and reply message are required.'});
  const {data:query,error:qerr}=await ctx.client.from('queries').select('id,name,email,subject').eq('id',id).single();
  if(qerr||!query) return json(res,404,{error:'Query not found.'});

  let delivery='stored';
  let providerError=null;
  const smtpHost=process.env.SMTP_HOST;
  const smtpUser=process.env.SMTP_USER;
  const smtpPass=process.env.SMTP_PASS;
  const emailFrom=process.env.EMAIL_FROM || smtpUser;
  if(smtpHost && smtpUser && smtpPass && emailFrom){
    try{
      const nodemailer=(await import('nodemailer')).default;
      const transporter=nodemailer.createTransport({
        host:smtpHost,
        port:Number(process.env.SMTP_PORT||465),
        secure:String(process.env.SMTP_SECURE||'true')!=='false',
        auth:{user:smtpUser,pass:smtpPass}
      });
      await transporter.sendMail({
        from:emailFrom,
        to:query.email,
        replyTo:emailFrom,
        subject:`Re: ${query.subject}`,
        text:`Hello ${query.name},\n\n${message}\n\n— Abhinandan Portfolio`
      });
      delivery='sent';
    }catch(error){delivery='failed';providerError=error.message;}
  }

  const {error:insertError}=await ctx.client.from('query_replies').insert({query_id:id,admin_id:ctx.user.id,message,delivery_status:delivery});
  if(insertError) return json(res,500,{error:insertError.message});
  await ctx.client.from('queries').update({status:'replied',replied_at:new Date().toISOString(),replied_by:ctx.user.id}).eq('id',id);
  await writeAudit(ctx.client,ctx.user.id,'QUERY_REPLIED','query',id,{delivery_status:delivery});
  return json(res,200,{ok:true,delivery_status:delivery,warning:providerError||undefined});
}
