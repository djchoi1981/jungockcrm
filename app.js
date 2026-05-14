// STATE
let members = [];
let isLoggedIn=false, isAdmin=false;
let userPw=localStorage.getItem('userPw')||'1234';
let adminPw=localStorage.getItem('adminPw')||'5678';
let logoName=localStorage.getItem('logoName')||'회원명부';
let logoImg=localStorage.getItem('logoImg')||'';
let currentView='list',sortCol='',sortDir=1,searchQ='',filterJob='all';
let currentPage=1,cardPage=1,editingId=null,detailId=null;
let changingPwTarget='user';
let fsUnsub=null,visUnsub=null,migrationChecked=false,useLocalOnly=false;
let fieldVisibility=JSON.parse(localStorage.getItem('fieldVisibility')||JSON.stringify({job:true,name:true,birthday:true,phone:true,address:true,joindate:true,company:true,memo:true}));
const PER=15,CPER=12;
const CACHE_KEY='members_cache';

// CROP STATE
let cropScale=1,cropX=0,cropY=0,cropDragging=false,cropLX=0,cropLY=0,pinchD0=0,pinchS0=1;

// ── 로컬 캐시 헬퍼 ──
function saveCache(){localStorage.setItem(CACHE_KEY,JSON.stringify(members));}
function loadCache(){return JSON.parse(localStorage.getItem(CACHE_KEY)||'[]');}

// ── REALTIME DATABASE 초기화 ──
let dbRef=null;
function initDatabase(){
  if(fsUnsub){fsUnsub();fsUnsub=null;}
  migrationChecked=false;
  useLocalOnly=false;

  // 1) 캐시 즉시 표시
  const cached=loadCache();
  if(cached.length){members=cached;render();updateCount();}

  // 2) 3초 타임아웃
  const timeout=setTimeout(()=>{
    if(!migrationChecked){
      useLocalOnly=true;
      toast('Firebase 연결 지연 - 로컬 저장 모드','error');
      members=loadCache();render();updateCount();
    }
  },3000);

  // 3) Realtime DB 실시간 리스너
  dbRef=database.ref('members');
  const handler=dbRef.on('value',snap=>{
    clearTimeout(timeout);
    migrationChecked=true;
    const val=snap.val();
    members=val?Object.entries(val).map(([id,d])=>({id,...d})):[];
    saveCache();
    render();updateCount();
    // 구버전 로컬 데이터 마이그레이션 제안
    const legacy=JSON.parse(localStorage.getItem('members')||'[]');
    if(legacy.length&&!members.length)checkMigration(legacy);
  },err=>{
    clearTimeout(timeout);
    useLocalOnly=true;
    console.error('DB 오류:',err);
    toast('Firebase 오류('+err.code+') - 로컬 저장 모드','error');
    members=loadCache();render();updateCount();
  });
  const visRef=database.ref('settings/fieldVisibility');
  const visHandler=visRef.on('value',snap=>{
    const v=snap.val();
    if(v){fieldVisibility={...fieldVisibility,...v};localStorage.setItem('fieldVisibility',JSON.stringify(fieldVisibility));render();}
  });
  fsUnsub=()=>{if(dbRef)dbRef.off('value',handler);if(visRef)visRef.off('value',visHandler);};
}

function checkMigration(loc){
  if(confirm(`로컬 데이터 ${loc.length}명을 클라우드로 마이그레이션할까요?`))migrateData(loc);
}
async function migrateData(loc){
  try{
    const updates={};
    for(const m of loc){
      let photo=m.photo||'';
      if(photo.startsWith('data:')){
        const r=storage.ref('photos/'+(m.id||Date.now()));
        await r.putString(photo,'data_url');photo=await r.getDownloadURL();
      }
      const id=m.id||Date.now().toString();
      updates[id]={...m,id,photo};
    }
    await database.ref('members').update(updates);
    localStorage.removeItem('members');
    toast(`${loc.length}명 마이그레이션 완료 ✅`,'success');
  }catch(e){toast('마이그레이션 실패: '+e.message,'error');}
}

// ── 로컬 전용 모드 저장 (Firestore 실패 시 fallback) ──
function saveLocalOnly(){
  saveCache();
  render();updateCount();
}

function updateCount(){document.getElementById('sidebar-count').textContent=members.length;}


// FILTER
function filtered(){
  let a=[...members];
  if(searchQ){const q=searchQ.toLowerCase();a=a.filter(m=>(m.name||'').toLowerCase().includes(q)||(m.job||'').toLowerCase().includes(q)||(m.phone||'').toLowerCase().includes(q)||(m.email||'').toLowerCase().includes(q));}
  if(filterJob!=='all')a=a.filter(m=>(m.job||'기타')===filterJob);
  if(sortCol)a.sort((a,b)=>{const va=(a[sortCol]||'').toLowerCase(),vb=(b[sortCol]||'').toLowerCase();return va<vb?-sortDir:va>vb?sortDir:0;});
  return a;
}
function page(arr,p,per){return arr.slice((p-1)*per,p*per);}

function vf(k,val,fmt){
  if(!isAdmin&&fieldVisibility[k]===false)return '';
  if(!val)return'-';
  return fmt?fmt(val):esc(val);
}

function isBirthdayMonth(d){
  if(!d)return false;
  const m2=new Date().getMonth()+1;
  let s=String(d).trim();
  if(/^\d{4,5}$/.test(s)){
    const serial=parseInt(s,10);
    const date=new Date(Math.round((serial-25569)*86400*1000));
    return (date.getUTCMonth()+1)===m2;
  }
  const p=s.split(/[-/.]/);
  if(p.length===3)return parseInt(p[1])===m2;
  if(p.length===2)return parseInt(p[0])===m2;
  return false;
}

