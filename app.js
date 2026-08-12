
const TYPE={
  work:{label:'Lavoro',color:'#c79a4b'},
  vacation:{label:'Ferie',color:'#5a7dd1'},
  permit:{label:'Permesso',color:'#8a6fd0'},
  sick:{label:'Malattia',color:'#d1657a'},
  rest:{label:'Riposo',color:'#4fae7a'},
  personal:{label:'Motivo personale',color:'#d28b45'},
  other:{label:'Altro',color:'#6f7a86'}
};
const D=['DOM','LUN','MAR','MER','GIO','VEN','SAB'];
const M=['GENNAIO','FEBBRAIO','MARZO','APRILE','MAGGIO','GIUGNO','LUGLIO','AGOSTO','SETTEMBRE','OTTOBRE','NOVEMBRE','DICEMBRE'];
const $=id=>document.getElementById(id);
const pad=n=>String(n).padStart(2,'0');
const key=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const esc=s=>String(s||'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

let selected=new Date(); selected.setHours(0,0,0,0);
let mode='week';
let editing=null;
let reminder='none';
let allDay=false;
let events=JSON.parse(localStorage.getItem('agenda_lavoro_final')||'{}');
let audioUnlocked=false, soundEnabled=true, volumeLevel=0.9;
let wheelSoundTimer=0;

const audioEl=$('wheelAudio');
const volumeRange=$('volumeRange');
const savedVol=Number(localStorage.getItem('agenda_sound_volume')||'90');
volumeLevel=Math.max(0,Math.min(1,savedVol/100));
if(volumeRange) volumeRange.value=String(Math.round(volumeLevel*100));



const CLOUD_CONFIG_KEY='agenda_supabase_config_v1';
let supabaseClient=null,cloudUser=null,cloudConfigured=false,cloudSyncing=false,cloudLoading=false,cloudSyncTimer=null,cloudDirty=false;

function readCloudConfig(){try{return JSON.parse(localStorage.getItem(CLOUD_CONFIG_KEY)||'null')}catch(e){return null}}
function saveCloudConfig(url,key){localStorage.setItem(CLOUD_CONFIG_KEY,JSON.stringify({url:url.trim(),key:key.trim()}))}
function setCloudStatus(msg){const e=$('cloudStatus');if(e)e.textContent=msg||''}

function updateCloudUI(){
  if(!$('cloudSetup'))return;
  $('cloudSetup').style.display=cloudConfigured?'none':'block';
  $('cloudAuth').style.display=cloudConfigured&&!cloudUser?'block':'none';
  $('cloudUser').style.display=cloudConfigured&&cloudUser?'block':'none';
  if(cloudUser){
    $('cloudUserEmail').textContent=cloudUser.email||'';
    $('cloudSyncStatus').textContent=cloudLoading?'Caricamento…':cloudSyncing?'Salvataggio…':cloudDirty?'Modifiche da sincronizzare':'✓ Sincronizzato';
  }
}

async function loadCloudData(){
  if(!supabaseClient||!cloudUser)return;
  cloudLoading=true;updateCloudUI();
  try{
    const {data,error}=await supabaseClient
      .from('agenda_data')
      .select('data,updated_at')
      .eq('user_id',cloudUser.id)
      .maybeSingle();
    if(error)throw error;

    if(data&&data.data){
      events=data.data.events||{};
      persistLocalOnly();
      cloudDirty=false;
      render();
    }else{
      await pushCloudData();
    }
  }catch(e){
    notify('Errore nel caricamento cloud');
    setCloudStatus(e?.message||'Errore sincronizzazione');
  }finally{
    cloudLoading=false;updateCloudUI();
    if(cloudDirty&&cloudUser) scheduleCloudSync();
  }
}

function persistLocalOnly(){
  try{localStorage.setItem('agenda_lavoro_final',JSON.stringify(events))}catch(e){}
}

async function pushCloudData(){
  if(!supabaseClient||!cloudUser||cloudLoading)return false;
  cloudSyncing=true;updateCloudUI();
  try{
    const payload={user_id:cloudUser.id,data:{events},updated_at:new Date().toISOString()};
    const result=await supabaseClient
      .from('agenda_data')
      .upsert(payload,{onConflict:'user_id'});
    if(result.error)throw result.error;
    persistLocalOnly();
    cloudDirty=false;
    setCloudStatus('Salvato automaticamente ✓');
    return true;
  }catch(e){
    cloudDirty=true;
    setCloudStatus(e?.message||'Errore salvataggio cloud');
    notify('Salvataggio cloud non riuscito');
    return false;
  }finally{
    cloudSyncing=false;updateCloudUI();
  }
}

function scheduleCloudSync(){
  persistLocalOnly();
  cloudDirty=!!cloudUser;
  updateCloudUI();
  if(!cloudUser||cloudLoading)return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>pushCloudData(),450);
}

function persist(){scheduleCloudSync()}

