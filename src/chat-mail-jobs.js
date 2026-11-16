// src/chat-mail-jobs.js: durable email delivery for public Live Chat agent replies.
import { withOrg } from './db.js';

const esc = value => String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');

export async function deliverChatEmailJob(pool, mailer, orgId, payload, job = {}) {
  const number=Number(payload?.number),messageId=String(payload?.messageId||''),conversationId=String(payload?.conversationId||'');
  if(!Number.isSafeInteger(number)||number<1||!messageId||!conversationId)throw new Error('Live Chat email job is missing its conversation or message reference.');
  const data=await withOrg(pool,orgId,async c=>(await c.query(`
    select cc.chat_number,cc.requester_email,cc.requester_name,cm.id,cm.kind,cm.body,cm.author_name,cm.delivery,o.name as org_name
    from chat_conversations cc
    join chat_messages cm on cm.org_id=cc.org_id and cm.conversation_id=cc.id
    join "organization" o on o.id=cc.org_id
    where cc.org_id=$1 and cc.id=$2 and cc.chat_number=$3 and cm.id=$4 and cm.kind='agent'
  `,[orgId,conversationId,number,messageId])).rows[0]||null);
  const mark=delivery=>withOrg(pool,orgId,c=>c.query("update chat_messages set delivery=$3 where org_id=$1 and id=$2 and kind='agent'",[orgId,messageId,delivery]));
  if(!data)return{skipped:true};
  if(data.delivery==='sent')return{sent:true,duplicate:true};
  if(!data.requester_email) {await mark('skipped');return{skipped:true};}
  if(!mailer||typeof mailer.ticketMail!=='function')throw new Error('Live Chat email delivery is unavailable.');
  const subject='A follow-up to your conversation with '+(data.org_name||'our support team');
  const text='Hello '+(data.requester_name||'there')+',\n\n'+(data.author_name||'A support agent')+' sent you a follow-up to Live Chat conversation #'+number+':\n\n'+data.body+'\n\nThis message is a follow-up to your website chat.\n\n'+(data.org_name||'Support');
  const html='<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202a33;line-height:1.6"><p>Hello '+esc(data.requester_name||'there')+',</p><p>'+(esc(data.author_name||'A support agent'))+' sent you a follow-up to Live Chat conversation <strong>#'+number+'</strong>:</p><div style="padding:14px 16px;border-left:3px solid #64748b;background:#f6f8fa;white-space:pre-wrap">'+esc(data.body)+'</div><p style="color:#66737d;font-size:13px">This is a follow-up to your website chat with '+esc(data.org_name||'our support team')+'.</p></body></html>';
  try{
    await mailer.ticketMail({to:data.requester_email,subject,text,html,idempotencyKey:'chat-message:'+messageId});
    await mark('sent');
    return{sent:true};
  }catch(error){
    const terminal=Number(job.attempts)>=Number(job.max_attempts||8);
    await mark(terminal?'failed':'queued');
    throw error;
  }
}
