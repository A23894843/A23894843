import { getAdminContext, json, method, hasPermission, writeAudit } from '../../lib/admin-server.js';

let transporterPromise=null;

async function getTransporter(){
  const smtpHost=process.env.SMTP_HOST;
  const smtpUser=process.env.SMTP_USER;
  const smtpPass=process.env.SMTP_PASS;
  if(!smtpHost||!smtpUser||!smtpPass) throw new Error('SMTP email service is not configured on the server.');
  if(!transporterPromise){
    transporterPromise=(async()=>{
      const nodemailer=(await import('nodemailer')).default;
      return nodemailer.createTransport({
        host:smtpHost,
        port:Number(process.env.SMTP_PORT||465),
        secure:String(process.env.SMTP_SECURE||'true')!=='false',
        auth:{user:smtpUser,pass:smtpPass}
      });
    })();
  }
  return transporterPromise;
}

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

  const emailFrom=process.env.EMAIL_FROM || process.env.SMTP_USER;
  if(!emailFrom) return json(res,500,{error:'EMAIL_FROM or SMTP_USER is not configured.'});

  let delivery='failed';
  let providerError=null;
  try{
    const transporter=await getTransporter();
    await transporter.sendMail({
      from:emailFrom,
      to:query.email,
      replyTo:emailFrom,
      subject:`Re: ${query.subject}`,
      text:`Hello ${query.name},\n\n${message}\n\nRegards,\nAbhinandan\nPortfolio Administration`
    });
    delivery='sent';
  }catch(error){
    providerError=error?.message||'SMTP delivery failed.';
  }

  const {error:insertError}=await ctx.client.from('query_replies').insert({
    query_id:id,
    admin_id:ctx.user.id,
    message,
    email_status:delivery
  });
  if(insertError) return json(res,500,{error:insertError.message});

  await ctx.client.from('queries').update({status:delivery==='sent'?'replied':'read'}).eq('id',id);
  await writeAudit(ctx.client,ctx.user.id,'QUERY_REPLIED','query',id,{delivery_status:delivery,error:providerError});

  if(delivery!=='sent') return json(res,502,{error:`Reply was saved, but the email could not be sent: ${providerError}` ,delivery_status:delivery});
  return json(res,200,{ok:true,delivery_status:'sent'});
}