// RENDER LIST
function renderList(){
  const arr=filtered();
  const tbody=document.getElementById('member-tbody');
  const empty=document.getElementById('empty-state');
  const tbl=document.querySelector('.member-table');
  if(!arr.length){tbody.innerHTML='';empty.style.display='flex';tbl.style.display='none';document.getElementById('pagination').innerHTML='';return;}
  empty.style.display='none';tbl.style.display='';
  
  const cols=['job','name','birthday','phone','address','joindate','company','memo'];
  cols.forEach(k=>{
    const th=document.querySelector(`.th-${k}`);
    if(th)th.style.display=(!isAdmin&&fieldVisibility[k]===false)?'none':'';
  });
  const tdVis=k=>` class="td-${k}"`+((!isAdmin&&fieldVisibility[k]===false)?' style="display:none;"':'');

  tbody.innerHTML=page(arr,currentPage,PER).map(m=>{
    const addr=m.address?m.address.split('||').join(' '):'';
    const isBD=isBirthdayMonth(m.birthday);
    return `
    <tr data-id="${m.id}" onclick="openDetail('${m.id}')"${isBD?' class="birthday-row-highlight"':''}>
      <td>${m.photo?`<img class="table-photo" src="${m.photo}"/>`:`<div class="table-photo-placeholder">👤</div>`}</td>
      <td${tdVis('job')}>${esc(m.job||'-')}</td>
      <td${tdVis('name')}><span class="name-cell">${esc(m.name)}${isBD?' 🎂':''}</span></td>
      <td${tdVis('birthday')}>${m.birthday?fmtDate(m.birthday):'-'}</td>
      <td${tdVis('phone')}>${m.phone?`<a class="phone-link" href="tel:${m.phone.replace(/[^0-9+]/g,'')}" onclick="event.stopPropagation()">${esc(m.phone)}</a>`:'-'}</td>
      <td${tdVis('address')}><span class="address-cell">${esc(addr||'-')}</span></td>
      <td${tdVis('joindate')}>${m.joindate?fmtDate(m.joindate):'-'}</td>
      <td${tdVis('company')}>${esc(m.company||'-')}</td>
      <td${tdVis('memo')}><span class="memo-cell">${esc(m.memo||'-')}</span></td>
      <td onclick="event.stopPropagation()">
        <div class="action-btns"><button class="action-btn edit" onclick="openEdit('${m.id}')">✏️</button>${isAdmin?`<button class="action-btn del" onclick="delMember('${m.id}')">🗑️</button>`:''}</div>
      </td>
    </tr>`;
  }).join('');
  renderPagi(arr.length,currentPage,PER,document.getElementById('pagination'),p=>{currentPage=p;renderList();});
}

// RENDER CARDS
function renderCards(){
  const arr=filtered();
  const grid=document.getElementById('card-grid');
  if(!arr.length){grid.innerHTML='<div class="empty-state" style="display:flex"><div class="empty-icon">👥</div><div class="empty-title">회원이 없습니다</div></div>';document.getElementById('pagination-card').innerHTML='';return;}
  grid.innerHTML=page(arr,cardPage,CPER).map(m=>{
    const bd=isBirthdayMonth(m.birthday);
    return `<div class="member-card" onclick="openDetail('${m.id}')">
      ${bd?'<div class="card-badge">🎂 이번달 생일</div>':''}
      ${m.photo?`<img class="card-photo" src="${m.photo}"/>`:`<div class="card-photo-placeholder">👤</div>`}
      ${(!isAdmin&&fieldVisibility.name===false)?'':`<div class="card-name">${esc(m.name)}</div>`}
      ${(!isAdmin&&fieldVisibility.job===false||!m.job)?'':`<div class="card-job">${esc(m.job)}</div>`}
      ${(!isAdmin&&fieldVisibility.phone===false||!m.phone)?'':`<div class="card-phone-wrap"><a class="card-phone" href="tel:${m.phone.replace(/[^0-9+]/g,'')}" onclick="event.stopPropagation()">📞 ${esc(m.phone)}</a></div>`}
      <div class="card-actions" onclick="event.stopPropagation()"><button class="action-btn edit" onclick="openEdit('${m.id}')">✏️</button>${isAdmin?`<button class="action-btn del" onclick="delMember('${m.id}')">🗑️</button>`:''}</div>
    </div>`;
  }).join('');
  renderPagi(arr.length,cardPage,CPER,document.getElementById('pagination-card'),p=>{cardPage=p;renderCards();});
}

// RENDER STATS
function renderStats(){
  const m2=new Date().getMonth()+1;
  document.getElementById('stat-total').textContent=members.length;
  document.getElementById('stat-birthday').textContent=members.filter(m=>m.birthday&&parseInt(m.birthday.split('-')[1])===m2).length;
  const jobs=[...new Set(members.map(m=>m.job||'').filter(Boolean))];
  document.getElementById('stat-jobs').textContent=jobs.length;
  document.getElementById('stat-photos').textContent=members.filter(m=>m.photo).length;
  const jc={};members.forEach(m=>{const j=m.job||'기타';jc[j]=(jc[j]||0)+1;});
  const sorted=Object.entries(jc).sort((a,b)=>b[1]-a[1]).slice(0,8);
  const mx=sorted[0]?.[1]||1;
  document.getElementById('job-chart').innerHTML=sorted.length?sorted.map(([j,c])=>`<div class="bar-row"><span class="bar-label" title="${esc(j)}">${esc(j)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c/mx*100).toFixed(1)}%"></div></div><span class="bar-count">${c}</span></div>`).join(''):'<div class="no-birthday">데이터 없음</div>';
  const bds=members.filter(m=>m.birthday&&parseInt(m.birthday.split('-')[1])===m2).sort((a,b)=>a.birthday.split('-')[2]-b.birthday.split('-')[2]);
  document.getElementById('birthday-list').innerHTML=bds.length?bds.map(m=>`<div class="birthday-row"><span class="birthday-name">🎂 ${esc(m.name)}</span><span class="birthday-date">${m.birthday.split('-')[1]}월 ${m.birthday.split('-')[2]}일</span></div>`).join(''):'<div class="no-birthday">이번 달 생일인 회원이 없습니다</div>';
}

