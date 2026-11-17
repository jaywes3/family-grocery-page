'use strict';
const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const CACHE_KEY='familyHubGroceryPhoneCacheV1';
let sections=GrocerySync.initialSections(),items=[];
let activeTabId='groceries',activeSectionId='groceries';
let syncBusy=false,syncPending=false,syncTimer=null,lastSyncedAt=0;
function escapeHTML(value=''){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))}
function setStatus(message,kind=''){
  const badge=$('#syncBadge');badge.textContent=message;badge.className=`status-pill${kind?' '+kind:''}`;
}
function setNotice(message,error=false){const notice=$('#notice');notice.textContent=message;notice.classList.toggle('error',!!error)}
function saveCache(){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify({formatVersion:2,sections,items}))}
  catch(_){setNotice('This phone could not save its local copy. Keep the page open and reconnect before leaving.',true)}
}
function readCache(){
  try{
    const value=JSON.parse(localStorage.getItem(CACHE_KEY)||'{}');
    if(!value||typeof value!=='object')return {sections:GrocerySync.initialSections(),items:[]};
    const savedSections=Array.isArray(value.sections)?value.sections:GrocerySync.initialSections();
    return GrocerySync.normalizeBoard(savedSections,Array.isArray(value.items)?value.items:[]);
  }catch(_){return {sections:GrocerySync.initialSections(),items:[]}}
}
function visibleItems(){return GrocerySync.visibleItems(items)}
function sectionItems(sectionId){return visibleItems().filter(item=>item.sectionId===sectionId)}
function renderTabs(shownSections){
  const tablist=$('#listTabs'),scrollLeft=tablist.scrollLeft;
  tablist.innerHTML=shownSections.map(section=>`<button id="tab-${escapeHTML(section.id)}" class="app-tab ${activeTabId===section.id?'active':''}" type="button" role="tab" aria-controls="listTab" aria-selected="${activeTabId===section.id}" data-tab-id="${escapeHTML(section.id)}"><span class="tab-icon" aria-hidden="true">${escapeHTML(section.icon||'🧺')}</span><span class="tab-label">${escapeHTML(section.name)}</span></button>`).join('');
  tablist.scrollLeft=scrollLeft;
  const settingsButton=$('#tab-settings');
  settingsButton.classList.toggle('active',activeTabId==='settings');
  settingsButton.setAttribute('aria-selected',String(activeTabId==='settings'));
  $$('#appTabs [data-tab-id]').forEach(button=>button.onclick=()=>{
    activeTabId=button.dataset.tabId;
    if(activeTabId!=='settings')activeSectionId=activeTabId;
    render();
  });
  const selected=tablist.querySelector('[aria-selected="true"]');
  if(selected){
    const viewport=tablist.getBoundingClientRect(),tab=selected.getBoundingClientRect();
    if(tab.width&&viewport.width){
      if(tab.left<viewport.left)tablist.scrollLeft-=viewport.left-tab.left;
      else if(tab.right>viewport.right)tablist.scrollLeft+=tab.right-viewport.right;
    }
  }
}
function render(){
  const shownSections=GrocerySync.visibleSections(sections);
  if(!shownSections.some(section=>section.id===activeSectionId))activeSectionId='groceries';
  if(activeTabId!=='settings')activeTabId=activeSectionId;
  renderTabs(shownSections);
  const showingSettings=activeTabId==='settings';
  $('#listTab').hidden=showingSettings;
  $('#settingsTab').hidden=!showingSettings;
  $('#listTab').setAttribute('aria-labelledby',`tab-${escapeHTML(activeSectionId)}`);
  const section=shownSections.find(value=>value.id===activeSectionId)||shownSections[0];
  if(!section){$('#sections').innerHTML='<article class="card empty-section">No shopping lists are available.</article>';return}
  const rows=visibleItems(),sectionRows=rows.filter(item=>item.sectionId===section.id),checked=rows.filter(item=>item.done).length,sectionChecked=sectionRows.filter(item=>item.done).length;
  $('#summary').textContent=`${section.name} · ${sectionRows.length} item${sectionRows.length===1?'':'s'} · ${sectionChecked} checked`;
  $('#removePurchased').disabled=checked===0;
  $('#removePurchased').textContent=checked?`Remove purchased (${checked})`:'Remove purchased';
  const removeButton=section.id==='groceries'?'':`<button class="remove-section" type="button" data-section-id="${escapeHTML(section.id)}" ${sectionRows.length?'disabled title="Remove all items before removing this list"':''}>Remove list</button>`;
  $('#sections').innerHTML=`<article class="card store-section" data-section-id="${escapeHTML(section.id)}"><div class="store-section-head"><div><h2>${escapeHTML(section.icon||'🧺')} ${escapeHTML(section.name)}</h2><span class="section-count">${sectionRows.filter(item=>!item.done).length} left${sectionChecked?` · ${sectionChecked} checked`:''}</span></div>${removeButton}</div>${section.id==='groceries'?'<p class="section-note">Recipe ingredients from Family Hub are added here.</p>':''}<form class="add-row section-add" data-section-id="${escapeHTML(section.id)}"><input maxlength="500" autocomplete="off" placeholder="Add to ${escapeHTML(section.name)}…" aria-label="New item for ${escapeHTML(section.name)}" required><button type="submit" aria-label="Add item to ${escapeHTML(section.name)}">+</button></form><ul class="items">${sectionRows.map(item=>`<li class="${item.done?'done':''}"><input type="checkbox" data-id="${escapeHTML(item.id)}" aria-label="Mark ${escapeHTML(item.text)} ${item.done?'not purchased':'purchased'}" ${item.done?'checked':''}><span class="item-text">${escapeHTML(item.text)}</span><button class="remove-item" type="button" data-id="${escapeHTML(item.id)}" aria-label="Remove ${escapeHTML(item.text)}">×</button></li>`).join('')}</ul>${sectionRows.length?'':`<p class="empty-section">Nothing in ${escapeHTML(section.name)} yet.</p>`}</article>`;
  $$('#sections input[type=checkbox]').forEach(input=>input.onchange=()=>{
    const index=items.findIndex(item=>item.id===input.dataset.id&&!GrocerySync.isDeleted(item));
    if(index<0)return;
    items[index]=GrocerySync.updateItem(items[index],{done:input.checked});saveCache();render();setNotice('Saved on this phone. Syncing…');scheduleSync(100);
  });
  $$('#sections .remove-item').forEach(button=>button.onclick=()=>{
    const index=items.findIndex(item=>item.id===button.dataset.id&&!GrocerySync.isDeleted(item));
    if(index<0)return;
    items[index]=GrocerySync.deleteItem(items[index]);saveCache();render();setNotice('Removed from the list. Syncing…');scheduleSync(100);
  });
  $$('#sections .section-add').forEach(form=>form.onsubmit=event=>{
    event.preventDefault();const input=form.querySelector('input'),text=input.value.trim(),sectionId=form.dataset.sectionId;
    if(!text)return;
    if(text.length>500){setNotice('Item names must be 500 characters or fewer.',true);return}
    const key=text.replace(/\s+/g,' ').toLocaleLowerCase();
    if(sectionItems(sectionId).some(item=>item.text.replace(/\s+/g,' ').toLocaleLowerCase()===key)){setNotice(`That item is already in ${GrocerySync.visibleSections(sections).find(value=>value.id===sectionId)?.name||'this list'}.`);return}
    items=GrocerySync.mergeItems([...items,GrocerySync.createItem(text,sectionId)],[]);saveCache();input.value='';render();setNotice('Added on this phone. Syncing…');scheduleSync(100);
  });
  $$('#sections .remove-section').forEach(button=>button.onclick=()=>removeSection(button.dataset.sectionId));
}
function scheduleSync(delay=300){if(!GrocerySync.getSettings().repo)return;clearTimeout(syncTimer);syncTimer=setTimeout(()=>sync(false),delay)}
async function sync(showToast=false,force=false){
  if(!GrocerySync.getSettings().repo){setStatus('Not connected','warning');return null}
  if(syncBusy){syncPending=true;return null}
  if(!force&&!GrocerySync.hasToken()&&lastSyncedAt&&Date.now()-lastSyncedAt<120000)return null;
  syncBusy=true;setStatus('Syncing…','pending');
  try{
    const snapshot=GrocerySync.normalizeBoard(sections,items),result=await GrocerySync.syncBoard(snapshot.sections,snapshot.items),live=GrocerySync.normalizeBoard(sections,items),merged=GrocerySync.mergeBoard(live.sections,live.items,result.sections,result.items);
    const localPending=!GrocerySync.sameSections(merged.sections,result.sections)||!GrocerySync.sameItems(merged.items,result.items);
    if(localPending)syncPending=true;
    sections=merged.sections;items=merged.items;saveCache();render();lastSyncedAt=Date.now();
    if(result.state==='synced'&&!localPending){
      setStatus('Synced','');setNotice('Shared shopping lists are up to date.');
      if(showToast)setNotice('Synced with GitHub.');
    }else if(result.state==='synced'){
      setStatus('Syncing…','pending');setNotice('A newer change is waiting to sync.');
    }else{
      setStatus('Read only','warning');setNotice('Public lists loaded. Add a fine-grained token on this phone to sync edits.',true);
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
function removePurchased(){
  let removed=0;
  items=items.map(item=>{if(!GrocerySync.isDeleted(item)&&item.done){removed++;return GrocerySync.deleteItem(item)}return item});
  if(!removed){setNotice('No checked items to remove.');return}
  saveCache();render();setNotice('Purchased items removed. Syncing…');scheduleSync(100);
}
function addSection(name){
  const section=GrocerySync.createSection(name,sections);
  sections=GrocerySync.mergeSections(sections,[section]);activeSectionId=section.id;activeTabId=section.id;saveCache();render();setNotice(`${section.name} list added. Syncing…`);scheduleSync(100);
}
function removeSection(sectionId){
  const section=GrocerySync.visibleSections(sections).find(value=>value.id===sectionId);
  if(!section)return;
  if(section.id==='groceries'){setNotice('Groceries is the recipe-import list and cannot be removed.',true);return}
  if(sectionItems(sectionId).length){setNotice('Remove all items before removing this list.',true);return}
  if(!confirm(`Remove the empty “${section.name}” list from both devices?`))return;
  sections=GrocerySync.mergeSections(sections,[GrocerySync.deleteSection(section)]);if(activeSectionId===sectionId){activeSectionId='groceries';activeTabId='groceries'}saveCache();render();setNotice(`${section.name} list removed. Syncing…`);scheduleSync(100);
}
$('#sectionForm').onsubmit=event=>{
  event.preventDefault();const input=$('#newSection'),name=input.value.trim();
  try{addSection(name);input.value=''}catch(error){setNotice(error.message||'Could not add that list.',true)}
};
$('#removePurchased').onclick=removePurchased;
$('#syncNow').onclick=()=>sync(true,true);
$('#settingsForm').onsubmit=async event=>{
  event.preventDefault();
  try{
    const saved=GrocerySync.saveSettings($('#repo').value);$('#repo').value=saved.repo;
    const token=$('#token').value.trim(),remember=$('#remember').checked;
    if(token)GrocerySync.setToken(token,remember);
    else if(GrocerySync.tokenIsRemembered()&&!remember)GrocerySync.clearToken();
    else if(remember&&!GrocerySync.tokenIsRemembered()&&GrocerySync.hasToken())GrocerySync.setToken(GrocerySync.getToken(),true);
    $('#token').value='';lastSyncedAt=0;await sync(true,true);activeTabId=activeSectionId;render();
  }catch(error){$('#token').value='';setStatus('Setup issue','error');setNotice(error.message||'Could not save these settings.',true)}
};
$('#forget').onclick=()=>{
  if(!confirm('Forget the repository and token on this phone? The local lists and public GitHub file will not be deleted.'))return;
  GrocerySync.clearConnection();$('#repo').value='';$('#token').value='';$('#remember').checked=false;activeTabId='settings';render();setStatus('Not connected','warning');setNotice('Connection forgotten on this phone. Your local lists are still here.');
};
const settings=GrocerySync.getSettings();
$('#repo').value=settings.repo;$('#remember').checked=GrocerySync.tokenIsRemembered();
const cache=readCache();sections=cache.sections;items=cache.items;render();
if(settings.repo)sync(false,true);else{setStatus('Set up to connect','warning');setNotice('Open Settings to connect this phone to your public Grocery data repository.')}
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
  navigator.serviceWorker.register('./service-worker.js?v=6',{scope:'./'}).catch(()=>{});
}
