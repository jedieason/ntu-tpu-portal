import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTpuClient} from '../web/tpu-client.js';
test('TPU client sends the current Firebase token only to the configured HTTPS controller',async()=>{
  let sent;const call=createTpuClient('https://reviewed-controller.run.app',async()=>'current-id-token',async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({jobs:[]})};});
  assert.deepEqual(await call('/jobs'),{jobs:[]});assert.equal(sent.url.origin,'https://reviewed-controller.run.app');
  assert.equal(sent.options.headers.Authorization,'Bearer current-id-token');assert.equal(sent.options.credentials,'omit');
  await assert.rejects(()=>call('//evil.invalid/jobs'));await assert.rejects(()=>call('/jobs/../../admin'));
  for(const url of ['http://reviewed-controller.run.app','https://evil.invalid','https://reviewed-controller.run.app/path'])assert.throws(()=>createTpuClient(url,async()=>'token'));
});
test('TPU client GET/list never changes to create, and handles backend authorization errors',async()=>{
  let calls=0;const api=createTpuClient('https://reviewed-controller.run.app',async()=>{calls++;return null;});
  await assert.rejects(()=>api('/jobs'),/請先登入/);assert.equal(calls,1);
  const denied=createTpuClient('https://reviewed-controller.run.app',async()=>'token',async()=>({ok:false,json:async()=>({error:{message:'管理員權限不足'}})}));
  await assert.rejects(()=>denied('/jobs'),/管理員權限不足/);
});