// PAGINATION
function renderPagi(total,cur,per,el,cb){
  const pages=Math.ceil(total/per);
  if(pages<=1){el.innerHTML='';return;}
  let h='';
  if(cur>1)h+=`<button class="page-btn" onclick="(${cb})(${cur-1})">‹</button>`;
  for(let i=1;i<=pages;i++){
    if(i===1||i===pages||Math.abs(i-cur)<=2)h+=`<button class="page-btn${i===cur?' active':''}" onclick="(${cb})(${i})">${i}</button>`;
    else if(Math.abs(i-cur)===3)h+=`<span style="color:var(--text3);padding:0 3px">…</span>`;
  }
  if(cur<pages)h+=`<button class="page-btn" onclick="(${cb})(${cur+1})">›</button>`;
  el.innerHTML=h;
}

// CHIPS
function buildChips(){
  const jobs=[...new Set(members.map(m=>m.job||'').filter(Boolean))].sort();
  const el=document.getElementById('filter-chips');
  el.innerHTML=`<button class="chip${filterJob==='all'?' active':''}" data-filter="all">전체</button>`+jobs.map(j=>`<button class="chip${filterJob===j?' active':''}" data-filter="${esc(j)}">${esc(j)}</button>`).join('');
  el.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{filterJob=btn.dataset.filter;currentPage=1;cardPage=1;buildChips();render();}));
}

// RENDER
function render(){
  buildChips();
  if(currentView==='list')renderList();
  else if(currentView==='card')renderCards();
  else renderStats();
  updateCount();
}

// ADMIN MODE UI
function applyAdminUI(){
  const adminBtns=document.getElementById('admin-only-btns');
  adminBtns.style.display=isAdmin?'flex':'none';
  adminBtns.style.visibility=isAdmin?'visible':'hidden';

  const badge=document.getElementById('mode-badge');
  badge.className='mode-badge'+(isAdmin?' admin':'');
  document.getElementById('mode-label').textContent=isAdmin?'관리자 모드':'일반 모드';

  const detDel=document.getElementById('btn-detail-delete');
  const detEdit=document.getElementById('btn-detail-edit');
  detDel.style.display=isAdmin?'inline-flex':'none';
  detEdit.style.display='inline-flex';

  document.getElementById('logo-img-edit-btn').style.display=isAdmin?'flex':'none';
  document.getElementById('logo-name-edit-btn').style.display=isAdmin?'inline-flex':'none';

  const thAct=document.getElementById('th-actions');
  thAct.style.display='table-cell';

  const emptyAddBtn=document.getElementById('btn-add-empty');
  if(emptyAddBtn) emptyAddBtn.style.display=isAdmin?'inline-flex':'none';

  render();
}

// LOGIN
function showLogin(){
  isLoggedIn=false; isAdmin=false;
  const ov=document.getElementById('login-overlay');
  ov.classList.remove('hidden');
  document.getElementById('login-pw-input').value='';
  document.getElementById('login-error').style.display='none';
  // sync login logo with app logo
  const li=document.getElementById('login-logo-icon');
  const liw=document.getElementById('login-logo-wrap');
  if(logoImg){liw.innerHTML=`<img src="${logoImg}" style="width:100%;height:100%;object-fit:cover;"/>`}
  else{liw.innerHTML=`<span class="login-logo-icon">🏢</span>`;}
  document.getElementById('login-title-text').textContent=logoName;
}
function doLogin(){
  const pw=document.getElementById('login-pw-input').value;
  const err=document.getElementById('login-error');
  if(pw===adminPw){isLoggedIn=true;isAdmin=true;document.getElementById('login-overlay').classList.add('hidden');applyAdminUI();initDatabase();toast('관리자 모드로 로그인되었습니다 🛡️','success');}
  else if(pw===userPw){isLoggedIn=true;isAdmin=false;document.getElementById('login-overlay').classList.add('hidden');applyAdminUI();initDatabase();toast('일반 모드로 로그인되었습니다 👋','info');}
  else{err.style.display='block';document.getElementById('login-pw-input').select();}
}

// DETAIL
function openDetail(id){
  detailId=id;
  const m=members.find(x=>x.id===id);if(!m)return;
  document.getElementById('detail-body').innerHTML=`
    <div class="detail-header">
      ${m.photo?`<img class="detail-photo" src="${m.photo}"/>`:`<div class="detail-photo-placeholder">👤</div>`}
      <div>
        ${(!isAdmin&&fieldVisibility.name===false)?'':`<div class="detail-name">${esc(m.name)}</div>`}
        <div class="detail-job">
          ${[(!isAdmin&&fieldVisibility.job===false)?'':m.job, (!isAdmin&&fieldVisibility.company===false)?'':m.company].filter(Boolean).map(esc).join(' · ')}
        </div>
      </div>
    </div>
    <div class="detail-fields">
      ${df('📞','전화번호',m.phone,true,'phone')}${df('💼','직책',m.job,false,'job')}${df('🎂','생년월일',m.birthday?fmtDate(m.birthday):'',false,'birthday')}${df('📅','최초위촉일',m.joindate?fmtDate(m.joindate):'',false,'joindate')}${df('🏢','추천인',m.company,false,'company')}${(()=>{const addr=m.address?m.address.split('||').join(' '):'';return df('📍','주소',addr,false,'address');})()}${df('📝','비고',m.memo,false,'memo')}
    </div>`;
  document.getElementById('btn-detail-delete').style.display=isAdmin?'inline-flex':'none';
  document.getElementById('btn-detail-edit').style.display='inline-flex';
  document.getElementById('detail-overlay').style.display='flex';
}
function df(icon,label,val,isPhone,key){
  if(!isAdmin&&fieldVisibility[key]===false)return '';
  if(!val)return'';
  const display=isPhone?`<a href="tel:${val.replace(/[^0-9+]/g,'')}" style="color:var(--green);font-family:monospace;text-decoration:none;" onclick="event.stopPropagation()">📞 ${esc(val)}</a>`:esc(val);
  return`<div class="detail-field"><span class="detail-field-icon">${icon}</span><div><div class="detail-field-label">${label}</div><div class="detail-field-value">${display}</div></div></div>`;
}

