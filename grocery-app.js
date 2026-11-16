'use strict';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const CACHE_KEY='familyHubGroceryPhoneCacheV1';
let items=[];
let syncBusy=false,syncPending=false,syncTimer=null,lastSyncedAt=0;
function escapeHTML(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function setStatus(message,kind=''){
  const badge=$('#syncBadge');badge.textContent=message;badge.className=`status-pill${kind?' '+kind:''}`;
}
function setNotice(message,error=false){const notice=$('#notice');notice.textContent=message;notice.classList.toggle('error',!!error)}
function saveCache(){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({formatVersion:1,items}))}
  catch(_){setNotice('This phone could not save its local copy. Keep the page open and reconnect before leaving.',true)}
}
function readCache(){
  try{const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');return value&&Array.isArray(value.items)?GrocerySync.normalizeItems(value.items):[]}
  catch(_){return []}
}
function visible(){return GrocerySync.visibleItems(items)}
function render(){
  const rows=visible(),checked=rows.filter(item=>item.done).length;
  $('#summary').textContent=`${rows.length} item${rows.length===1?'':'s'} · ${rows.length-checked} left`;
  $('#empty').hidden=rows.length>0;
  $('#removePurchased').disabled=checked===0;
  $('#items').innerHTML=rows.map(item=>`<li class="${item.done?'done':''}"><input type="checkbox" data-id="${escapeHTML(item.id)}" aria-label="Mark ${escapeHTML(item.text)} ${item.done?'not purchased':'purchased'}" ${item.done?'checked':''}><span class="item-text">${escapeHTML(item.text)}</span><button class="remove-item" type="button" data-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.text)}">×</button></li>`).join('');
  $$('#items input[type=checkbox]').forEach(input=>input.onchange=()=>{
    const index=items.findIndex(item=>item.id===input.dataset.id&&!GrocerySync.isDeleted(item));
    if(index<0)return;
    items[index]=GrocerySync.updateItem(items[index],{done:input.checked});saveCache();render();setNotice('Saved on this phone. Syncing…');scheduleSync(100);
  });
  $$('#items .remove-item').forEach(button=>button.onclick=()=>{
    const index=items.findIndex(item=>item.id===button.dataset.id&&!GrocerySync.isDeleted(item));
    if(index<0)return;
    items[index]=GrocerySync.deleteItem(items[index]);saveCache();render();setNotice('Removed from the list. Syncing…');scheduleSync(100);
  });
}
function scheduleSync(delay=300){if(!GrocerySync.getSettings().repo)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(false),delay)}
async function sync(showToast=false,force=false){
  if(!GrocerySync.getSettings().repo){setStatus('Not connected','warning');return null}
  if(syncBusy){syncPending=true;return null}
  if(!force&&!GrocerySync.hasToken()&&lastSyncedAt&&Date.now()-lastSyncedAt<120000)return null;
  syncBusy=true;setStatus('Syncing…','pending');
  try{
    const snapshot=GrocerySync.normalizeItems(items),result=await GrocerySync.syncItems(snapshot),live=GrocerySync.normalizeItems(items),merged=GrocerySync.mergeItems(live,result.items),localPending=!GrocerySync.sameItems(merged,result.items);
    if(localPending)syncPending=true;
    if(!GrocerySync.sameItems(live,merged)){items=merged;saveCache();render()}
    else items=merged;
    lastSyncedAt=Date.now();
    if(result.state==='synced'&&!localPending){
      setStatus('Synced','');setNotice('Shared list is up to date.');
      if(showToast)setNotice('Synced with GitHub.');
    }else if(result.state==='synced'){
      setStatus('Syncing…','pending');setNotice('A newer change is waiting to sync.');
    }else{
      setStatus('Read only','warning');setNotice('Public list loaded. Add a fine-grained token on this phone to sync edits.',true);
    }
    return result;
  }catch(error){
    setStatus('Sync issue','error');setNotice(`Not synced — edits remain on this phone. ${error.message||'Check the repository and token, then try again.'}`,true);
    return null;
  }finally{
    syncBusy=false;
    if(syncPending){syncPending=false;scheduleSync(150)}
  }
}
$('#addForm').onsubmit=event=>{
  event.preventDefault();const input=$('#newItem'),text=input.value.trim();if(!text)return;
  if(text.length>500){setNotice('Item names must be 500 characters or fewer.',true);return}
  const key=text.replace(/\s+/g,' ').toLocaleLowerCase();
  if(visible().some(item=>item.text.replace(/\s+/g,' ').toLocaleLowerCase()===key)){setNotice('That item is already on the list.');return}
  items=GrocerySync.mergeItems([...items,GrocerySync.createItem(text)],[]);saveCache();input.value='';render();setNotice('Added on this phone. Syncing…');scheduleSync(100);
};
$('#removePurchased').onclick=()=>{
  let removed=0;
  items=items.map(item=>{if(!GrocerySync.isDeleted(item)&&item.done){removed++;return GrocerySync.deleteItem(item)}return item});
  if(!removed){setNotice('No checked items to remove.');return}
  saveCache();render();setNotice('Purchased items removed. Syncing…');scheduleSync(100);
};
$('#syncNow').onclick=()=>sync(true,true);
$('#settingsForm').onsubmit=async event=>{
  event.preventDefault();
  try{
    const saved=GrocerySync.saveSettings($('#repo').value);$('#repo').value=saved.repo;
    const token=$('#token').value.trim(),remember=$('#remember').checked;
    if(token)GrocerySync.setToken(token,remember);
    else if(GrocerySync.tokenIsRemembered()&&!remember)GrocerySync.clearToken();
    else if(remember&&!GrocerySync.tokenIsRemembered()&&GrocerySync.hasToken())GrocerySync.setToken(GrocerySync.getToken(),true);
    $('#token').value='';
    $('#settingsPanel').open=false;
    lastSyncedAt=0;
    await sync(true,true);
  }catch(error){$('#token').value='';setStatus('Setup issue','error');setNotice(error.message||'Could not save these settings.',true)}
};
$('#forget').onclick=()=>{
  if(!confirm('Forget the repository and token on this phone? The local list and public GitHub file will not be deleted.'))return;
  GrocerySync.clearConnection();$('#repo').value='';$('#token').value='';$('#remember').checked=false;$('#settingsPanel').open=true;setStatus('Not connected','warning');setNotice('Connection forgotten on this phone. Your local list is still here.');
};
const settings=GrocerySync.getSettings();
$('#repo').value=settings.repo;$('#remember').checked=GrocerySync.tokenIsRemembered();
items=readCache();render();
if(settings.repo)sync(false,true);else{setStatus('Set up to connect','warning');setNotice('Add your public grocery data repository below. The list will then load from GitHub.')}
setInterval(()=>{if(!document.hidden&&GrocerySync.getSettings().repo)sync(false)},20000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&GrocerySync.getSettings().repo)sync(false)});
window.addEventListener('focus',()=>{if(GrocerySync.getSettings().repo)sync(false)});
let deferredInstallPrompt=null;
const installButton=$('#installApp');
window.addEventListener('beforeinstallprompt',event=>{
  event.preventDefault();deferredInstallPrompt=event;installButton.hidden=false;
});
installButton.onclick=async()=>{
  if(!deferredInstallPrompt)return;
  const promptEvent=deferredInstallPrompt;deferredInstallPrompt=null;installButton.disabled=true;
  try{
    await promptEvent.prompt();
    const choice=await promptEvent.userChoice;
    setNotice(choice&&choice.outcome==='accepted'?'Installing Hearthside Grocery…':'Install dismissed.');
  }catch(_){setNotice('Use Chrome’s menu and choose Install app.',true)}
  finally{installButton.disabled=false;installButton.hidden=true}
};
window.addEventListener('appinstalled',()=>{installButton.hidden=true;setNotice('Hearthside Grocery is installed on this phone.')});
if('serviceWorker' in navigator&&(location.protocol==='https:'||location.hostname==='localhost')){
  navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).catch(()=>{});
}