function initCloudClient(){
  const cfg=readCloudConfig();
  if(!(cfg&&cfg.url&&cfg.key&&window.supabase)){
    cloudConfigured=false;supabaseClient=null;updateCloudUI();return false;
  }
  try{
    supabaseClient=window.supabase.createClient(cfg.url,cfg.key,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    cloudConfigured=true;updateCloudUI();

    supabaseClient.auth.onAuthStateChange((event,session)=>{
      cloudUser=session?.user||null;
      updateCloudUI();
      if((event==='SIGNED_IN'||event==='INITIAL_SESSION')&&!$('overlay')?.classList.contains('open'))loadCloudData();
    });

    supabaseClient.auth.getSession().then(({data})=>{
      cloudUser=data.session?.user||null;
      updateCloudUI();
      if(cloudUser)loadCloudData();
    }).catch(e=>setCloudStatus(e?.message||'Errore sessione'));

    return true;
  }catch(e){
    cloudConfigured=false;supabaseClient=null;updateCloudUI();return false;
  }
}

function openAccount(){if($('accountView')){$('accountView').style.display='flex';updateCloudUI()}}
function closeAccount(){if($('accountView'))$('accountView').style.display='none'}

function persist(){persistCloudAware()}
function evType(e){return TYPE[e.kind||'work']||TYPE.work}
function notify(msg){const t=$('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove('show'),1000)}
function monday(d){const x=new Date(d);const n=x.getDay();x.setDate(x.getDate()+(n===0?-6:1-n));x.setHours(0,0,0,0);return x}
function daysOfWeek(){const m=monday(selected),a=[];for(let i=0;i<7;i++){const d=new Date(m);d.setDate(m.getDate()+i);a.push(d)}return a}
function minuteOf(t){if(!t)return null;const [h,m]=t.split(':').map(Number);return h*60+m}
function eventHeight(e){const s=minuteOf(e.start);const f=minuteOf(e.end);if(s==null||e.allDay)return 54;const end=f!=null&&f>s?f:s+60;return Math.max(1,((end-s)/60)*64)}
function dayEvents(d){
  const seen=new Set();
  return (events[key(d)]||[]).filter(e=>{
    const g=e.groupId||e.id;
    if(seen.has(g))return false;
    seen.add(g); return true;
  })
}
function eventInner(e, allDay=false){
  const t=evType(e);
  const titleIsType=(e.title||'').trim().toLowerCase()===t.label.toLowerCase();
  return `<div class="event" data-id="${e.id}" style="border-left-color:${t.color}">
    ${titleIsType?'':`<div class="kind">${t.label}</div>`}
    <div class="title" style="color:${t.color}">${esc(e.title)}</div>
    <div class="meta">${allDay||e.allDay?'Tutto il giorno':(e.start?e.start+(e.end?' → '+e.end:''):'Tutto il giorno')}${e.notes?' · '+esc(e.notes):''}${e.reminder&&e.reminder!=='none'?' · 🔔':''}</div>
  </div>`
}

function renderMonth(){
  const x=new Date(selected),first=new Date(x.getFullYear(),x.getMonth(),1);
  let start=new Date(first);const n=start.getDay();start.setDate(start.getDate()-(n===0?6:n-1));
  $('monthTitle').textContent=M[x.getMonth()];
  $('monthSub').textContent=String(x.getFullYear());
  let out=['L','M','M','G','V','S','D'].map(v=>`<div class="wd">${v}</div>`).join('');
  for(let i=0;i<42;i++){let d=new Date(start);d.setDate(start.getDate()+i);out+=`<button class="mday ${d.getMonth()===x.getMonth()?'':'other'} ${key(d)===key(new Date())?'today':''} ${key(d)===key(selected)?'selected':''}" data-date="${key(d)}">${d.getDate()}</button>`}
  $('monthGrid').innerHTML=out;
  document.querySelectorAll('.mday').forEach(b=>b.onclick=()=>{selected=new Date(b.dataset.date+'T00:00:00');render();playWheelSound()});
}


function renderMobileMonth(){
  const x=new Date(selected.getFullYear(),selected.getMonth(),1);
  const daysInMonth=new Date(x.getFullYear(),x.getMonth()+1,0).getDate();
  const rail=$('mobileMonthRail'),list=$('mobileMonthDays');
  if(!rail||!list)return;

  rail.innerHTML=`<div class="railMonth"><span>${M[x.getMonth()]} ${x.getFullYear()}</span></div>`;
  let out='';
  const todayKey=key(new Date());
  for(let i=1;i<=daysInMonth;i++){
    const d=new Date(x.getFullYear(),x.getMonth(),i);
    const k=key(d);
    const listEvents=dayEvents(d);
    const selectedClass=k===key(selected)?' isSelected':'';
    const todayClass=k===todayKey?' isToday':'';
    const evHtml=listEvents.map(e=>{
      const t=evType(e);
      const titleIsType=(e.title||'').trim().toLowerCase()===t.label.toLowerCase();
      const meta=e.allDay?'Tutto il giorno':(e.start?e.start+(e.end?' → '+e.end:''):'Tutto il giorno');
      return `<div class="mobileMonthEvent" data-id="${e.id}" style="border-left-color:${t.color}">
        ${titleIsType?'':`<div class="eventKind">${t.label}</div>`}
        <div class="eventTitle" style="color:${t.color}">${esc(e.title)}</div>
        <div class="eventMeta">${meta}${e.notes?' · '+esc(e.notes):''}</div>
      </div>`;
    }).join('');
    out+=`<div class="mobileMonthDay${selectedClass}${todayClass}" data-date="${k}">
      <div class="mobileDateRail">
        <div class="mobileDateDow">${D[d.getDay()]}</div>
        <div class="mobileDateNum">${i}</div>
        <div class="mobileDateMonth">${M[d.getMonth()].slice(0,3)}</div>
      </div>
      <div class="mobileMonthContent">${evHtml||'<div class="mobileMonthEmpty"></div>'}</div>
    </div>`;
  }
  list.innerHTML=out;
  list.dataset.scrolled='0';

  list.querySelectorAll('.mobileMonthDay').forEach(row=>{
    row.addEventListener('click',e=>{
      const k=row.dataset.date;
      const card=e.target.closest('.mobileMonthEvent');
      selected=new Date(k+'T00:00:00');
      if(card){
        const ev=(events[k]||[]).find(x=>x.id===card.dataset.id);
        openSheet(k,ev);
      }else{
        render();
      }
      playWheelSound();
    });
  });
  // Keep the selected day in view without forcing a jarring jump when opening the month.
  requestAnimationFrame(()=>{
    const sel=list.querySelector('.mobileMonthDay.isSelected');
    if(sel && list.dataset.scrolled!=='1'){
      sel.scrollIntoView({block:'center'});
      list.dataset.scrolled='1';
    }
  });
}

function renderWeek(){
  $('weekView').style.display='block';$('dayView').style.display='none';$('mode').textContent='GIORNO';
  const ds=daysOfWeek(),m=ds[0];
  $('headerTitle').textContent=`${M[m.getMonth()]} ${m.getFullYear()}`;
  $('headerSub').textContent=`LUN ${m.getDate()} — DOM ${ds[6].getDate()}`;
  $('weekHead').innerHTML=`<div class="spacer"></div>`+ds.map(d=>`<button class="dayHead ${key(d)===key(selected)?'active':''} ${key(d)===key(new Date())?'today':''}" data-date="${key(d)}"><div class="dow">${D[d.getDay()]}</div><div class="num">${d.getDate()}</div></button>`).join('');
  const hours=Array.from({length:11},(_,i)=>i+8);
  let out=`<div class="timeColumn">${hours.map(h=>`<div class="timeRow">${pad(h)}:00</div>`).join('')}</div>`;
  ds.forEach(d=>{
    const k=key(d);
    out+=`<div class="dayColumn ${k===key(selected)?'selected':''}" data-date="${k}">${hours.map(()=>'<div class="hourLine"></div>').join('')}`;
    const alld=dayEvents(d).filter(e=>e.allDay);
    if(alld.length) out+=`<div class="allDayFull">${alld.map(e=>eventInner(e,true)).join('')}</div>`;
    dayEvents(d).filter(e=>!e.allDay&&e.start).forEach(e=>{
      const top=Math.max(0,(minuteOf(e.start)-8*60)/60*64);
      out+=`<div class="floatingEvent" data-id="${e.id}" style="top:${Math.max(0,Math.min(100,((minuteOf(e.start)-8*60)/660*100)))}%;height:${Math.max(0.1,Math.min(100,(((minuteOf(e.end)!=null&&minuteOf(e.end)>minuteOf(e.start)?minuteOf(e.end):minuteOf(e.start)+60)-minuteOf(e.start))/660*100)))}%;border-left-color:${evType(e).color}">${eventInner(e,false)}</div>`;
    });
    out+=`</div>`;
  });
  $('weekGrid').className='weekTimeline';
  $('weekGrid').innerHTML=out;

  document.querySelectorAll('.dayHead').forEach(b=>b.onclick=()=>{
    selected=new Date(b.dataset.date+'T00:00:00');mode='day';render();playWheelSound();
  });
  document.querySelectorAll('.dayColumn').forEach(col=>col.onclick=e=>{
    if(e.target.closest('.floatingEvent,.allDayStrip'))return;
    const rect=col.getBoundingClientRect(), y=e.clientY-rect.top;
    const mins=8*60+Math.max(0,Math.min(10*60,Math.floor(y/64*60/15)*15));
    openSheet(col.dataset.date,null,`${pad(Math.floor(mins/60))}:${pad(mins%60)}`);
  });
  document.querySelectorAll('.floatingEvent,.allDayStrip .event').forEach(c=>c.onclick=e=>{
    e.stopPropagation();const k=c.closest('.dayColumn').dataset.date;
    openSheet(k,(events[k]||[]).find(x=>x.id===c.dataset.id));
  });
  renderSummary();
  requestAnimationFrame(()=>{ $('content').scrollTop=0; });
}

function renderDay(){
  $('weekView').style.display='none';$('dayView').style.display='block';$('mode').textContent='SETTIMANA';
  $('headerTitle').textContent=`${D[selected.getDay()]} ${selected.getDate()} ${M[selected.getMonth()]} ${selected.getFullYear()}`;
  $('headerSub').textContent='';
  const hours=Array.from({length:11},(_,i)=>i+8),all=dayEvents(selected);
  let out=`<div class="dayTimeCol">${hours.map(h=>`<div class="dayTime">${pad(h)}:00</div>`).join('')}</div><div class="dayTimeline">`;
  hours.forEach(()=>out+='<div class="dayLine"></div>');
  const alld=all.filter(e=>e.allDay);
  if(alld.length)out+=`<div class="dayAllDayFull">${alld.map(e=>eventInner(e,true)).join('')}</div>`;
  all.filter(e=>!e.allDay&&e.start).forEach(e=>{
    const top=Math.max(0,(minuteOf(e.start)-8*60)/60*64);
    out+=`<div class="dayFloatingEvent" data-id="${e.id}" style="top:${Math.max(0,Math.min(100,((minuteOf(e.start)-8*60)/660*100)))}%;height:${Math.max(0.1,Math.min(100,(((minuteOf(e.end)!=null&&minuteOf(e.end)>minuteOf(e.start)?minuteOf(e.end):minuteOf(e.start)+60)-minuteOf(e.start))/660*100)))}%;border-left-color:${evType(e).color}">${eventInner(e,false)}</div>`;
  });
  out+='</div>';
  $('dayGrid').className='dayTimelineWrap';$('dayGrid').innerHTML=out;
  document.querySelectorAll('.dayFloatingEvent,.dayAllDayFull .event').forEach(c=>c.onclick=e=>{e.stopPropagation();openSheet(key(selected),(events[key(selected)]||[]).find(x=>x.id===c.dataset.id))});
  $('dayGrid').querySelector('.dayTimeline').onclick=e=>{
    if(e.target.closest('.dayFloatingEvent,.dayAllDayFull'))return;
    const rect=e.currentTarget.getBoundingClientRect(),y=e.clientY-rect.top;
    const mins=8*60+Math.max(0,Math.min(10*60,Math.floor(y/64*60/15)*15));
    openSheet(key(selected),null,`${pad(Math.floor(mins/60))}:00`);
  };
  renderSummary();
}

function normalizeTimeInput(value, fallback='08:00'){
  let v=String(value||'').trim().replace(/\s/g,'');
  if(!v)return fallback;
  if(/^\d{1,2}$/.test(v)){
    const h=Math.max(0,Math.min(23,Number(v)));
    return `${pad(h)}:00`;
  }
  const m=v.match(/^(\d{1,2})(?::(\d{0,2}))?$/);
  if(!m)return fallback;
  const h=Math.max(0,Math.min(23,Number(m[1])));
  let mins=m[2]===''||m[2]==null?0:Number(m[2]);
  mins=Math.max(0,Math.min(59,mins));
  return `${pad(h)}:${pad(mins)}`;
}
function bindTimeField(id, fallback){
  const el=$(id);
  if(!el || el.dataset.timeBound==='1')return;
  el.dataset.timeBound='1';
  el.addEventListener('input',()=>{
    // As soon as a standalone hour is typed, keep the field visually compact.
    const v=el.value.trim();
    if(/^\d{2}$/.test(v)){
      const h=Math.max(0,Math.min(23,Number(v)));
      el.value=`${pad(h)}:00`;
      el.setSelectionRange(5,5);
    }
  });
  el.addEventListener('blur',()=>{el.value=normalizeTimeInput(el.value,fallback)});
}
bindTimeField('fStart','08:00');
bindTimeField('fEnd','09:00');


let statsYear = new Date().getFullYear();

function statsCategories(){
  return [
    ['vacation','Ferie','#5a7dd1'],
    ['permit','Permesso','#8a6fd0'],
    ['sick','Malattia','#d1657a'],
    ['rest','Riposo','#4fae7a'],
    ['personal','Motivo personale','#d28b45'],
    ['other','Altro','#6f7a86']
  ];
}

function countStatsYear(year){
  const out={};
  for(const [kind] of statsCategories()){
    out[kind]=Array(12).fill(0);
  }
  for(const [date,list] of Object.entries(events)){
    const d=new Date(date+'T00:00:00');
    if(d.getFullYear()!==year)continue;
    const month=d.getMonth();
    for(const e of list){
      if(out[e.kind]) out[e.kind][month] += 1;
    }
  }
  return out;
}

function renderStats(){
  if($('statsView'))$('statsView').style.display='block';
  $('weekView').style.display='none';
  $('dayView').style.display='none';

  const counts=countStatsYear(statsYear);
  $('statsYearValue').textContent=String(statsYear);

  $('statsTableBody').innerHTML=statsCategories().map(([kind,label,color])=>{
    const vals=counts[kind];
    const total=vals.reduce((a,b)=>a+b,0);
    return `<tr>
      <td><div class="statsType"><span class="statsDot" style="background:${color}"></span>${label}</div></td>
      ${vals.map(v=>`<td class="statsMonthCell">${v}</td>`).join('')}
      <td class="statsTotalCell">${total}</td>
    </tr>`;
  }).join('');

  const monthTotals=Array(12).fill(0);
  statsCategories().forEach(([kind])=>counts[kind].forEach((v,i)=>monthTotals[i]+=v));
  const grandTotal=monthTotals.reduce((a,b)=>a+b,0);

  $('statsTableFoot').innerHTML=`<tr>
    <td>TOTALE MESE</td>
    ${monthTotals.map(v=>`<td>${v}</td>`).join('')}
    <td>${grandTotal}</td>
  </tr>`;
}

function openStats(){mode='stats';renderStats();}

function closeStats(){
  if($('statsView'))$('statsView').style.display='none';
  mode='week';
  render();
}

function render(){
  renderMonth();
  const mobile=(window.matchMedia&&window.matchMedia('(max-width:700px)').matches) || ((navigator.maxTouchPoints||0)>0 && window.innerWidth<=1024);
  document.body.classList.toggle('mobileMonthMode',!!mobile&&mode==='month');
  document.body.classList.toggle('mobileDayMode',!!mobile&&mode==='day');
  if(mode==='stats')renderStats();
  else{
    if($('statsView'))$('statsView').style.display='none';
    if(mobile){
      if(mode==='day')renderDay();else renderMobileMonth();
    }else{
      if(mode==='day')renderDay();else renderWeek();
    }
  }
  if($('mode'))$('mode').textContent=mobile?(mode==='day'?'MESE':'GIORNO'):(mode==='day'?'SETTIMANA':'GIORNO');
}
function renderSummary(){
  const c={vacation:0,permit:0,sick:0,rest:0,personal:0,other:0};
  Object.values(events).flat().forEach(e=>{if(c[e.kind]!=null)c[e.kind]++});
  const rows=[
    ['vacation','Ferie','🏖'],['permit','Permessi','⏱'],['sick','Malattia','🤒'],
    ['rest','Riposo','😴'],['personal','Personale','👤'],['other','Altro','•']
  ];
  $('summary').innerHTML=rows.map(([k,label,icon])=>`<div class="count"><span>${icon}</span><span>${label}: <b>${c[k]}</b></span></div>`).join('');
}

function updateAllDayFields(){
  $('fStart').disabled=allDay;$('fEnd').disabled=allDay;
  $('fStart').style.opacity=allDay?'.45':'1';$('fEnd').style.opacity=allDay?'.45':'1';
}
function syncTypeTitle(force){
  const t=evType({kind:$('fKind').value}),cur=$('fTitle').value.trim(), labels=Object.values(TYPE).map(x=>x.label);
  if(force||!cur||labels.includes(cur))$('fTitle').value=t.label;
  if($('titleColor'))$('titleColor').style.background=t.color;
}
function openSheet(k,e=null,start=''){
  editing=e?.id||null;reminder=e?.reminder||'none';allDay=!!e?.allDay;
  $('sheetTitle').textContent=e?'Modifica impegno':'Nuovo impegno';$('deleteBtn').style.display=e?'block':'none';
  $('fTitle').value=e?.title||'';$('fKind').value=e?.kind||'work';$('fNotes').value=e?.notes||'';
  $('fDate').value=k;$('fDateEnd').value=e?.dateEnd||k;$('fStart').value=e?.start||start;$('fEnd').value=e?.end||'';
  $('fAllDay').checked=allDay;updateAllDayFields();syncTypeTitle(false);
  document.querySelectorAll('.rem').forEach(b=>b.classList.toggle('active',b.dataset.r===reminder));
  $('overlay').classList.add('open');$('fTitle').focus();
}
function move(dir){
  if(mode==='day') selected.setDate(selected.getDate()+dir);
  else if(mode==='month') selected.setMonth(selected.getMonth()+dir);
  else selected.setDate(selected.getDate()+dir*7);
  render();playWheelSound();
}
function toToday(){selected=new Date();selected.setHours(0,0,0,0);render();playWheelSound()}


let wheelAudioCtx=null;
let wheelMaster=null;

function getWheelAudioContext(){
  if(wheelAudioCtx)return wheelAudioCtx;
  try{
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx)return null;
    wheelAudioCtx=new Ctx();
    wheelMaster=wheelAudioCtx.createGain();
    wheelMaster.gain.value=Math.max(.001,volumeLevel);
    wheelMaster.connect(wheelAudioCtx.destination);
  }catch(e){
    wheelAudioCtx=null;wheelMaster=null;
  }
  return wheelAudioCtx;
}

async function unlockAudio(){
  const ctx=getWheelAudioContext();
  if(!ctx)return;
  try{
    if(ctx.state==='suspended')await ctx.resume();
    if(wheelMaster)wheelMaster.gain.value=Math.max(.001,volumeLevel);
    audioUnlocked=true;
  }catch(e){}
}

function playWheelSound(){
  if(!soundEnabled||volumeLevel<=0)return;
  const ctx=getWheelAudioContext();
  if(!ctx)return;
  if(ctx.state==='suspended'){ctx.resume().catch(()=>{});return;}

  try{
    const now=ctx.currentTime;

    // Mechanical detent: low body + bright metal tooth + short ratchet noise.
    const body=ctx.createOscillator();
    const bodyGain=ctx.createGain();
    body.type='sine';
    body.frequency.setValueAtTime(120,now);
    body.frequency.exponentialRampToValueAtTime(78,now+.075);
    bodyGain.gain.setValueAtTime(.0001,now);
    bodyGain.gain.exponentialRampToValueAtTime(.30,now+.003);
    bodyGain.gain.exponentialRampToValueAtTime(.0001,now+.11);
    body.connect(bodyGain).connect(wheelMaster);
    body.start(now); body.stop(now+.115);

    const tooth=ctx.createOscillator();
    const toothGain=ctx.createGain();
    tooth.type='triangle';
    tooth.frequency.setValueAtTime(2300,now+.001);
    tooth.frequency.exponentialRampToValueAtTime(1450,now+.040);
    toothGain.gain.setValueAtTime(.0001,now);
    toothGain.gain.exponentialRampToValueAtTime(.23,now+.004);
    toothGain.gain.exponentialRampToValueAtTime(.0001,now+.065);
    tooth.connect(toothGain).connect(wheelMaster);
    tooth.start(now+.001); tooth.stop(now+.07);

    const len=Math.floor(ctx.sampleRate*.022);
    const buf=ctx.createBuffer(1,len,ctx.sampleRate);
    const data=buf.getChannelData(0);
    for(let i=0;i<len;i++){
      const fade=1-(i/len);
      data[i]=(Math.random()*2-1)*fade*fade;
    }
    const noise=ctx.createBufferSource();
    const filter=ctx.createBiquadFilter();
    const noiseGain=ctx.createGain();
    filter.type='highpass';
    filter.frequency.value=3200;
    noiseGain.gain.setValueAtTime(.0001,now);
    noiseGain.gain.exponentialRampToValueAtTime(.14,now+.003);
    noiseGain.gain.exponentialRampToValueAtTime(.0001,now+.026);
    noise.buffer=buf;
    noise.connect(filter).connect(noiseGain).connect(wheelMaster);
    noise.start(now+.002);

    if(wheelMaster)wheelMaster.gain.setTargetAtTime(Math.max(.001,volumeLevel),now,.005);
  }catch(e){}
}

document.addEventListener('pointerdown',()=>{unlockAudio()},{passive:true});


if($('testSound'))$('testSound').onclick=()=>{unlockAudio().then(()=>playWheelSound())};

$('save').onclick=()=>{
  const title=$('fTitle').value.trim();if(!title)return notify('Inserisci un titolo');
  const a=$('fDate').value;if(!a)return notify('Seleziona una data');
  let b=$('fDateEnd').value||a;if(new Date(b+'T00:00:00')<new Date(a+'T00:00:00'))b=a;
  const isAllDay=$('fAllDay').checked;if(!$('fStart').disabled)$('fStart').value=normalizeTimeInput($('fStart').value,'08:00');if(!$('fEnd').disabled&&$('fEnd').value)$('fEnd').value=normalizeTimeInput($('fEnd').value,'09:00');
  const old=editing?Object.values(events).flat().find(x=>x.id===editing):null;
  const groupId=old?.groupId||old?.id||crypto.randomUUID();
  const base={id:editing||crypto.randomUUID(),groupId,title,kind:$('fKind').value,notes:$('fNotes').value.trim(),
    start:isAllDay?'':$('fStart').value,end:isAllDay?'':$('fEnd').value,dateEnd:b,reminder,allDay:isAllDay};
  if(editing){
    for(const kk in events){events[kk]=(events[kk]||[]).filter(x=>(x.groupId||x.id)!==groupId);if(!events[kk].length)delete events[kk]}
  }
  let d=new Date(a+'T00:00:00'),stop=new Date(b+'T00:00:00');
  while(d<=stop){
    const kk=key(d);
    (events[kk]||(events[kk]=[])).push({...base,id:kk===a?base.id:crypto.randomUUID(),groupId,
      start:kk===a?base.start:'',end:kk===a?base.end:''});
    d.setDate(d.getDate()+1);
  }
  persistLocalOnly();
  if(cloudUser){cloudDirty=true;scheduleCloudSync()}
  editing=null;
  $('overlay').classList.remove('open');
  selected=new Date(a+'T00:00:00');
  render();
  notify('Salvato');
};

$('deleteBtn').onclick=()=>{
  if(!editing)return;
  const old=Object.values(events).flat().find(x=>x.id===editing),groupId=old?.groupId||editing;
  for(const kk in events){
    events[kk]=(events[kk]||[]).filter(x=>(x.groupId||x.id)!==groupId);
    if(!events[kk].length)delete events[kk];
  }
  persistLocalOnly();
  if(cloudUser){cloudDirty=true;scheduleCloudSync()}
  editing=null;
  $('overlay').classList.remove('open');
  render();
  notify('Eliminato');
};

$('fAllDay').addEventListener('change',()=>{allDay=$('fAllDay').checked;updateAllDayFields();if(allDay){$('fStart').value='';$('fEnd').value=''}});
$('fKind').addEventListener('change',()=>syncTypeTitle(true));
$('fTitle').addEventListener('input',()=>{if($('titleColor'))$('titleColor').style.background=evType({kind:$('fKind').value}).color});
document.querySelectorAll('.rem').forEach(b=>b.onclick=()=>{reminder=b.dataset.r;document.querySelectorAll('.rem').forEach(x=>x.classList.toggle('active',x===b))});
$('cancel').onclick=()=>$('overlay').classList.remove('open');
$('overlay').onclick=e=>{if(e.target===$('overlay'))$('overlay').classList.remove('open')};


if($('statsNav'))$('statsNav').onclick=()=>{openStats();playWheelSound()};
if($('statsYearPrev'))$('statsYearPrev').onclick=()=>{statsYear--;renderStats();playWheelSound()};
if($('statsYearNext'))$('statsYearNext').onclick=()=>{statsYear++;renderStats();playWheelSound()};
if($('statsBack'))$('statsBack').onclick=()=>{closeStats();playWheelSound()};





async function refreshCloudOnFocus(){
  if(cloudUser&&!cloudSyncing&&!cloudLoading&&!$('overlay')?.classList.contains('open')&&!$('accountView')?.classList.contains('open')){
    await loadCloudData();
  }
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshCloudOnFocus()});
window.addEventListener('focus',()=>refreshCloudOnFocus());


function warnBeforeClosing(e){
  if(cloudUser && cloudDirty){
    e.preventDefault();
    e.returnValue='';
    return '';
  }
}
window.addEventListener('beforeunload',warnBeforeClosing);

document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden' && cloudUser && cloudDirty && !cloudSyncing){
    // Start the upload before the page is suspended. The browser may still terminate
    // the request, so the beforeunload warning remains the final safeguard.
    pushCloudData();
  }
});

