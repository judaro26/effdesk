// src/contacts.js: tenant-scoped requester profiles, company relationships and unified agent-desk search.
import { withOrg } from './db.js';

const clean = (v,n) => String(v == null ? '' : v).replace(/\u0000/g,'').trim().slice(0,n);
const idOf = v => { const n=Number(v); return Number.isInteger(n)&&n>0&&n<2**53?n:0; };
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')) && String(v).length<=254;
const fail = (error,status=400) => ({ok:false,status,error});
const like = v => '%'+clean(v,100).replace(/[\\%_]/g,m=>'\\'+m)+'%';

export async function ensureContact(c,orgId,{email,name='',companyId=null}={}) {
  const address=clean(email,254).toLowerCase();
  if(!validEmail(address))return null;
  const company=idOf(companyId);
  return (await c.query(`insert into contact_profiles(org_id,email,name,company_id,last_seen_at)
    values($1,$2,$3,$4,now())
    on conflict(org_id,email) do update set
      name=case when contact_profiles.name='' and excluded.name<>'' then excluded.name else contact_profiles.name end,
      company_id=coalesce(contact_profiles.company_id,excluded.company_id),
      last_seen_at=now(),updated_at=now()
    returning id,email,name,phone,title,company_id,notes,last_seen_at`,
    [orgId,address,clean(name,100),company||null])).rows[0]||null;
}

export const contactForEmail = (pool,orgId,email) => withOrg(pool,orgId,async c=>{
  const address=clean(email,254).toLowerCase();
  if(!validEmail(address))return {ok:false,status:400,error:'Enter a valid email address.'};
  const row=await ensureContact(c,orgId,{email:address});
  const detail=(await c.query(`select p.*,k.name company_name,k.domain company_domain,
    (select count(*)::int from tickets t where t.org_id=p.org_id and lower(t.requester_email)=p.email) ticket_count
    from contact_profiles p left join clients k on k.org_id=p.org_id and k.id=p.company_id
    where p.org_id=$1 and p.id=$2`,[orgId,row.id])).rows[0];
  const tickets=(await c.query(`select number,subject,status,priority,updated_at from tickets
    where org_id=$1 and lower(requester_email)=$2 order by updated_at desc limit 20`,[orgId,address])).rows;
  return {ok:true,contact:detail,tickets};
});

export const listContacts = (pool,orgId,q='') => withOrg(pool,orgId,async c=>{
  const term=clean(q,100),rows=(await c.query(`select p.id,p.name,p.email,p.phone,p.title,p.company_id,k.name company_name,
    (select count(*)::int from tickets t where t.org_id=p.org_id and lower(t.requester_email)=p.email) tickets,
    p.last_seen_at
    from contact_profiles p left join clients k on k.org_id=p.org_id and k.id=p.company_id
    where p.org_id=$1 and ($2='' or p.name ilike $3 or p.email ilike $3 or k.name ilike $3)
    order by p.last_seen_at desc,p.name limit 300`,[orgId,term,like(term)])).rows;
  return {ok:true,contacts:rows};
});

export const saveContact = (pool,orgId,b) => withOrg(pool,orgId,async c=>{
  const email=clean(b.email,254).toLowerCase(),name=clean(b.name,100),phone=clean(b.phone,60),title=clean(b.title,100),notes=String(b.notes||'').replace(/\u0000/g,'').slice(0,5000),companyId=b.companyId?idOf(b.companyId):null;
  if(!validEmail(email))return fail('Enter a valid contact email address.');
  if(companyId&&!(await c.query('select 1 from clients where org_id=$1 and id=$2',[orgId,companyId])).rowCount)return fail('Choose a company in this workspace.');
  const row=(await c.query(`insert into contact_profiles(org_id,email,name,phone,title,company_id,notes)
    values($1,$2,$3,$4,$5,$6,$7)
    on conflict(org_id,email) do update set name=excluded.name,phone=excluded.phone,title=excluded.title,
      company_id=excluded.company_id,notes=excluded.notes,updated_at=now()
    returning id,email,name,phone,title,company_id,notes`,[orgId,email,name,phone,title,companyId,notes])).rows[0];
  await c.query('update tickets set client_id=$3 where org_id=$1 and lower(requester_email)=$2',[orgId,email,companyId]);
  return {ok:true,contact:row};
});

export const globalSearch = (pool,orgId,q='') => withOrg(pool,orgId,async c=>{
  const term=clean(q,100); if(term.length<2)return {ok:true,tickets:[],agents:[],contacts:[],companies:[]};
  const pattern=like(term),number=/^#?\d{1,9}$/.test(term)?Number(term.replace('#','')):null;
  const [tickets,agents,contacts,companies]=await Promise.all([
    c.query(`select number,subject,status,requester_name,requester_email from tickets where org_id=$1 and
      (subject ilike $2 or requester_name ilike $2 or requester_email ilike $2 or ($3::int is not null and number=$3))
      order by updated_at desc limit 6`,[orgId,pattern,number]),
    c.query(`select u.id,u.name,u.email,m.role,p.avatar from member m join "user" u on u.id=m."userId"
      left join desk_prefs p on p.user_id=u.id where m."organizationId"=$1 and (u.name ilike $2 or u.email ilike $2)
      order by lower(u.name) limit 5`,[orgId,pattern]),
    c.query(`select p.id,p.name,p.email,p.company_id,k.name company_name from contact_profiles p
      left join clients k on k.org_id=p.org_id and k.id=p.company_id
      where p.org_id=$1 and (p.name ilike $2 or p.email ilike $2) order by p.last_seen_at desc limit 5`,[orgId,pattern]),
    c.query(`select id,name,domain,notes,share_tickets from clients where org_id=$1 and (name ilike $2 or domain ilike $2)
      order by lower(name) limit 5`,[orgId,pattern])
  ]);
  return {ok:true,tickets:tickets.rows,agents:agents.rows,contacts:contacts.rows,companies:companies.rows};
});
