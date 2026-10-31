export function createTpuClient(base, getToken, fetcher=fetch) {
  const url=new URL(base);
  if(url.protocol!=='https:' || !url.hostname.endsWith('.run.app') || url.pathname!=='/' || url.search || url.hash)throw new Error('TPU 服務網址未通過檢查。');
  return async(path,{method='GET',body}={})=>{
    if(!/^\/(jobs(?:\/j-[a-f0-9]{32}(?:\/(?:sync|retry))?)?|quote\?duration_minutes=(?:60|120|240)|admin\/(?:reconcile|jobs\/j-[a-f0-9]{32}\/(?:settle|confirm-ended)))$/.test(path))throw new Error('不支援的 TPU 操作。');
    const token=await getToken();
    if(!token)throw new Error('請先登入。');
    const response=await fetcher(new URL(path,url),{method,cache:'no-store',credentials:'omit',
      headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    let data;try{data=await response.json();}catch{throw new Error('服務回應不完整，請先查詢工作狀態。');}
    if(!response.ok)throw new Error(data.error?.message||'TPU 操作失敗。');
    return data;
  };
}