function bindCloudUI(){
  if($('accountNav'))$('accountNav').onclick=openAccount;
  if($('accountClose'))$('accountClose').onclick=closeAccount;
  if($('accountView'))$('accountView').onclick=e=>{if(e.target===$('accountView'))closeAccount()};

  if($('sbSaveConfig'))$('sbSaveConfig').onclick=()=>{
    const u=$('sbUrl').value.trim(),k=$('sbKey').value.trim();
    if(!u||!k){setCloudStatus('Inserisci URL e chiave.');return}
    saveCloudConfig(u,k);
    setCloudStatus('Controllo configurazione…');
    if(initCloudClient())setCloudStatus('Configurazione salvata. Ora puoi accedere.');
    else setCloudStatus('Configurazione non valida o Supabase non raggiungibile.');
  };

  if($('cloudLogin'))$('cloudLogin').onclick=async()=>{
    if(!supabaseClient){setCloudStatus('Configura prima il cloud.');return}
    const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
    if(!email||!password){setCloudStatus('Inserisci email e password.');return}
    setCloudStatus('Accesso…');
    const {error}=await supabaseClient.auth.signInWithPassword({email,password});
    setCloudStatus(error?error.message:'Accesso effettuato.');
  };

  if($('cloudRegister'))$('cloudRegister').onclick=async()=>{
    if(!supabaseClient){setCloudStatus('Configura prima il cloud.');return}
    const email=$('cloudEmail').value.trim(),password=$('cloudPassword').value;
    if(!email||password.length<6){setCloudStatus('Email e password di almeno 6 caratteri.');return}
    setCloudStatus('Creazione account…');
    const {data,error}=await supabaseClient.auth.signUp({email,password});
    setCloudStatus(error?(error.message):(data.session?'Account creato e accesso effettuato.':'Account creato. Puoi accedere.'));
  };

  if($('cloudSyncNow'))$('cloudSyncNow').onclick=()=>pushCloudData();
  if($('cloudLogout'))$('cloudLogout').onclick=async()=>{
    if(supabaseClient)await supabaseClient.auth.signOut();
    cloudUser=null;updateCloudUI();
  };

  initCloudClient();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bindCloudUI);
