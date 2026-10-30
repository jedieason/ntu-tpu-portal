import {dollarsToCents} from './quota.js';

export function createLedger(db, sdk) {
  const {doc, runTransaction, serverTimestamp, updateDoc, getDoc} = sdk;
  function sameOperation(a, uid, email, cents, reason) {
    if (a.actor_uid !== uid || a.member_email !== email || a.delta_cents !== cents || a.reason !== reason) {
      throw new Error('操作識別碼與先前內容不符，請重新開啟表單。');
    }
    return a.new_quota_cents;
  }
  async function allocate({uid, email, amount, reason, operationId, member}) {
    email = email.trim().toLowerCase();
    reason = reason.trim();
    const cents = dollarsToCents(amount);
    if (!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(email)) throw new Error('請輸入有效的 Google 帳號 Email。');
    if (!reason || reason.length > 300) throw new Error('請填寫 1–300 字的派發原因。');
    if (member && (!member.name.trim() || !/^[a-z][a-z0-9_-]{1,31}$/.test(member.member_id))) throw new Error('請確認姓名與成員代號格式。');
    const memberRef = doc(db, 'members', email);
    const auditRef = doc(db, 'quota_transactions', operationId);
    // A competing grant can fail rule evaluation before the SDK reports contention.
    // Retry only after a fresh authorized read proves the quota actually changed.
    for (let attempt = 0; attempt < 3; attempt++) {
      let observedQuota = null;
      try { return await runTransaction(db, async tx => {
      const audit = await tx.get(auditRef);
      if (audit.exists()) return sameOperation(audit.data(), uid, email, cents, reason);
      const current = await tx.get(memberRef);
      if (member && current.exists()) throw new Error('此帳號已經有配額，請使用「派發額度」。');
      if (!member && !current.exists()) throw new Error('找不到成員，請先更新頁面。');
      const oldQuota = current.exists() ? current.data().quota_cents : 0;
      observedQuota = oldQuota;
      if (!Number.isSafeInteger(oldQuota) || oldQuota < 0 || oldQuota + cents > 100000000) throw new Error('核發後總額度超出允許範圍。');
      const newQuota = oldQuota + cents;
      if (member) {
        tx.set(memberRef, {
          email, name: member.name.trim(), member_id: member.member_id,
          currency: 'USD', enabled: true, quota_cents: newQuota,
          charged_cents: 0, reserved_cents: 0, cost_sync_at: null,
          created_at: serverTimestamp(), updated_at: serverTimestamp(), last_grant_id: operationId
        });
      } else {
        tx.update(memberRef, {quota_cents: newQuota, updated_at: serverTimestamp(), last_grant_id: operationId});
      }
      tx.set(auditRef, {
        member_email: email, type: 'GRANT', delta_cents: cents, old_quota_cents: oldQuota,
        new_quota_cents: newQuota, reason, actor_uid: uid, created_at: serverTimestamp()
      });
      return newQuota;
      }); } catch (error) {
        if (attempt < 2 && !member && error.code === 'permission-denied' && observedQuota !== null) {
          const fresh = await getDoc(memberRef);
          if (fresh.exists() && fresh.data().quota_cents !== observedQuota) continue;
        }
        throw error;
      }
    }
  }
  return {
    allocate,
    setEnabled: (email, enabled) => updateDoc(doc(db, 'members', email), {enabled, updated_at: serverTimestamp()})
  };
}
