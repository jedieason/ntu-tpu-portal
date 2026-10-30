import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import * as fs from 'firebase/firestore';
import {createLedger} from '../web/ledger.js';

let env;
const memberEmail='member@example.com';
const token=email=>({email,email_verified:true,firebase:{sign_in_provider:'google.com'}});
const context=(uid,email,extra={})=>env.authenticatedContext(uid,{...token(email),...extra}).firestore();
const sample=(email=memberEmail)=>({email,name:'Researcher',member_id:'researcher-a',enabled:true,currency:'USD',quota_cents:10000,charged_cents:2000,reserved_cents:3000,cost_sync_at:null,created_at:fs.Timestamp.fromMillis(1),updated_at:fs.Timestamp.fromMillis(1),last_grant_id:'initial-grant-000001'});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-ntu-tpu',firestore:{host:'127.0.0.1',port:8088,rules:await readFile('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async c=>{
    const db=c.firestore();
    await fs.setDoc(fs.doc(db,'admins','owner'),{enabled:true,email:'owner@example.com'});
    await fs.setDoc(fs.doc(db,'members',memberEmail),sample());
    await fs.setDoc(fs.doc(db,'members','other@example.com'),sample('other@example.com'));
  });
});
test('anonymous cannot read balances',async()=>{await assertFails(fs.getDoc(fs.doc(env.unauthenticatedContext().firestore(),'members',memberEmail)));});
test('verified Google identity reads only own exact member document, including normalized case',async()=>{
  const db=context('member','MEMBER@example.com');
  await assertSucceeds(fs.getDoc(fs.doc(db,'members',memberEmail)));
  await assertFails(fs.getDoc(fs.doc(db,'members','other@example.com')));
  await assertFails(fs.getDocs(fs.collection(db,'members')));
});
test('unverified and non-Google providers cannot read a member record',async()=>{
  for(const extra of [{email_verified:false},{firebase:{sign_in_provider:'password'}}])await assertFails(fs.getDoc(fs.doc(context('member',memberEmail,extra),'members',memberEmail)));
});
test('members cannot change balance, identity, enablement or become admin',async()=>{
  const db=context('member',memberEmail);
  for(const patch of [{quota_cents:100000},{charged_cents:0},{reserved_cents:0},{email:'other@example.com'},{enabled:false},{role:'admin'}])await assertFails(fs.updateDoc(fs.doc(db,'members',memberEmail),patch));
  await assertFails(fs.setDoc(fs.doc(db,'admins','member'),{email:memberEmail,enabled:true}));
});
test('owner sees all members but cannot list admin identities',async()=>{
  const db=context('owner','owner@example.com');
  assert.equal((await assertSucceeds(fs.getDocs(fs.collection(db,'members')))).size,2);
  await assertSucceeds(fs.getDoc(fs.doc(db,'admins','owner')));
  await assertFails(fs.getDocs(fs.collection(db,'admins')));
});
test('admin UID alone is insufficient if its bound email differs',async()=>{await assertFails(fs.getDocs(fs.collection(context('owner','wrong@example.com'),'members')));});
test('admin may grant through an atomic ledger transaction',async()=>{
  const db=context('owner','owner@example.com');
  const next=await createLedger(db,fs).allocate({uid:'owner',email:memberEmail,amount:'50',reason:'Research allocation',operationId:'operation-test-000001'});
  assert.equal(next,15000);
  const m=(await fs.getDoc(fs.doc(db,'members',memberEmail))).data();
  assert.equal(m.quota_cents,15000);assert.equal(m.charged_cents,2000);assert.equal(m.reserved_cents,3000);
  const audit=(await fs.getDoc(fs.doc(db,'quota_transactions','operation-test-000001'))).data();
  assert.equal(audit.old_quota_cents,10000);assert.equal(audit.delta_cents,5000);assert.equal(audit.actor_uid,'owner');
});
test('same operation retries once; changed payload using same ID is rejected',async()=>{
  const db=context('owner','owner@example.com');const ledger=createLedger(db,fs);
  const op={uid:'owner',email:memberEmail,amount:'50',reason:'Research allocation',operationId:'operation-test-000002'};
  assert.equal(await ledger.allocate(op),15000);assert.equal(await ledger.allocate(op),15000);
  await assert.rejects(()=>ledger.allocate({...op,amount:'60'}));
  assert.equal((await fs.getDoc(fs.doc(db,'members',memberEmail))).data().quota_cents,15000);
});
test('two simultaneous administrator grants do not lose an increment',async()=>{
  const db=context('owner','owner@example.com');const ledger=createLedger(db,fs);
  await Promise.all(['000003','000004'].map(s=>ledger.allocate({uid:'owner',email:memberEmail,amount:'50',reason:'Concurrent grant',operationId:'operation-test-'+s})));
  assert.equal((await fs.getDoc(fs.doc(db,'members',memberEmail))).data().quota_cents,20000);
});
test('member creation and its initial grant must be atomic',async()=>{
  const db=context('owner','owner@example.com');const ledger=createLedger(db,fs);
  await ledger.allocate({uid:'owner',email:'new@example.com',amount:'100',reason:'Initial allocation',operationId:'operation-test-000005',member:{name:'New researcher',member_id:'new-member'}});
  const m=(await fs.getDoc(fs.doc(db,'members','new@example.com'))).data();assert.equal(m.quota_cents,10000);assert.equal(m.cost_sync_at,null);
  await assertFails(fs.setDoc(fs.doc(db,'members','forged@example.com'),{...sample('forged@example.com'),charged_cents:0,reserved_cents:0,created_at:fs.serverTimestamp(),updated_at:fs.serverTimestamp()}));
});
test('even admin cannot change spent/reserved counters, decrease quota or grant without audit',async()=>{
  const db=context('owner','owner@example.com');
  for(const patch of [{charged_cents:0},{reserved_cents:0},{quota_cents:5000},{quota_cents:15000,last_grant_id:'operation-without-audit'},{cost_sync_at:fs.serverTimestamp()}])await assertFails(fs.updateDoc(fs.doc(db,'members',memberEmail),{...patch,updated_at:fs.serverTimestamp()}));
});
test('admin metadata edits preserve financial fields',async()=>{
  const db=context('owner','owner@example.com');
  await assertSucceeds(createLedger(db,fs).setEnabled(memberEmail,false));
  await assertSucceeds(fs.updateDoc(fs.doc(db,'members',memberEmail),{name:'Updated researcher',updated_at:fs.serverTimestamp()}));
  await assertFails(fs.deleteDoc(fs.doc(db,'members',memberEmail)));
});
test('audit is immutable, owner-bound, and not visible to other members',async()=>{
  const db=context('owner','owner@example.com');
  await createLedger(db,fs).allocate({uid:'owner',email:memberEmail,amount:'50',reason:'Research allocation',operationId:'operation-test-000006'});
  const ref=fs.doc(db,'quota_transactions','operation-test-000006');
  await assertFails(fs.updateDoc(ref,{reason:'Edited'}));await assertFails(fs.deleteDoc(ref));
  await assertFails(fs.getDoc(fs.doc(context('member',memberEmail),'quota_transactions','operation-test-000006')));
  const batch=fs.writeBatch(db);batch.update(fs.doc(db,'members',memberEmail),{quota_cents:20000,last_grant_id:'operation-test-000007',updated_at:fs.serverTimestamp()});
  batch.set(fs.doc(db,'quota_transactions','operation-test-000007'),{member_email:memberEmail,type:'GRANT',delta_cents:5000,old_quota_cents:15000,new_quota_cents:20000,reason:'Forged actor',actor_uid:'someone-else',created_at:fs.serverTimestamp()});
  await assertFails(batch.commit());
});
test('members cannot write jobs or read another owner job',async()=>{
  await env.withSecurityRulesDisabled(c=>fs.setDoc(fs.doc(c.firestore(),'jobs','job-a'),{owner_uid:'member'}));
  const db=context('member',memberEmail);
  await assertSucceeds(fs.getDoc(fs.doc(db,'jobs','job-a')));
  await assertFails(fs.getDoc(fs.doc(context('other','other@example.com'),'jobs','job-a')));
  await assertFails(fs.setDoc(fs.doc(db,'jobs','job-b'),{owner_uid:'member'}));
});