else bindCloudUI();

$('mode').onclick=()=>{
  if(mode==='stats'){closeStats();playWheelSound();return}
  const mobile=(window.matchMedia&&window.matchMedia('(max-width:700px)').matches) || ((navigator.maxTouchPoints||0)>0 && window.innerWidth<=1024);
  if(mobile) mode=mode==='day'?'month':'day';
  else mode=mode==='day'?'week':'day';
  render();playWheelSound();
};
$('prevWeek').onclick=()=>move(-1);$('nextWeek').onclick=()=>move(1);
$('today').onclick=toToday;$('todayPill').onclick=toToday;$('sideToday').onclick=toToday;
$('add').onclick=()=>openSheet(key(selected));$('sideAdd').onclick=()=>openSheet(key(selected));
$('monthPrev').onclick=()=>{selected.setDate(1);selected.setMonth(selected.getMonth()-1);render()};
$('monthNext').onclick=()=>{selected.setDate(1);selected.setMonth(selected.getMonth()+1);render()};
$('monthToday').onclick=toToday;
if(volumeRange)volumeRange.addEventListener('input',()=>{volumeLevel=Number(volumeRange.value)/100;localStorage.setItem('agenda_sound_volume',volumeRange.value);if(audioEl)audioEl.volume=volumeLevel;if(wheelMaster)wheelMaster.gain.value=Math.max(.001,volumeLevel)});