// ADD/EDIT
function openAdd(){editingId=null;document.getElementById('modal-title').textContent='회원 등록';clearForm();document.getElementById('field-joindate').value=new Date().toISOString().split('T')[0];document.getElementById('modal-overlay').style.display='flex';}
function openEdit(id){
  editingId=id;const m=members.find(x=>x.id===id);if(!m)return;
  document.getElementById('modal-title').textContent='회원 수정';
  ['name','phone','job','company','birthday','joindate','memo'].forEach(f=>{const el=document.getElementById('field-'+f);if(el)el.value=m[f]||'';});
  // 주소 스플릿: 첫 줄이 기본 주소, 나머지가 상세주소
  if(m.address){
    const parts=m.address.split('||');
    document.getElementById('field-address').value=parts[0]||'';
    const det=document.getElementById('field-address-detail');
    if(det)det.value=parts[1]||'';
  }else{
    document.getElementById('field-address').value='';
    const det=document.getElementById('field-address-detail');
    if(det)det.value='';
  }
  const prev=document.getElementById('photo-preview');
  prev.innerHTML=m.photo?`<img src="${m.photo}" style="width:100%;height:100%;object-fit:cover"/>`:'<span class="photo-placeholder">👤</span>';
  document.getElementById('modal-overlay').style.display='flex';
  document.getElementById('detail-overlay').style.display='none';
}
function clearForm(){
  ['name','phone','job','company','birthday','joindate','address','address-detail','memo'].forEach(f=>{const el=document.getElementById('field-'+f);if(el)el.value='';});
  document.getElementById('photo-preview').innerHTML='<span class="photo-placeholder">👤</span>';
}
async function saveMember(){
  const name=document.getElementById('field-name').value.trim();
  const phone=document.getElementById('field-phone').value.trim();
  if(!name){toast('이름을 입력해주세요','error');return;}
  if(!phone){toast('전화번호를 입력해주세요','error');return;}

  // 중복 체크 (이름 또는 전화번호가 동일한 경우 등록 제외)
  const phoneClean=phone.replace(/\D/g,'');
  const dup=members.find(m=>m.id!==editingId && (m.name===name || (m.phone && m.phone.replace(/\D/g,'')===phoneClean)));
  if(dup){
    toast(`등록 제외: 이미 동일한 이름 또는 전화번호(${dup.name} / ${dup.phone})가 존재합니다.`,'error');
    return;
  }

  const memberId=editingId||Date.now().toString();
  const img=document.getElementById('photo-preview').querySelector('img');
  let photo=img?img.src:'';
  if(photo.startsWith('data:')){
    try{
      const r=storage.ref('photos/'+memberId);
      await r.putString(photo,'data_url');photo=await r.getDownloadURL();
    }catch(e){photo='';}
  }

  // 주소 합치기
  const addrBase=document.getElementById('field-address').value.trim();
  const addrDet=(document.getElementById('field-address-detail')||{value:''}).value.trim();
  const address=addrBase+(addrDet?'||'+addrDet:'');

  const data={name,phone,photo,address,
    gender:'',
    email:'',
    job:document.getElementById('field-job').value.trim(),
    company:document.getElementById('field-company').value.trim(),
    birthday:document.getElementById('field-birthday').value,
    joindate:document.getElementById('field-joindate').value,
    memo:document.getElementById('field-memo').value.trim(),
    updatedAt:new Date().toISOString()};
  try{
    if(useLocalOnly){
      const idx=members.findIndex(x=>x.id===memberId);
      if(idx>=0)members[idx]={id:memberId,...data};else members.push({id:memberId,...data});
      saveCache();render();updateCount();
      toast(editingId?'수정되었습니다 ✅':'등록되었습니다 ✅','success');
    }else{
      await database.ref('members/'+memberId).set({...data,id:memberId});
      toast(editingId?'수정되었습니다 ✅':'등록되었습니다 ✅','success');
    }
    document.getElementById('modal-overlay').style.display='none';
  }catch(e){
    const idx=members.findIndex(x=>x.id===memberId);
    if(idx>=0)members[idx]={id:memberId,...data};else members.push({id:memberId,...data});
    saveCache();render();updateCount();
    toast('로컬에 임시저장 (오류: '+e.code+')','error');
    document.getElementById('modal-overlay').style.display='none';
  }
}

// DELETE
async function delMember(id){
  if(!confirm('이 회원을 삭제하시겠습니까?'))return;
  if(useLocalOnly){
    members=members.filter(m=>m.id!==id);
    saveCache();render();
    document.getElementById('detail-overlay').style.display='none';
    toast('삭제되었습니다','info');
    return;
  }
  try{
    await database.ref('members/'+id).remove();
    try{storage.ref('photos/'+id).delete();}catch(e){}
    document.getElementById('detail-overlay').style.display='none';
    toast('삭제되었습니다','info');
  }catch(e){
    members=members.filter(m=>m.id!==id);
    saveCache();render();
    document.getElementById('detail-overlay').style.display='none';
    toast('로컬에서 삭제 (오류: '+e.code+')','error');
  }
}

