import fs from 'node:fs';
import { check, done } from './lib/check.js';

const js = fs.readFileSync(new URL('../public/js/desk.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/css/desk.css', import.meta.url), 'utf8');

check('the contact directory requests bounded server-side pages', js.includes("api('contact-list',{q:contactSearch,limit:contactLimit,offset:contactOffset})"));
check('the contact directory shows the full matching contact count', js.includes("contactTotal+' CONTACTS'") && js.includes("' of '+contactTotal+' contacts'"));
check('the contact directory supports previous and next pages', js.includes('contactOffset-contactLimit') && js.includes('contactOffset+=contactLimit'));
check('contact search resets pagination and remains debounced', js.includes('contactSearch=cs.value;contactOffset=0') && js.includes('root.setTimeout(loadContacts,250)'));
check('contact pagination controls are responsive', css.includes('.contact-pagination') && css.includes('@media(max-width:560px)'));

done();