$('content').addEventListener('wheel',e=>{
  const now=Date.now();
  if(Math.abs(e.deltaY)>=5 && now-wheelSoundTimer>70){wheelSoundTimer=now;playWheelSound()}
},{passive:true});

let sx=null,sy=null;
$('content').addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
$('content').addEventListener('touchend',e=>{
  if(sx===null)return;
  const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;
  sx=null;sy=null;
  if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy))move(dx<0?1:-1);
},{passive:true});
window.addEventListener('keydown',e=>{
  const target=e.target;
  const typing=target instanceof HTMLInputElement ||
               target instanceof HTMLTextAreaElement ||
               target instanceof HTMLSelectElement ||
               target?.isContentEditable;
  if(typing)return;
  if(e.key==='ArrowLeft'){e.preventDefault();move(-1)}
  if(e.key==='ArrowRight'){e.preventDefault();move(1)}
  if(e.key.toLowerCase()==='n'){e.preventDefault();openSheet(key(selected))}
});


let pwaInstallPrompt=null;

function isStandaloneApp(){
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone===true;
}

window.addEventListener('beforeinstallprompt',(event)=>{
  event.preventDefault();
  pwaInstallPrompt=event;
  const btn=$('pwaInstallBtn');
  if(btn && !isStandaloneApp()) btn.style.display='flex';
});

