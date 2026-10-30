import {firebaseConfig} from './firebase-config.js';
import {money, dollarsToCents, balance} from './quota.js';
import {createLedger} from './ledger.js';
import {catalog} from './catalog.js?v=20261030-2';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const preview = new URLSearchParams(location.search).get('preview');
const state = {admin: false, user: null, members: [], view: 'overview', busy: false, epoch: 0};
let auth, db, fs, authSdk, ledger, toastTimer;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function errorMessage(error) {
  const code = error?.code;
  const map = {
    'permission-denied':'無法存取資料，請確認帳號權限或聯絡管理員。',
    'unavailable':'服務暫時無法連線，請稍後重試。相同表單的重試不會重複加額。',
    'resource-exhausted':'免費使用限制已達上限，請稍後重試或聯絡管理員。',
    'auth/unauthorized-domain':'這個網站網址尚未完成登入設定，請聯絡管理員。',
    'auth/popup-blocked':'瀏覽器阻擋登入視窗，請允許彈出視窗後重試。',
    'auth/popup-closed-by-user':'登入視窗已關閉，可重新登入。',
    'auth/network-request-failed':'登入服務無法連線，請確認網路後重試。'
  };
  return map[code] || error?.message || '操作未完成，請稍後重試。';
}
function meter(member) {
  const b = balance(member);
  return `<div class="meter" role="img" aria-label="已使用 ${escape(money(member.charged_cents))}，預留 ${escape(money(member.reserved_cents))}，可用 ${escape(money(b.available))}"><span class="meter-used" style="width:${b.usedPercent}%"></span><span class="meter-reserved" style="width:${b.reservedPercent}%"></span></div>`;
}
function legend(member) {
  return `<div class="legend"><span><i class="used"></i>已使用 ${escape(money(member.charged_cents))}</span><span><i class="reserved"></i>預留 ${escape(money(member.reserved_cents))}</span><span><i></i>可用 ${escape(money(balance(member).available))}</span></div>`;
}
function dateLabel(timestamp) {
  if (!timestamp) return '尚未同步';
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleString('zh-TW', {timeZone: 'Asia/Taipei', month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
}
function render() {
  const list = state.members;
  const hasData = list.length > 0;
  const historyView = state.view === 'history';
  document.querySelectorAll('.admin-only').forEach(el => el.hidden = !state.admin);
  document.querySelectorAll('[data-view]').forEach(el => { el.classList.toggle('selected', el.dataset.view === state.view); el.setAttribute('aria-current', el.dataset.view === state.view ? 'page' : 'false'); });
  const titles = {overview:['','額度總覽',''],members:['','成員管理',''],history:['','額度紀錄','']};
  const title = titles[state.view];
  $('#page-title').textContent = title[1];
  $('#role-chip').textContent = state.admin ? '管理員' : '研究成員';
  $('#stats').hidden = historyView || !hasData || state.view === 'members';
  $('#allocation-panel').hidden = historyView || !hasData || state.view === 'members';
  $('#member-panel').hidden = !state.admin || historyView;
  $('#history-panel').hidden = !historyView;
  $('#catalog-panel').hidden = historyView || state.view === 'members' || !hasData;
  if(hasData){
    const expired=Date.now()>=Date.parse(catalog.priceReviewBefore);
    $('#catalog-list').innerHTML=catalog.machines.map(m=>`<article class="catalog-row"><div><strong>${escape(m.family)}</strong><span class="chip">${escape(m.status)}</span><p>${escape(m.machine)} · ${m.chips} chips</p><p>${escape(m.zones.join(' / '))}</p><p>${escape(m.detail)}</p></div><div class="catalog-price">${expired?'待更新費率':`${escape(money(m.hourlyCents))}<small> / 小時</small>`}<small>${expired?'官方預告 11 月調價':`費率核對 ${catalog.reviewedAt}`}</small></div></article>`).join('');
  }
  $('#empty-state').hidden = hasData || historyView;
  if (!hasData && !historyView) {
    $('#empty-state').innerHTML = state.admin ? '尚未新增成員。使用右上角「新增成員」派發第一筆研究額度。' : `這個 Google 帳號尚未獲配研究額度。<br>請將登入 Email 提供給管理員。<details><summary>帳號資訊</summary><code>UID: ${escape(state.user?.uid)}</code></details>`;
  }
  if (hasData) {
    const total = list.reduce((a,m) => ({quota_cents:a.quota_cents+m.quota_cents,charged_cents:a.charged_cents+m.charged_cents,reserved_cents:a.reserved_cents+m.reserved_cents}), {quota_cents:0,charged_cents:0,reserved_cents:0});
    const b = balance(total);
    const stats = [
      ['總核發額度',total.quota_cents,state.admin?`${list.length} 位研究成員`:'累計取得的研究使用額度','◫'],
      ['已使用 · 已結算',total.charged_cents,`另有 ${money(total.reserved_cents)} 預留中`,'↗'],
      ['剩餘可用額度',b.available,'總額度 − 已使用 − 預留','◷']
    ];
    $('#stats').innerHTML = stats.map(([label,value,foot,icon])=>`<article class="stat"><div class="stat-label">${label}<span class="stat-icon" aria-hidden="true">${icon}</span></div><div class="stat-value">${escape(money(value))}</div><div class="stat-foot">${escape(foot)}</div></article>`).join('');
    const percent = total.quota_cents ? (total.charged_cents / total.quota_cents * 100).toFixed(1) : '0';
    $('#allocation').innerHTML = `<div class="allocation-body"><div class="bar-heading"><span>已結算使用率</span><strong>${percent}%</strong></div>${meter(total)}${legend(total)}</div>`;
    const unsynced = list.some(m=>!m.cost_sync_at);
    $('#data-notice').hidden = false;
    $('#data-notice').textContent = unsynced ? 'TPU 自助申請與費用同步尚未完成。已使用金額為管理帳本數值，尚不能視為 Google 的實際帳單；核發額度也不代表已建立 TPU。' : '使用費用以最後一次核對為準；仍在排隊或執行的工作會先預留額度。';
    if (b.overage) $('#data-notice').textContent += ` 目前超出已核發額度 ${money(b.overage)}，請聯絡管理員。`;
    $('#updated-at').textContent = preview ? '示範資料' : `最近讀取 · ${dateLabel(new Date())}`;
  } else $('#data-notice').hidden = true;
  renderMembers();
}
function renderMembers() {
  if (!state.admin) { $('#member-list').replaceChildren(); return; }
  const search = $('#search').value.trim().toLowerCase();
  const list = state.members.filter(m=>[m.name,m.email,m.member_id].join(' ').toLowerCase().includes(search));
  $('#member-count').textContent = `共 ${state.members.length} 位成員${search ? ` · ${list.length} 筆符合搜尋` : ''}`;
  $('#member-list').innerHTML = list.length ? list.map(m=>`<article class="member-row" data-email="${escape(m.email)}"><div class="member-person"><span class="avatar" aria-hidden="true">${escape(m.name.slice(0,1))}</span><div><div class="member-name">${escape(m.name)}${m.enabled?'':'<span class="paused">已停用</span>'}</div><div class="member-email">${escape(m.email)}</div></div></div><div class="member-progress"><div class="member-amounts"><span>${escape(money(m.charged_cents))}<small> 已使用</small></span><span><small>共 </small>${escape(money(m.quota_cents))}</span></div>${meter(m)}</div><div class="remaining"><small>剩餘可用</small>${escape(money(balance(m).available))}</div><div class="row-actions"><button class="text-button" data-grant="${escape(m.email)}" ${preview?'disabled':''}>＋ 派發額度</button>${state.view==='members'?`<button class="text-button" data-toggle="${escape(m.email)}" ${preview?'disabled':''}>${m.enabled?'停用':'啟用'}</button>`:''}</div></article>`).join('') : '<div class="empty">沒有符合的成員。</div>';
}
async function loadMembers() {
  const epoch = state.epoch;
  if (preview) { render(); return; }
  const {getDoc, getDocs, doc, collection} = fs;
  const members = state.admin ? (await getDocs(collection(db, 'members'))).docs.map(d=>d.data()) : await (async()=>{ const d = await getDoc(doc(db, 'members', state.user.email.toLowerCase())); return d.exists() ? [d.data()] : []; })();
  members.forEach(balance);
  if (epoch !== state.epoch) return;
  state.members = members.sort((a,b)=>a.name.localeCompare(b.name,'zh-TW'));
  render();
}
async function loadHistory() {
  if (preview) { $('#history-list').innerHTML = '<div class="empty">設計預覽不包含真實派發紀錄。</div>'; return; }
  const epoch = state.epoch;
  $('#history-list').innerHTML = '<div class="loading">讀取紀錄中…</div>';
  const records = await fs.getDocs(fs.query(fs.collection(db,'quota_transactions'),fs.orderBy('created_at','desc'),fs.limit(50)));
  if (epoch !== state.epoch) return;
  $('#history-list').innerHTML = records.empty ? '<div class="empty">尚無派發紀錄。</div>' : records.docs.map(d=>{const a=d.data();return `<div class="history-row"><strong>${escape(a.member_email)}</strong><span class="history-reason">${escape(a.reason)}</span><span class="positive">＋${escape(money(a.delta_cents))}</span><time>${escape(dateLabel(a.created_at))}</time></div>`;}).join('');
}
async function changeView(view) {
  if (view!=='overview' && !state.admin) return;
  state.view=view; render();
  if (view==='history') { try {await loadHistory();} catch(error) {$('#history-list').textContent=errorMessage(error);} }
}
function operation(form, payload) {
  const key = JSON.stringify(payload);
  if (form.dataset.operationKey !== key) {form.dataset.operationKey=key;form.dataset.operationId=crypto.randomUUID();}
  return form.dataset.operationId;
}
async function submitAllocation(form, member) {
  if (!state.admin || preview || state.busy) return;
  const epoch=state.epoch;
  const values=Object.fromEntries(new FormData(form));
  const email=member ? values.email.trim().toLowerCase() : form.dataset.email;
  const payload={email,amount:values.amount,reason:values.reason.trim(),...(member?{name:values.name.trim(),member_id:values.member_id.trim()}: {})};
  const operationId=operation(form,payload);
  const button=form.querySelector('[type=submit]');
  const errorElement=form.querySelector('.form-error');
  errorElement.textContent=''; state.busy=true; button.disabled=true;
  form.querySelectorAll('input,textarea,[data-close]').forEach(el=>el.disabled=true);
  try {
    const total=await ledger.allocate({uid:state.user.uid,email,amount:values.amount,reason:payload.reason,operationId,...(member?{member:payload}:{})});
    if(epoch!==state.epoch)return;
    form.closest('dialog').close();
    toast(`派發成功 · 總額度 ${money(total)}`);
    try {await loadMembers();if(state.view==='history') await loadHistory();} catch {toast('派發已完成，畫面更新失敗。請按「更新」取得最新額度。');}
  } catch(error) {errorElement.textContent=errorMessage(error);}
  finally {state.busy=false;button.disabled=false;form.querySelectorAll('input,textarea,[data-close]').forEach(el=>el.disabled=false);}
}
function openGrant(email) {
  if (!state.admin || preview) return;
  const m=state.members.find(x=>x.email===email); if(!m) return;
  const form=$('#grant-form');form.reset();form.dataset.email=email;delete form.dataset.operationKey;delete form.dataset.operationId;form.querySelector('.form-error').textContent='';
  $('#grant-person').innerHTML=`<strong>${escape(m.name)}</strong>${escape(m.email)}`;
  const review=()=>{try{const cents=dollarsToCents(form.elements.amount.value);$('#grant-review').textContent=`總額度 ${money(m.quota_cents)} → ${money(m.quota_cents+cents)}。已使用與預留金額維持原紀錄。`;}catch{$('#grant-review').textContent=`目前總額度 ${money(m.quota_cents)}。請輸入本次增加金額。`;}};
  form.elements.amount.oninput=review;review();$('#grant-dialog').showModal();
}
$('#signin').addEventListener('click',async()=>{if(!auth)return;$('#signin').disabled=true;try{await authSdk.signInWithPopup(auth,new authSdk.GoogleAuthProvider());}catch(error){$('#setup-message').textContent=errorMessage(error);}finally{$('#signin').disabled=false;}});
$('#signout').addEventListener('click',async()=>{if(preview){location.href=location.pathname;return;}await authSdk.signOut(auth);});
$('#refresh').addEventListener('click',async()=>{if(state.busy)return;$('#refresh').disabled=true;try{await loadMembers();if(state.view==='history')await loadHistory();}catch(error){toast(errorMessage(error));}finally{$('#refresh').disabled=false;}});
document.querySelectorAll('[data-view]').forEach(button=>button.addEventListener('click',()=>changeView(button.dataset.view)));
$('#search').addEventListener('input',renderMembers);
$('#new-member').addEventListener('click',()=>{if(!state.admin||preview)return;const form=$('#member-form');form.reset();delete form.dataset.operationKey;form.querySelector('.form-error').textContent='';$('#member-dialog').showModal();});
document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>{if(!state.busy)button.closest('dialog').close();}));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('cancel',event=>{if(state.busy)event.preventDefault();}));
$('#member-form').addEventListener('submit',event=>{event.preventDefault();submitAllocation(event.currentTarget,true);});
$('#grant-form').addEventListener('submit',event=>{event.preventDefault();submitAllocation(event.currentTarget,false);});
$('#member-list').addEventListener('click',async event=>{
  const grant=event.target.closest('[data-grant]');if(grant){openGrant(grant.dataset.grant);return;}
  const toggle=event.target.closest('[data-toggle]');
  if(toggle && state.admin && !preview && !state.busy){const m=state.members.find(x=>x.email===toggle.dataset.toggle);if(!confirm(`${m.enabled?'停用':'啟用'} ${m.name}（${m.email}）的新工作申請資格？既有 TPU 必須另外處理。`))return;toggle.disabled=true;try{await ledger.setEnabled(m.email,!m.enabled);await loadMembers();toast('成員狀態已更新。');}catch(error){toast(errorMessage(error));}finally{toggle.disabled=false;}return;}
});

