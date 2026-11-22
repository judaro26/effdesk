// Workspace-local business hours for the public Live Chat widget.
export const DAY_KEYS = ['mon','tue','wed','thu','fri','sat','sun'];
export const DEFAULT_CHAT_HOURS = {
  availability_enabled: false,
  availability_timezone: 'America/Los_Angeles',
  weekly_hours: {
    mon:{enabled:true,start:'09:00',end:'17:00'}, tue:{enabled:true,start:'09:00',end:'17:00'},
    wed:{enabled:true,start:'09:00',end:'17:00'}, thu:{enabled:true,start:'09:00',end:'17:00'},
    fri:{enabled:true,start:'09:00',end:'17:00'}, sat:{enabled:false,start:'09:00',end:'17:00'},
    sun:{enabled:false,start:'09:00',end:'17:00'}
  },
  availability_holidays: [],
  after_hours_mode: 'contact_form',
  after_hours_message: 'We are currently closed. Leave a message and our team will get back to you.'
};
const validTime = v => typeof v === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v);
export function validateChatHours(input = {}) {
  const timezone = String(input.availabilityTimezone || DEFAULT_CHAT_HOURS.availability_timezone).trim();
  try { new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(new Date()); } catch { return {ok:false,error:'Choose a valid time zone.'}; }
  const raw = input.weeklyHours && typeof input.weeklyHours === 'object' ? input.weeklyHours : DEFAULT_CHAT_HOURS.weekly_hours;
  const weekly = {};
  for (const day of DAY_KEYS) {
    const row = raw[day] || DEFAULT_CHAT_HOURS.weekly_hours[day];
    if (typeof row.enabled !== 'boolean' || !validTime(row.start) || !validTime(row.end) || row.start >= row.end) return {ok:false,error:'Each enabled day needs a valid same-day start and end time.'};
    weekly[day] = {enabled:row.enabled,start:row.start,end:row.end};
  }
  const holidays = Array.isArray(input.availabilityHolidays) ? input.availabilityHolidays : [];
  if (holidays.length > 100) return {ok:false,error:'You can add up to 100 holiday or closure dates.'};
  const seen = new Set(), cleanHolidays = [];
  for (const item of holidays) {
    const date = String(item && item.date || ''), label = String(item && item.label || '').trim().slice(0,80);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date+'T00:00:00Z')) || new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date || !label || seen.has(date)) return {ok:false,error:'Holiday dates must be unique valid dates with a name.'};
    seen.add(date); cleanHolidays.push({date,label});
  }
  const mode = input.afterHoursMode || DEFAULT_CHAT_HOURS.after_hours_mode;
  if (!['contact_form','hide'].includes(mode)) return {ok:false,error:'Choose a valid after-hours behavior.'};
  const message = String(input.afterHoursMessage || DEFAULT_CHAT_HOURS.after_hours_message).replace(/\u0000/g,'').trim().slice(0,300) || DEFAULT_CHAT_HOURS.after_hours_message;
  return {ok:true,settings:{availability_enabled:input.availabilityEnabled===true,availability_timezone:timezone,weekly_hours:weekly,availability_holidays:cleanHolidays,after_hours_mode:mode,after_hours_message:message}};
}
export function chatHoursStatus(settings = {}, nowMs = Date.now()) {
  if (settings.availability_enabled !== true) return {open:true,reason:'schedule_disabled'};
  const timezone = settings.availability_timezone || DEFAULT_CHAT_HOURS.availability_timezone;
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowMs)).reduce((a,p)=>(a[p.type]=p.value,a),{});
  } catch { return {open:false,reason:'invalid_timezone'}; }
  const date = parts.year+'-'+parts.month+'-'+parts.day, day = String(parts.weekday||'').slice(0,3).toLowerCase();
  if ((settings.availability_holidays||[]).some(h=>h.date===date)) return {open:false,reason:'holiday',date};
  const row = (settings.weekly_hours||DEFAULT_CHAT_HOURS.weekly_hours)[day];
  if (!row || row.enabled!==true) return {open:false,reason:'outside_hours',date};
  const minute = Number(parts.hour)*60+Number(parts.minute), start=Number(row.start.slice(0,2))*60+Number(row.start.slice(3)), end=Number(row.end.slice(0,2))*60+Number(row.end.slice(3));
  return {open:minute>=start&&minute<end,reason:minute>=start&&minute<end?'open':'outside_hours',date,day};
}