window.addEventListener('appinstalled',()=>{
  pwaInstallPrompt=null;
  const btn=$('pwaInstallBtn');
  if(btn)btn.style.display='none';
});

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',()=>{
    const btn=$('pwaInstallBtn');
    if(!btn)return;
    btn.onclick=async()=>{
      if(!pwaInstallPrompt){
        notify('Per installare l’app, apri questa pagina tramite HTTPS o localhost.');
        return;
      }
      pwaInstallPrompt.prompt();
      try{await pwaInstallPrompt.userChoice}catch(e){}
      pwaInstallPrompt=null;
      btn.style.display='none';
    };
    if(isStandaloneApp())btn.style.display='none';
  },{once:true});
}else{
  const btn=$('pwaInstallBtn');
  if(btn){
    btn.onclick=async()=>{
      if(!pwaInstallPrompt){notify('Per installare l’app, apri questa pagina tramite HTTPS o localhost.');return}
      pwaInstallPrompt.prompt();
      try{await pwaInstallPrompt.userChoice}catch(e){}
      pwaInstallPrompt=null;btn.style.display='none';
    };
    if(isStandaloneApp())btn.style.display='none';
  }
}

if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')){
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register('./sw.js').catch(()=>{});
  });
}

function renderDayRoller(){
  const roller=$('dayRoller');
  const track=$('dayRollerTrack');
  if(!roller||!track)return;
  let html='';
  for(let i=-7;i<=7;i++){
    html+=`<div class="dayRollerTick ${i===0?'active':''}" data-offset="${i}"></div>`;
  }
  track.innerHTML=html;
  track.style.transition='none';
  track.style.transform='translateX(-196px)';
}
let rollerBusy=false;