async function start() {
  if(preview){
    $('#preview-banner').hidden=false;state.admin=preview!=='member';state.user={uid:'preview',email:'preview@example.invalid'};
    state.members=[{email:'researcher-a@example.invalid',name:'研究成員 A',member_id:'researcher-a',quota_cents:20000,charged_cents:7250,reserved_cents:2000,enabled:true,cost_sync_at:null},{email:'researcher-b@example.invalid',name:'研究成員 B',member_id:'researcher-b',quota_cents:15000,charged_cents:3800,reserved_cents:0,enabled:true,cost_sync_at:null}];
    if(!state.admin)state.members=state.members.slice(0,1);
    $('#landing').hidden=true;$('#workspace').hidden=false;$('#identity').hidden=false;$('#account-email').textContent='設計預覽';$('#new-member').disabled=true;render();return;
  }
  if(!firebaseConfig){$('#setup-message').textContent='登入服務尚未完成連接。完成 Firebase Web app 設定後即可使用。';$('#signin').disabled=true;return;}
  $('#setup-message').textContent='正在連接安全登入服務…';
  try{
    const [appSdk,a,f]=await Promise.all([import('https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js'),import('https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js')]);
    authSdk=a;fs=f;const app=appSdk.initializeApp(firebaseConfig);auth=a.getAuth(app);db=f.getFirestore(app);ledger=createLedger(db,f);
    await a.setPersistence(auth,a.browserSessionPersistence);
    $('#setup-message').textContent='僅限已獲配額的研究成員。';
    a.onAuthStateChanged(auth,async user=>{
      state.epoch++;state.user=user;state.members=[];state.admin=false;state.view='overview';$('#member-list').replaceChildren();$('#history-list').replaceChildren();$('#stats').replaceChildren();$('#allocation').replaceChildren();document.querySelectorAll('dialog').forEach(d=>d.close());
      $('#landing').hidden=!!user;$('#workspace').hidden=!user;$('#identity').hidden=!user;
      if(!user)return;
      const epoch=state.epoch;$('#account-email').textContent=user.email||'';$('#empty-state').hidden=false;$('#empty-state').textContent='正在讀取你的研究額度…';
      try{
        const token=await user.getIdTokenResult();
        if(!token.claims.email_verified || token.signInProvider!=='google.com')throw new Error('請使用已驗證的 Google 帳號登入。');
        const adminDoc=await f.getDoc(f.doc(db,'admins',user.uid));
        if(epoch!==state.epoch)return;
        state.admin=adminDoc.exists() && adminDoc.data().enabled===true && adminDoc.data().email===user.email.toLowerCase();
        await loadMembers();
      }catch(error){if(epoch!==state.epoch)return;state.members=[];render();$('#empty-state').textContent=errorMessage(error);$('#empty-state').hidden=false;}
    });
  }catch(error){$('#setup-message').textContent=errorMessage(error);$('#signin').disabled=true;}
}
start();