// ADDRESS SEARCH
function openAddressSearch(){
  if(typeof daum==='undefined'||!daum.Postcode){
    toast('주소 검색 서비스를 불러오는 중입니다...','info');
    const s=document.createElement('script');
    s.src='https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js';
    s.onload=()=>openAddressSearch();
    document.head.appendChild(s);
    return;
  }
  new daum.Postcode({
    oncomplete:function(data){
      const addr=data.roadAddress||data.jibunAddress;
      document.getElementById('field-address').value=addr;
      const det=document.getElementById('field-address-detail');
      if(det){det.value='';det.focus();}
    },
    width:'100%',height:'100%'
  }).open();
}

// EXCEL
function exportExcel(){
  if(!members.length){toast('내보낼 회원이 없습니다','error');return;}
  const ws=XLSX.utils.json_to_sheet(members.map(m=>({직책:m.job||'',성명:m.name||'',생년월일:m.birthday||'',전화번호:m.phone||'',주소:m.address||'',최초위촉일:m.joindate||'',추천인:m.company||'',비고:m.memo||'',사진:m.photo||''})));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'회원명부');
  XLSX.writeFile(wb,`회원명부_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast('엑셀 다운로드 완료 📥','success');
}
function parseExcelDate(v){
  if(!v) return '';
  if(v instanceof Date){
    if(isNaN(v)) return '';
    const y=v.getFullYear(), m=String(v.getMonth()+1).padStart(2,'0'), d=String(v.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  const s=String(v).trim();
  if(!s) return '';
  if(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)){
    const p=s.split(/[-/.]/);
    return `${p[0]}-${p[1].padStart(2,'0')}-${p[2].padStart(2,'0')}`;
  }
  if(/^\d{4,5}$/.test(s)){
    const serial=parseInt(s,10);
    // 엑셀 날짜 일련번호(1900-01-01 기준)를 JS 날짜로 변환
    const date=new Date(Math.round((serial-25569)*86400*1000));
    const y=date.getUTCFullYear(), m=String(date.getUTCMonth()+1).padStart(2,'0'), d=String(date.getUTCDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  if(/^\d{8}$/.test(s)){
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  }
  if(/^\d{6}$/.test(s)){
    const yy=parseInt(s.slice(0,2),10);
    const year=yy>30?1900+yy:2000+yy;
    return `${year}-${s.slice(2,4)}-${s.slice(4,6)}`;
  }
  const parsed=new Date(s);
  if(!isNaN(parsed)){
    const y=parsed.getFullYear(), m=String(parsed.getMonth()+1).padStart(2,'0'), d=String(parsed.getDate()).padStart(2,'0');
    return `${y}-${m}-${d}`;
  }
  return s;
}
function importExcel(file){
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      const updates={};
      let n=0;
      let dupCount=0;
      const existingNames=new Set(members.map(m=>m.name));
      const existingPhones=new Set(members.map(m=>(m.phone||'').replace(/\D/g,'')).filter(Boolean));

      rows.forEach(r=>{
        const name=String(r['성명']||r['이름']||r['name']||'').trim();if(!name)return;
        const phone=String(r['전화번호']||r['phone']||'').trim();
        const phoneClean=phone.replace(/\D/g,'');

        if(existingNames.has(name) || (phoneClean && existingPhones.has(phoneClean))){
          dupCount++;
          return;
        }
        existingNames.add(name);
        if(phoneClean)existingPhones.add(phoneClean);

        const id=Date.now().toString()+'_'+n+'_'+Math.random().toString(36).substr(2,5);
        updates[id]={
          id,
          name,
          job:String(r['직책']||r['직업']||r['job']||'').trim(),
          birthday:parseExcelDate(r['생년월일']||r['birthday']),
          phone,
          address:String(r['주소']||r['address']||'').trim(),
          joindate:parseExcelDate(r['최초위촉일']||r['가입일']||r['joindate']),
          company:String(r['추천인']||r['소속']||r['company']||'').trim(),
          memo:String(r['비고']||r['메모']||r['memo']||'').trim(),
          photo:String(r['사진']||r['photo']||'').trim()};
        n++;
      });
      if(!n){
        toast(dupCount?`중복 회원 ${dupCount}명 제외 후 가져올 데이터가 없습니다.`:'가져올 회원 데이터가 없습니다','error');
        return;
      }

      if(useLocalOnly){
        Object.values(updates).forEach(m=>members.push(m));
        saveCache();render();updateCount();
        toast(`${n}명 로컬 가져오기 완료 📤`+(dupCount?` (중복 제외: ${dupCount}명)`:''),'success');
      }else{
        // 화면 즉시 갱신을 위해 로컬 배열에 선반영
        Object.values(updates).forEach(m=>members.push(m));
        saveCache();render();updateCount();

        await database.ref('members').update(updates);
        toast(`${n}명 엑셀 업로드 완료 📤`+(dupCount?` (중복 제외: ${dupCount}명)`:''),'success');
      }
    }catch(err){toast('파일 읽기 오류: '+err.message,'error');}
  };reader.readAsArrayBuffer(file);
}

// LOGO
function applyLogo(){
  document.getElementById('logo-title').textContent=logoName;
  const img=document.getElementById('logo-img');
  const ph=document.getElementById('logo-placeholder');
  if(logoImg){img.src=logoImg;img.style.display='';ph.style.display='none';}
  else{img.style.display='none';ph.style.display='';}
}

// TOAST
function toast(msg,type='info'){
  const el=document.createElement('div');
  el.className=`toast ${type}`;
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  el.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(()=>el.remove(),3000);
}

// HELPERS
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function fmtDate(d){
  if(!d||d==='-')return'-';
  let s=String(d).trim();
  
  // 만약 4~5자리 숫자(엑셀 일련번호)라면 먼저 날짜 문자열로 변환
  if(/^\d{4,5}$/.test(s)){
    const serial=parseInt(s,10);
    const date=new Date(Math.round((serial-25569)*86400*1000));
    const yr=date.getUTCFullYear(), mt=String(date.getUTCMonth()+1).padStart(2,'0'), dy=String(date.getUTCDate()).padStart(2,'0');
    s=`${yr}-${mt}-${dy}`;
  }

  const p=s.split(/[-/.]/);
  if(p.length===3){
    const yr=p[0], mt=String(p[1]).padStart(2,'0'), dy=String(p[2]).padStart(2,'0');
    return `${yr}년 ${mt}월 ${dy}일`;
  }
  return s;
}

// VIEW SWITCH
function switchView(view){
  currentView=view;
  ['list','card','stats'].forEach(v=>{
    document.getElementById(`view-${v}-section`).style.display=v===view?'':'none';
    const n=document.getElementById(`nav-${v}`);if(n)n.classList.toggle('active',v===view);
  });
  const titles={list:'전체 회원',card:'카드 보기',stats:'통계'};
  document.getElementById('page-title').textContent=titles[view]||'';
  if(view==='stats')renderStats();else render();
}

// ===== EVENTS =====
// Login
document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-pw-input').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin();});

// Admin gear
document.getElementById('btn-admin-gear').addEventListener('click',()=>{
  if(!isLoggedIn){showLogin();return;}
  if(isAdmin){
    document.getElementById('admin-login-panel').style.display='none';
    document.getElementById('admin-menu-panel').style.display='';
    document.getElementById('admin-modal-title').textContent='⚙️ 관리자 메뉴';
  }else{
    document.getElementById('admin-login-panel').style.display='';
    document.getElementById('admin-menu-panel').style.display='none';
    document.getElementById('admin-modal-title').textContent='⚙️ 관리자 로그인';
    document.getElementById('admin-pw-input').value='';
    document.getElementById('pw-error').style.display='none';
  }
  document.getElementById('admin-overlay').style.display='flex';
});
document.getElementById('admin-modal-close').addEventListener('click',()=>document.getElementById('admin-overlay').style.display='none');
document.getElementById('admin-login-cancel').addEventListener('click',()=>document.getElementById('admin-overlay').style.display='none');
document.getElementById('admin-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

document.getElementById('admin-login-btn').addEventListener('click',()=>{
  const pw=document.getElementById('admin-pw-input').value;
  if(pw===adminPw){isAdmin=true;document.getElementById('admin-overlay').style.display='none';applyAdminUI();toast('관리자 모드 활성화','success');}
  else{document.getElementById('pw-error').style.display='block';}
});
document.getElementById('admin-pw-input').addEventListener('keydown',e=>{if(e.key==='Enter')document.getElementById('admin-login-btn').click();});

// Admin menu items
document.getElementById('btn-downgrade-admin').addEventListener('click',()=>{
  isAdmin=false;document.getElementById('admin-overlay').style.display='none';applyAdminUI();toast('일반 모드로 전환되었습니다','info');
});
document.getElementById('btn-delete-all-data')?.addEventListener('click',async ()=>{
  const input=prompt('⚠️ 데이터 전체 삭제\n\n모든 회원 데이터가 영구적으로 삭제됩니다.\n계속하려면 관리자 비밀번호를 입력하세요:');
  if(input===null)return;
  if(input!==adminPw){
    toast('비밀번호가 일치하지 않습니다. 삭제가 취소되었습니다.','error');
    return;
  }
  if(!confirm('정말 모든 회원 데이터를 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.'))return;

  document.getElementById('admin-overlay').style.display='none';
  members=[];
  saveCache();
  render();
  updateCount();
  if(!useLocalOnly&&database){
    try{
      await database.ref('members').remove();
      toast('모든 데이터가 성공적으로 삭제되었습니다 🗑️','success');
    }catch(e){
      toast('클라우드 데이터 삭제 실패: '+e.message,'error');
    }
  }else{
    toast('로컬 데이터가 전체 삭제되었습니다 🗑️','success');
  }
});
document.getElementById('btn-logout-all').addEventListener('click',()=>{
  document.getElementById('admin-overlay').style.display='none';
  showLogin();
  toast('로그아웃되었습니다','info');
});
document.getElementById('admin-menu-close').addEventListener('click',()=>document.getElementById('admin-overlay').style.display='none');

// Settings Visibility
document.getElementById('btn-settings-visibility')?.addEventListener('click',()=>{
  document.getElementById('admin-overlay').style.display='none';
  ['job','name','birthday','phone','address','joindate','company','memo'].forEach(k=>{
    const cb=document.getElementById('vis-'+k);
    if(cb)cb.checked=fieldVisibility[k]!==false;
  });
  document.getElementById('visibility-overlay').style.display='flex';
});
document.getElementById('visibility-close')?.addEventListener('click',()=>document.getElementById('visibility-overlay').style.display='none');
document.getElementById('visibility-cancel')?.addEventListener('click',()=>document.getElementById('visibility-overlay').style.display='none');
document.getElementById('visibility-overlay')?.addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
document.getElementById('visibility-save')?.addEventListener('click',async ()=>{
  ['job','name','birthday','phone','address','joindate','company','memo'].forEach(k=>{
    const cb=document.getElementById('vis-'+k);
    if(cb)fieldVisibility[k]=cb.checked;
  });
  localStorage.setItem('fieldVisibility',JSON.stringify(fieldVisibility));
  render();
  if(!useLocalOnly&&database){try{await database.ref('settings/fieldVisibility').set(fieldVisibility);}catch(err){console.error(err);}}
  document.getElementById('visibility-overlay').style.display='none';
  toast('일반모드 공개 설정이 저장되었습니다 💾','success');
});

// Change PW (user)
document.getElementById('btn-change-user-pw').addEventListener('click',()=>{
  changingPwTarget='user';
  document.getElementById('changepw-title').textContent='🔑 일반 비밀번호 변경';
  document.getElementById('new-pw').value='';document.getElementById('new-pw2').value='';
  document.getElementById('changepw-error').style.display='none';
  document.getElementById('admin-overlay').style.display='none';
  document.getElementById('changepw-overlay').style.display='flex';
});
// Change PW (admin)
document.getElementById('btn-change-admin-pw').addEventListener('click',()=>{
  changingPwTarget='admin';
  document.getElementById('changepw-title').textContent='🛡️ 관리자 비밀번호 변경';
  document.getElementById('new-pw').value='';document.getElementById('new-pw2').value='';
  document.getElementById('changepw-error').style.display='none';
  document.getElementById('admin-overlay').style.display='none';
  document.getElementById('changepw-overlay').style.display='flex';
});
document.getElementById('changepw-close').addEventListener('click',()=>document.getElementById('changepw-overlay').style.display='none');
document.getElementById('changepw-cancel').addEventListener('click',()=>document.getElementById('changepw-overlay').style.display='none');
document.getElementById('changepw-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
document.getElementById('changepw-save').addEventListener('click',()=>{
  const nw=document.getElementById('new-pw').value;
  const nw2=document.getElementById('new-pw2').value;
  const err=document.getElementById('changepw-error');
  if(!nw){err.textContent='새 비밀번호를 입력하세요';err.style.display='block';return;}
  if(nw!==nw2){err.textContent='비밀번호가 일치하지 않습니다';err.style.display='block';return;}
  if(changingPwTarget==='user'){userPw=nw;localStorage.setItem('userPw',userPw);toast('일반 비밀번호가 변경되었습니다 🔑','success');}
  else{adminPw=nw;localStorage.setItem('adminPw',adminPw);toast('관리자 비밀번호가 변경되었습니다 🛡️','success');}
  document.getElementById('changepw-overlay').style.display='none';
});

// Logo image
document.getElementById('logo-img-input').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();r.onload=ev=>{logoImg=ev.target.result;localStorage.setItem('logoImg',logoImg);applyLogo();};
  r.readAsDataURL(f);e.target.value='';
});

// Logo name
document.getElementById('logo-name-edit-btn').addEventListener('click',()=>{
  document.getElementById('logoname-input').value=logoName;
  document.getElementById('logoname-overlay').style.display='flex';
});
document.getElementById('logoname-close').addEventListener('click',()=>document.getElementById('logoname-overlay').style.display='none');
document.getElementById('logoname-cancel').addEventListener('click',()=>document.getElementById('logoname-overlay').style.display='none');
document.getElementById('logoname-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
document.getElementById('logoname-save').addEventListener('click',()=>{
  const v=document.getElementById('logoname-input').value.trim();
  if(!v){toast('이름을 입력하세요','error');return;}
  logoName=v;localStorage.setItem('logoName',logoName);applyLogo();
  document.getElementById('logoname-overlay').style.display='none';toast('로고 이름이 변경되었습니다','success');
});

// Member modal
document.getElementById('btn-add').addEventListener('click',openAdd);
document.getElementById('btn-add-empty')?.addEventListener('click',openAdd);
document.getElementById('btn-save').addEventListener('click',saveMember);
document.getElementById('btn-cancel').addEventListener('click',()=>document.getElementById('modal-overlay').style.display='none');
document.getElementById('modal-close').addEventListener('click',()=>document.getElementById('modal-overlay').style.display='none');
document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});

// Detail modal
document.getElementById('detail-close').addEventListener('click',()=>document.getElementById('detail-overlay').style.display='none');
document.getElementById('detail-dismiss').addEventListener('click',()=>document.getElementById('detail-overlay').style.display='none');
document.getElementById('detail-overlay').addEventListener('click',e=>{if(e.target===e.currentTarget)e.currentTarget.style.display='none';});
document.getElementById('btn-detail-edit').addEventListener('click',()=>openEdit(detailId));
document.getElementById('btn-detail-delete').addEventListener('click',()=>delMember(detailId));

// Excel
document.getElementById('btn-export').addEventListener('click',exportExcel);
document.getElementById('excel-upload').addEventListener('change',e=>{if(e.target.files[0]){importExcel(e.target.files[0]);e.target.value='';}});

// Photo input → open cropper
document.getElementById('photo-input').addEventListener('change',e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();r.onload=ev=>openCropper(ev.target.result);
  r.readAsDataURL(f);e.target.value='';
});
document.getElementById('photo-remove').addEventListener('click',()=>document.getElementById('photo-preview').innerHTML='<span class="photo-placeholder">👤</span>');

// CROP FUNCTIONS
function openCropper(src){
  const img=document.getElementById('crop-img');
  cropScale=1;cropX=0;cropY=0;
  img.src=src;
  img.onload=()=>{
    const c=document.getElementById('crop-container');
    const guideSize=c.offsetWidth*0.8;
    const minDim=Math.min(img.naturalWidth,img.naturalHeight);
    cropScale=guideSize/minDim;
    applyXform();
    document.getElementById('crop-overlay').style.display='flex';
  };
}
function applyXform(){
  const img=document.getElementById('crop-img');
  img.style.transform=`translate(calc(-50% + ${cropX}px),calc(-50% + ${cropY}px)) scale(${cropScale})`;
  const pct=Math.round(cropScale*100);
  document.getElementById('crop-slider').value=Math.min(500,pct);
  document.getElementById('crop-scale-label').textContent=pct+'%';
}
function getCropResult(){
  const img=document.getElementById('crop-img');
  const gRect=document.getElementById('crop-guide').getBoundingClientRect();
  const iRect=img.getBoundingClientRect();
  const OUT=400;
  const canvas=document.createElement('canvas');canvas.width=OUT;canvas.height=OUT;
  const ctx=canvas.getContext('2d');
  ctx.beginPath();ctx.arc(OUT/2,OUT/2,OUT/2,0,Math.PI*2);ctx.clip();
  const s=OUT/gRect.width;
  ctx.drawImage(img,0,0,img.naturalWidth,img.naturalHeight,
    (iRect.left-gRect.left)*s,(iRect.top-gRect.top)*s,iRect.width*s,iRect.height*s);
  return canvas.toDataURL('image/jpeg',0.92);
}

// Crop: mouse
const cc=document.getElementById('crop-container');
cc.addEventListener('mousedown',e=>{cropDragging=true;cropLX=e.clientX;cropLY=e.clientY;e.preventDefault();});
document.addEventListener('mousemove',e=>{if(!cropDragging)return;cropX+=e.clientX-cropLX;cropY+=e.clientY-cropLY;cropLX=e.clientX;cropLY=e.clientY;applyXform();});
document.addEventListener('mouseup',()=>{cropDragging=false;});
// Crop: wheel
cc.addEventListener('wheel',e=>{e.preventDefault();const d=e.deltaY>0?-0.05:0.05;cropScale=Math.max(0.3,Math.min(5,cropScale*(1+d)));applyXform();},{passive:false});
// Crop: touch
cc.addEventListener('touchstart',e=>{
  if(e.touches.length===1){cropDragging=true;cropLX=e.touches[0].clientX;cropLY=e.touches[0].clientY;}
  else if(e.touches.length===2){cropDragging=false;pinchD0=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);pinchS0=cropScale;}
  e.preventDefault();
},{passive:false});
cc.addEventListener('touchmove',e=>{
  if(e.touches.length===1&&cropDragging){cropX+=e.touches[0].clientX-cropLX;cropY+=e.touches[0].clientY-cropLY;cropLX=e.touches[0].clientX;cropLY=e.touches[0].clientY;}
  else if(e.touches.length===2){const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);cropScale=Math.max(0.3,Math.min(5,pinchS0*(d/pinchD0)));}
  applyXform();e.preventDefault();
},{passive:false});
cc.addEventListener('touchend',()=>{cropDragging=false;});
// Crop: slider & buttons
document.getElementById('crop-slider').addEventListener('input',e=>{cropScale=e.target.value/100;applyXform();});
document.getElementById('crop-zoom-in').addEventListener('click',()=>{cropScale=Math.min(5,cropScale*1.15);applyXform();});
document.getElementById('crop-zoom-out').addEventListener('click',()=>{cropScale=Math.max(0.3,cropScale/1.15);applyXform();});
// Crop: apply/cancel
document.getElementById('crop-apply').addEventListener('click',()=>{
  const url=getCropResult();
  document.getElementById('photo-preview').innerHTML=`<img src="${url}" style="width:100%;height:100%;object-fit:cover"/>`;
  document.getElementById('crop-overlay').style.display='none';
});
document.getElementById('crop-cancel').addEventListener('click',()=>document.getElementById('crop-overlay').style.display='none');
document.getElementById('crop-close').addEventListener('click',()=>document.getElementById('crop-overlay').style.display='none');

// Search
const si=document.getElementById('search-input'),sc=document.getElementById('search-clear');
si.addEventListener('input',()=>{searchQ=si.value;sc.classList.toggle('visible',!!searchQ);currentPage=1;cardPage=1;render();});
sc.addEventListener('click',()=>{si.value='';searchQ='';sc.classList.remove('visible');currentPage=1;cardPage=1;render();});

// Sort
document.querySelectorAll('.sortable').forEach(th=>th.addEventListener('click',()=>{const c=th.dataset.col;if(sortCol===c)sortDir*=-1;else{sortCol=c;sortDir=1;}currentPage=1;render();}));

// View toggle
document.getElementById('view-list-btn').addEventListener('click',()=>{document.getElementById('view-list-btn').classList.add('active');document.getElementById('view-grid-btn').classList.remove('active');switchView('list');});
document.getElementById('view-grid-btn').addEventListener('click',()=>{document.getElementById('view-grid-btn').classList.add('active');document.getElementById('view-list-btn').classList.remove('active');switchView('card');});

// Sidebar toggle (mobile-aware)
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const bd=document.getElementById('sidebar-backdrop');
  if(window.innerWidth<=768){
    const open=sb.classList.toggle('open');
    bd.classList.toggle('open',open);
  }else{
    sb.classList.toggle('collapsed');
    document.querySelector('.main-content').classList.toggle('expanded');
  }
}
document.getElementById('btn-menu').addEventListener('click',toggleSidebar);
document.getElementById('sidebar-backdrop').addEventListener('click',()=>{
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-backdrop').classList.remove('open');
});

// Nav (카드보기/통계 포함 모든 메뉴)
document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',e=>{
  e.preventDefault();
  switchView(item.dataset.view);
  // 모바일에서 nav 클릭 시 사이드바 닫기
  if(window.innerWidth<=768){
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-backdrop').classList.remove('open');
  }
}));

// Phone format
document.getElementById('field-phone').addEventListener('input',e=>{let v=e.target.value.replace(/\D/g,'');if(v.length<=7)v=v.replace(/(\d{3})(\d+)/,'$1-$2');else v=v.replace(/(\d{3})(\d{4})(\d+)/,'$1-$2-$3');e.target.value=v.slice(0,13);});

// INIT
applyLogo();
showLogin();