function hapticTick(kind='light'){
  try{
    if(!navigator.vibrate)return false;
    navigator.vibrate(kind==='strong'?18:8);
    return true;
  }catch(e){return false}
}

function rollerStep(dir){
  if(rollerBusy)return;
  rollerBusy=true;
  const track=$('dayRollerTrack');
  if(!track){rollerBusy=false;return;}
  // The track moves in the same direction as the physical gesture.
  track.style.transition='transform 180ms cubic-bezier(.2,.8,.2,1)';
  track.style.transform=`translateX(${dir>0?-224: -168}px)`;
  playWheelSound();
  hapticTick('light');
  setTimeout(()=>{
    selected.setDate(selected.getDate()+dir);
    render();
    rollerBusy=false;
  },135);
}
function bindDayRoller(){
  const roller=$('dayRoller');
  if(!roller || roller.dataset.bound==='1')return;
  roller.dataset.bound='1';
  let dragging=false,lastX=0,acc=0;
  roller.addEventListener('pointerdown',e=>{
    unlockAudio();
    hapticTick('strong');
    roller.classList.add('dragging');
    dragging=true;lastX=e.clientX;acc=0;
    try{roller.setPointerCapture(e.pointerId)}catch(err){}
  });
  roller.addEventListener('pointermove',e=>{
    if(!dragging)return;
    acc+=e.clientX-lastX;lastX=e.clientX;
    if(Math.abs(acc)>=28&&!rollerBusy){
      const dir=acc<0?1:-1;
      acc += acc<0?28:-28;
      rollerStep(dir);
    }
  });
  roller.addEventListener('pointerup',()=>{dragging=false;acc=0;roller.classList.remove('dragging')});
  roller.addEventListener('pointercancel',()=>{dragging=false;acc=0;roller.classList.remove('dragging')});
  $('dayRollerPrev').onclick=()=>rollerStep(-1);
  $('dayRollerNext').onclick=()=>rollerStep(1);
}

function setupIPhoneMode(){
  const mobile=(window.matchMedia&&window.matchMedia('(max-width:700px)').matches) || ((navigator.maxTouchPoints||0)>0 && window.innerWidth<=1024);
  document.body.classList.toggle('iphoneDayFirst',!!mobile);
  const modeBtn=$('mode');
  if(mobile && modeBtn){
    if(mode!=='day'&&mode!=='month') mode='month';
    modeBtn.textContent=mode==='day'?'MESE':'GIORNO';
  }
}
window.addEventListener('resize',setupIPhoneMode,{passive:true});

if($('mobileCloud'))$('mobileCloud').onclick=()=>{if(typeof openAccount==='function')openAccount()};
if($('mobileStats'))$('mobileStats').onclick=()=>{if(typeof openStats==='function')openStats()};

setupIPhoneMode();

const originalRender = render;
render = function(){
  originalRender();
  renderDayRoller();
};

bindDayRoller();
render();
