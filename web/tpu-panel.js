import {createTpuClient} from './tpu-client.js';
import {money,dollarsToCents} from './quota.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses={REQUESTED:'已預留，尚未送出建機',CREATING:'建機請求處理中',QUEUED:'等待資源',RUNNING:'執行中',DELETING:'刪除中',UNKNOWN:'需核對雲端狀態',SETTLEMENT_PENDING:'已結束，待費用核對',COMPLETED:'已結算',CANCELLED:'已取消'};
const active=new Set(['REQUESTED','CREATING','QUEUED','RUNNING','DELETING','UNKNOWN']);
const date=ms=>ms?new Date(ms).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';
export function mountTpuPanel({root,base,getToken,admin,onChange,preview=false}) {
  let disposed=false,busy=false,quote=null,operationId=null,jobs=[];
  const abort=new AbortController();const opt={signal:abort.signal};
  const $=selector=>root.querySelector(selector);
  const api=preview?null:createTpuClient(base,getToken);
  const notice=$('[data-tpu-notice]'),list=$('[data-jobs]'),form=$('[data-request]'),settle=$('[data-settlement]');
  form.hidden=admin;settle.hidden=true;
  function message(text){if(!disposed)notice.textContent=text;}
  function controls() {
    root.querySelectorAll('button,input,select,textarea').forEach(el=>el.disabled=busy||preview);
  }
  function render() {
    list.innerHTML=jobs.length?jobs.map(j=>`<article class="job-row" data-job="${esc(j.job_id)}"><div class="job-title"><strong>${esc(j.machine_type)}</strong><span class="chip">${esc(statuses[j.status]||j.status)}</span></div>${admin?`<p>${esc(j.member_email)}</p>`:''}<p>${esc(j.instance_name)} · ${esc(j.zone)} · 最長 ${j.duration_minutes/60} 小時</p><div class="job-facts"><span>預留 ${esc(money(j.reserved_cents))}</span><span>${j.actual_cost_cents==null?'待結算':`已結算 ${esc(money(j.actual_cost_cents))}`}</span><span>開始 ${esc(date(j.started_at_ms))}</span><span>結束確認 ${esc(date(j.ended_at_ms))}</span></div>${j.issue?`<p class="job-issue">${esc(j.issue)}</p>`:''}${j.ssh_command&&j.status==='RUNNING'?`<label>SSH 指令<code class="ssh-command">${esc(j.ssh_command)}</code></label>`:''}<div class="job-actions">${active.has(j.status)?'<button type="button" class="outline" data-action="sync">核對狀態</button>':''}${j.status==='REQUESTED'?'<button type="button" class="outline" data-action="retry">送出已預留工作</button>':''}${active.has(j.status)?'<button type="button" class="text-button" data-action="cancel">取消／結束</button>':''}${admin&&j.status==='SETTLEMENT_PENDING'?'<button type="button" class="outline" data-action="settle">結算費用</button>':''}${admin&&['UNKNOWN','DELETING','CREATING','QUEUED'].includes(j.status)?'<button type="button" class="text-button" data-action="confirm-ended">確認資源已結束</button>':''}</div><small>工作 ${esc(j.job_id)}</small></article>`).join(''):'<div class="empty">尚無 TPU 工作。</div>';
    controls();
  }
  async function load() {
    if(disposed)return;
    if(preview){jobs=[{job_id:'j-11111111111111111111111111111111',machine_type:'ct6e-standard-4t',zone:'us-central1-a',instance_name:'ntu-example',status:'SETTLEMENT_PENDING',duration_minutes:240,reserved_cents:2000,actual_cost_cents:null,started_at_ms:1793376000000,ended_at_ms:1793383200000,member_email:'researcher-a@example.invalid'}];render();message('設計預覽：所有 TPU 操作均已停用。');return;}
    const response=await api('/jobs');if(disposed)return;jobs=response.jobs;render();
  }
  async function action(fn) {
    if(disposed||busy||preview)return;
    busy=true;controls();message('處理中…');
    try{await fn();if(!disposed){await load();await onChange();}}
    catch(error){message(error.message);}
    finally{busy=false;if(!disposed)controls();}
  }
  form.addEventListener('change',()=>{quote=null;operationId=null;$('[data-quote]').textContent='';$('[data-confirm-request]').hidden=true;},opt);
  $('[data-get-quote]').addEventListener('click',()=>action(async()=>{
    const duration=Number(form.elements.duration.value);
    ({quote}=await api(`/quote?duration_minutes=${duration}`));if(disposed)return;
    operationId=crypto.randomUUID();$('[data-quote]').textContent=`${quote.machine_type} · ${quote.zone} · 最長 ${duration/60} 小時；預留 ${money(quote.reserved_cents)}。最多排隊 1 小時，供應後開始計時。到期會刪除 VM 與開機磁碟，請自行保存資料。`;
    $('[data-confirm-request]').hidden=false;message('確認預留金額後再送出申請。');
  }),opt);
  form.addEventListener('submit',event=>{event.preventDefault();if(!quote)return;
    if(!confirm(`確認申請 TPU，預留 ${money(quote.reserved_cents)}？取得資源後會開始產生 GCP 費用。`))return;
    action(async()=>{
      await api('/jobs',{method:'POST',body:{duration_minutes:quote.duration_minutes,quote_id:quote.quote_id,idempotency_key:operationId}});
      if(disposed)return;
      quote=null;operationId=null;$('[data-quote]').textContent='';$('[data-confirm-request]').hidden=true;message('已送出申請；請在工作列表核對狀態。');
    });
  },opt);
  $('[data-refresh-jobs]').addEventListener('click',()=>action(async()=>{message('已重新讀取工作紀錄。');}),opt);
  list.addEventListener('click',event=>{
    const button=event.target.closest('[data-action]');if(!button||busy||preview)return;
    const id=button.closest('[data-job]').dataset.job,kind=button.dataset.action;
    if(kind==='settle') {
      settle.reset();settle.dataset.job=id;delete settle.dataset.operationId;delete settle.dataset.payload;
      $('[data-settlement-title]').textContent=`結算 ${id}`;settle.hidden=false;return;
    }
    if(kind==='cancel'&&!confirm('確認取消／刪除這個 TPU 工作？VM 與開機磁碟資料將刪除，請先保存 checkpoint。'))return;
    if(kind==='retry'&&!confirm('確認將這筆已預留的工作送出建機？取得資源後會開始計費。'))return;
    let evidence;
    if(kind==='confirm-ended'){evidence=prompt('填入 VM、磁碟與操作記錄的核對依據（至少 10 字）。系統會先檢查最大排隊及執行期限。');if(!evidence)return;}
    action(async()=>{
      if(kind==='cancel')await api(`/jobs/${id}`,{method:'DELETE'});
      else if(kind==='confirm-ended')await api(`/admin/jobs/${id}/confirm-ended`,{method:'POST',body:{evidence}});
      else await api(`/jobs/${id}/${kind}`,{method:'POST',body:{}});
      message('工作狀態已核對；預留額度會保留到費用結算。');
    });
  },opt);
  settle.addEventListener('submit',event=>{event.preventDefault();
    if(!admin||preview)return;
    let cost;try{const value=settle.elements.cost.value.trim();cost=/^0(?:\.0{1,2})?$/.test(value)?0:dollarsToCents(value);}catch(error){message(error.message);return;}
    const evidence=settle.elements.evidence.value.trim();
    const payload=JSON.stringify({actual_cost_cents:cost,evidence});
    if(settle.dataset.payload!==payload){settle.dataset.payload=payload;settle.dataset.operationId=crypto.randomUUID();}
    if(!confirm(`確認按帳單核對結果結算 ${money(cost)}？此操作會扣除個人額度並解除該工作的預留。`))return;
    action(async()=>{await api(`/admin/jobs/${settle.dataset.job}/settle`,{method:'POST',body:{actual_cost_cents:cost,evidence,operation_id:settle.dataset.operationId}});if(disposed)return;settle.hidden=true;message('費用已結算並保留核對紀錄。');});
  },opt);
  $('[data-close-settlement]').addEventListener('click',()=>settle.hidden=true,opt);
  load().catch(error=>message(error.message));
  return {dispose(){disposed=true;abort.abort();list.replaceChildren();settle.hidden=true;}};
}
