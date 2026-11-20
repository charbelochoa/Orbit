'use strict';

const orbitToken = document.querySelector('meta[name="orbit-token"]').content;
const gatewayPort = document.querySelector('meta[name="orbit-gateway-port"]').content;
const mascot = document.getElementById('mascot');
mascot.addEventListener('click', () => mascot.classList.add('is-waving'));
mascot.querySelector('pre').addEventListener('animationend', () => mascot.classList.remove('is-waving'));

function renderMd(text) {
  const content = String(text || '');
  if (!window.marked || !window.DOMPurify) return '<div style="white-space:pre-wrap">' + esc(content) + '</div>';
  const html = window.marked.parse(content, {breaks:true, gfm:true});
  return window.DOMPurify.sanitize(html, {
    USE_PROFILES:{html:true},
    FORBID_TAGS:['form','style','input','button','audio','video'],
  });
}

function decorateReply(container) {
  for (const link of container.querySelectorAll('a[href]')) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
  }
  for (const code of container.querySelectorAll('pre > code')) {
    const pre = code.parentElement;
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const header = document.createElement('div');
    header.className = 'code-header';
    const language = document.createElement('span');
    language.className = 'code-lang';
    language.textContent = [...code.classList].find(name => name.startsWith('language-'))?.slice(9) || 'Texto';
    const button = document.createElement('button');
    button.className = 'code-copy';
    button.textContent = 'Copiar';
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent);
        button.textContent = 'Copiado';
      } catch {
        button.textContent = 'No se pudo copiar';
      }
      setTimeout(() => { button.textContent = 'Copiar'; }, 1500);
    });
    header.append(language, button);
    pre.before(wrapper);
    wrapper.append(header, pre);
  }
}

document.querySelectorAll('[data-visual-command]').forEach(button => {
  button.addEventListener('click', () => sendWs({type:button.dataset.visualCommand}));
});

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function g(id){return document.getElementById(id);}
function tsShort(){var d=new Date();return d.getHours()+':'+String(d.getMinutes()).padStart(2,'0');}
function relMs(ms){return ms<1000?ms+'ms':(ms/1000).toFixed(1)+'s';}

var conversations=[],activeConvId=null;
try {
  const saved=JSON.parse(localStorage.getItem('orbit-conversations')||'null');
  if(saved&&Array.isArray(saved.items)) {
    conversations=saved.items;
    activeConvId=conversations.some(conv=>conv.id===saved.active)?saved.active:conversations[0]?.id;
  }
} catch {}
function genId(){return 'conv_'+crypto.randomUUID();}
function persistConversations(){
  try {
    const items=conversations.slice(0,24).map(conv=>({...conv,messages:conv.messages.slice(-80)}));
    localStorage.setItem('orbit-conversations',JSON.stringify({items,active:activeConvId}));
  } catch {}
}
function createConversation(title,workspace){var id=genId();conversations.unshift({id:id,workspace,title:title||'Nueva conversación',messages:[],createdAt:Date.now()});activeConvId=id;renderConvList();clearChatUI();updateTopbarTitle();return id;}
function setActiveConv(id){if(sendStreaming)return;if(activeConvId===id){showView('view-chat');return;}showView('view-chat');activeConvId=id;renderConvList();reloadConvMessages();updateTopbarTitle();}
var defaultWorkspace;
function updateTopbarTitle(){
  const conv=getActiveConv();
  g('topbar-title').textContent=conv?.title||'Nueva conversación';
  const root=conv?.workspace||defaultWorkspace;
  const picker=g('project-folder');
  picker.textContent=root?root.split(/[\\/]/).filter(Boolean).pop()||root:'Carpeta';
  picker.title=root||'Carpeta de trabajo';
}
function deleteConv(id){if(sendStreaming)return;sendWs({type:'history_delete',payload:{conversationId:id}});conversations=conversations.filter(function(c){return c.id!==id;});if(activeConvId===id){activeConvId=conversations.length?conversations[0].id:null;if(!activeConvId){createConversation();return;}reloadConvMessages();updateTopbarTitle();}renderConvList();}
function saveChatMessage(role,text){
  var conv=getActiveConv();
  if(conv&&typeof text==='string'&&text){conv.messages.push({role,content:text,ts:Date.now()});renderConvList();}
}
function getActiveConv(){return conversations.find(function(c){return c.id===activeConvId;});}
function renameConvFromFirstMessage(text){var conv=getActiveConv();if(!conv)return;if(conv.title!=='Nueva conversación')return;conv.title=text.slice(0,42).replace(/\n/g,' ');updateTopbarTitle();renderConvList();}
function renderConvList(){persistConversations();var list=g('conv-list');list.innerHTML='';conversations.forEach(function(conv){var item=document.createElement('div');item.className='conv-item'+(conv.id===activeConvId?' active':'');var lastMsg=conv.messages.length?conv.messages[conv.messages.length-1]:null;var preview=lastMsg?(typeof lastMsg.content==='string'?lastMsg.content:''):'';preview=preview.slice(0,38);item.innerHTML='<div class="conv-icon">>_</div><div class="conv-info"><div class="conv-title">'+esc(conv.title)+'</div><div class="conv-preview">'+esc(preview||'Sin mensajes')+'</div></div><button class="conv-delete-btn" title="Eliminar" data-id="'+esc(conv.id)+'">✕</button>';item.addEventListener('click',function(e){if(e.target.classList.contains('conv-delete-btn'))return;setActiveConv(conv.id);});item.querySelector('.conv-delete-btn').addEventListener('click',function(e){e.stopPropagation();deleteConv(conv.id);});list.appendChild(item);});}
function reloadConvMessages(){var conv=getActiveConv();clearChatUI();if(!conv||!conv.messages.length)return;conv.messages.forEach(function(m){if(m.role==='user')addUserBubble(m.content);else if(m.role==='orbit')addOrbitBubble(m.content);});}

var streaming=false,curOrbitGroup=null,curOrbitBody=null,curStreamText='',isAtBottom=true,unreadCount=0;
function clearChatUI(){showThinking(false);toolBlockMap={};g('messages').innerHTML='';curOrbitGroup=null;curOrbitBody=null;curStreamText='';streaming=false;g('welcome').style.display='';}
function killWelcome(){g('welcome').style.display='none';}
function scrollBottom(smooth){var el=g('chat-scroll');el.scrollTo({top:el.scrollHeight,behavior:smooth?'smooth':'instant'});}
g('chat-scroll').addEventListener('scroll',function(){var el=this,dist=el.scrollHeight-el.scrollTop-el.clientHeight;isAtBottom=dist<60;g('scroll-to-bottom').classList.toggle('visible',!isAtBottom);if(isAtBottom){unreadCount=0;updateUnreadBadge();}});
g('scroll-to-bottom').addEventListener('click',function(){scrollBottom(true);unreadCount=0;updateUnreadBadge();});
function updateUnreadBadge(){var badge=g('unread-badge');if(unreadCount>0){badge.textContent=unreadCount;badge.classList.add('visible');}else{badge.classList.remove('visible');}}

function makeMsgAvatar(){var element=document.createElement('span');element.className='sigil';element.textContent='o.o';element.setAttribute('aria-hidden','true');return element;}

function addUserBubble(text){killWelcome();finishStream();var group=document.createElement('div');group.className='msg-group user';group.innerHTML='<div class="msg-bubble">'+esc(text)+'</div><div class="msg-meta">Tú · '+tsShort()+'</div>';g('messages').appendChild(group);if(isAtBottom)scrollBottom(false);else{unreadCount++;updateUnreadBadge();}return group;}

function addOrbitBubble(text) {
  killWelcome();
  const group = document.createElement('div');
  group.className = 'msg-group orbit';
  const header = document.createElement('div');
  header.className = 'msg-header';
  const avatar = document.createElement('div');
  avatar.className = 'msg-avatar';
  avatar.appendChild(makeMsgAvatar());
  const name = document.createElement('span');
  name.className = 'msg-name';
  name.textContent = 'Orbit';
  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = tsShort();
  header.append(avatar, name, time);
  const content = document.createElement('div');
  content.className = 'msg-body';
  content.innerHTML = renderMd(text);
  decorateReply(content);
  group.append(header, content);
  g('messages').appendChild(group);
  if (isAtBottom) scrollBottom(false);
  else { unreadCount++; updateUnreadBadge(); }
  return group;
}

function startOrbitStream(){finishStream();killWelcome();var group=document.createElement('div');group.className='msg-group orbit';var bodyDiv=document.createElement('div');bodyDiv.className='msg-body stream-cursor';var avatarDiv=document.createElement('div');avatarDiv.className='msg-avatar';avatarDiv.appendChild(makeMsgAvatar());var header=document.createElement('div');header.className='msg-header';header.appendChild(avatarDiv);var nameEl=document.createElement('span');nameEl.className='msg-name';nameEl.textContent='Orbit';var timeEl=document.createElement('span');timeEl.className='msg-time';timeEl.textContent=tsShort();header.appendChild(nameEl);header.appendChild(timeEl);group.appendChild(header);group.appendChild(bodyDiv);g('messages').appendChild(group);curOrbitGroup=group;curOrbitBody=bodyDiv;curStreamText='';streaming=true;if(isAtBottom)scrollBottom(false);}

function appendChunk(text){if(!streaming)startOrbitStream();curStreamText+=text;curOrbitBody.textContent=curStreamText;if(isAtBottom)scrollBottom(false);}

function finishStream(){if(!streaming)return;if(curOrbitBody){curOrbitBody.classList.remove('stream-cursor');curOrbitBody.innerHTML=renderMd(curStreamText);decorateReply(curOrbitBody);var conv=getActiveConv();if(conv)conv.messages.push({role:'orbit',content:curStreamText,ts:Date.now()});renderConvList();}streaming=false;curOrbitGroup=null;curOrbitBody=null;curStreamText='';}

var toolBlockMap={},toolStartTs={};
function addToolBlock(name){killWelcome();finishStream();var group=document.createElement('div');group.className='msg-group orbit';var avatarDiv=document.createElement('div');avatarDiv.className='msg-avatar';avatarDiv.appendChild(makeMsgAvatar());var header=document.createElement('div');header.className='msg-header';header.appendChild(avatarDiv);var nameEl=document.createElement('span');nameEl.className='msg-name';nameEl.textContent='Orbit';header.appendChild(nameEl);var timeEl=document.createElement('span');timeEl.className='msg-time';timeEl.textContent=tsShort();header.appendChild(timeEl);group.appendChild(header);var block=document.createElement('div');block.className='tool-block running';block.innerHTML='<div class="tool-block-header"><span class="tool-status-dot"></span><span class="tool-block-name">'+esc(name)+'</span><span class="tool-block-dur" style="display:none"></span><span class="tool-block-chevron">&#x25BA;</span></div><div class="tool-block-body"><pre>Ejecutando...</pre></div>';block.querySelector('.tool-block-header').addEventListener('click',function(){block.classList.toggle('open');});group.appendChild(block);g('messages').appendChild(group);toolBlockMap[name]=block;toolStartTs[name]=Date.now();if(isAtBottom)scrollBottom(false);}

function finalizeToolBlock(name,ok,result){var block=toolBlockMap[name];if(!block)return;block.classList.remove('running');block.classList.add(ok?'done':'failed');var dur=toolStartTs[name]?relMs(Date.now()-toolStartTs[name]):'';var durEl=block.querySelector('.tool-block-dur');if(dur){durEl.textContent=dur;durEl.style.display='';}var pre=block.querySelector('.tool-block-body pre');if(pre){var preview=result?(typeof result==='string'?result:JSON.stringify(result,null,2)):(ok?'OK':'Error');if(preview.length>800)preview=preview.slice(0,800)+'...';pre.textContent=preview;}delete toolBlockMap[name];delete toolStartTs[name];}

var thinkingEl=null;
function showThinking(visible,label){if(visible){if(thinkingEl)return;thinkingEl=document.createElement('div');thinkingEl.className='msg-group orbit';var avatarDiv=document.createElement('div');avatarDiv.className='msg-avatar';avatarDiv.appendChild(makeMsgAvatar());var header=document.createElement('div');header.className='msg-header';header.appendChild(avatarDiv);var nameEl=document.createElement('span');nameEl.className='msg-name';nameEl.textContent='Orbit';header.appendChild(nameEl);thinkingEl.appendChild(header);var pill=document.createElement('div');pill.className='thinking-block';pill.innerHTML='<div class="thinking-dots"><span></span><span></span><span></span></div><span id="thinking-label">'+esc(label||'Pensando...')+'</span>';thinkingEl.appendChild(pill);g('messages').appendChild(thinkingEl);if(isAtBottom)scrollBottom(false);}else{if(thinkingEl){thinkingEl.remove();thinkingEl=null;}}}

var ws=null,reconnT=null,reconnCount=0;
var IS_ELECTRON=!!(window.orbitElectron&&window.orbitElectron.isElectron);
async function connect() {
  clearTimeout(reconnT);
  let token = orbitToken;
  let port = gatewayPort;
  try {
    const response = await fetch('/session', {cache:'no-store', signal:AbortSignal.timeout(3000)});
    if (response.ok) {
      const session = await response.json();
      if (typeof session.token === 'string' && Number.isInteger(session.port)) {
        token = session.token;
        port = session.port;
      }
    }
  } catch {}
  try {
    ws = new WebSocket('ws://127.0.0.1:' + port + '?token=' + encodeURIComponent(token));
  } catch {
    schedRecon();
    return;
  }
  ws.onclose = () => {
    permissionQueue.length = 0;
    showNextPermission();
    stopVoice(false);
    orbitAudio.stopPlayback();
    setSendMode(false);
    g('send-btn').disabled = true;
    setConn('offline');
    setBadge('ws-badge','err');
    schedRecon();
  };
  ws.onmessage = event => {
    try {
      const message = JSON.parse(event.data);
      if (message.type === 'connected') {
        if (!message.authenticated) { ws.close(); return; }
        reconnCount = 0;
        setConn('online');
        setBadge('ws-badge','ok');
        sendWs({type:'status'});
        g('send-btn').disabled = !g('msg-input').value.trim();
        return;
      }
      handle(message);
    } catch {}
  };
}
function schedRecon(){reconnCount++;var delay=Math.min(30000,1500*Math.pow(2,reconnCount-1));reconnT=setTimeout(connect,delay);}
function sendWs(o){
  if(ws?.readyState!==WebSocket.OPEN)return;
  const workspace=getActiveConv()?.workspace;
  ws.send(JSON.stringify({...o,payload:{...o.payload,workspace}}));
}
function setConn(s){var dot=g('tb-dot');dot.className='';if(s==='online'){dot.classList.add('online');setStatus('');}else if(s==='offline'){dot.classList.add('offline');setStatus('Desconectado. Reconectando...','warn');}else{setStatus('Conectando...');}}
function setStatus(t,cls){var el=g('status-bar');el.textContent=t;el.className=cls||'';}
function setBadge(id,state){var el=g(id);if(!el)return;el.className='st-badge';if(state==='ok'||state===true){el.textContent='Activo';el.classList.add('ok');}else if(state==='err'||state===false){el.textContent='Error';el.classList.add('err');}else{el.textContent=String(state);el.classList.add('warn');}}

function handle(msg){
  switch(msg.type){
    case 'orbit_ready':setConn('online');setStatus('');break;
    case 'user_message':saveChatMessage('user',msg.text);addUserBubble(msg.text);break;
    case 'orbit_message':showThinking(false);finishStream();saveChatMessage('orbit',msg.text);addOrbitBubble(msg.text);setStatus('');setSendMode(false);break;
    case 'orbit_chunk':showThinking(false);appendChunk(msg.text);break;
    case 'voice_audio':if(soundsEnabled)orbitAudio.play(msg.pcm,msg.sampleRate);break;
    case 'turn_complete':finishStream();showThinking(false);if(!g('status-bar').classList.contains('err'))setStatus('');setSendMode(false);break;
    case 'tool_call':addToolBlock(msg.tool);addToolEvent(msg.tool);break;
    case 'tool_result':finalizeToolBlock(msg.tool,!msg.error,msg.result);finalizeToolEvent(msg.tool,!msg.error,msg.result);break;
    case 'typing':if(msg.state==='thinking'){showThinking(true,'Pensando...');break;}if(msg.state==='executing'){showThinking(false);if(msg.tool)setStatus('Ejecutando: '+msg.tool);break;}showThinking(false);setStatus('');break;
    case 'task_created':upsertTask(msg.id,{title:msg.goal,provider:msg.provider,model:msg.model});break;
    case 'task_started':upsertTask(msg.id,{status:'running'});break;
    case 'task_plan':upsertTask(msg.taskId,{title:msg.goal,status:tasks[msg.taskId]?.status==='paused'?'paused':'running',steps:msg.steps||[],provider:msg.provider,model:msg.model});break;
    case 'task_queued':upsertTask(msg.taskId,{title:msg.goal||tasks[msg.taskId]?.title||'Tarea en cola'});break;
    case 'task_progress':upsertTask(msg.taskId,{progress:msg.progress,status:tasks[msg.taskId]?.status||'running'});break;
    case 'task_step_started':markTaskStep(msg.taskId,msg.step,'running');break;
    case 'task_step_done':markTaskStep(msg.taskId,msg.step,'done');break;
    case 'task_step_error':markTaskStep(msg.taskId,msg.step,'error',msg.error);break;
    case 'task_complete':upsertTask(msg.taskId,{status:msg.success?'done':'failed',summary:msg.summary});break;
    case 'task_done':upsertTask(msg.id,{status:'done',progress:100,summary:tasks[msg.id]?.summary||msg.result});break;
    case 'task_failed':upsertTask(msg.id,{status:'failed',summary:msg.error});break;
    case 'task_cancelled':upsertTask(msg.taskId||msg.id,{status:'cancelled'});break;
    case 'task_paused':upsertTask(msg.id,{status:'paused'});break;
    case 'task_resumed':upsertTask(msg.id,{status:'running'});break;
    case 'task_interrupted':upsertTask(msg.id,{status:'interrupted',summary:msg.error});break;
    case 'task_requeued':upsertTask(msg.id,{status:'pending',summary:'',steps:msg.steps||[],progress:0});break;
    case 'task_continue_ack':
      if(msg.outcome==='needs_confirmation'&&window.confirm('Orbit desconoce el resultado de algunos pasos. Revisa sus efectos antes de reintentarlos. ¿Quieres repetirlos?')){
        sendWs({type:'task_continue',payload:{id:msg.id,retryInterrupted:true}});
      }else if(msg.outcome==='unavailable'){
        setStatus('La tarea ya no está disponible para continuar.','warn');
        sendWs({type:'status'});
      }
      break;
    case 'visual_loop_status':updateVisualBar(msg.status,msg.goal);break;
    case 'visual_loop_step':updateVisualBar('running',null,msg.loop,msg.maxLoops,msg.action);break;
    case 'memory':
    case 'memory_data':
      if(msg.data&&typeof msg.data==='object'){
        memData=Object.create(null);
        for(const [section, entries] of Object.entries(msg.data)){
          if(!entries||typeof entries!=='object')continue;
          for(const [key, entry] of Object.entries(entries)){
            if(typeof entry?.value==='string')memData[section+'/'+key]={value:entry.value,ts:''};
          }
        }
        renderMemList();
      }else if(msg.key)updateMem(msg.key,msg.value,msg.ts);
      break;
    case 'status':if(Array.isArray(msg.tasks))msg.tasks.slice().reverse().forEach(syncTaskSnapshot);if(msg.workspace&&!getActiveConv()?.workspace){defaultWorkspace=msg.workspace;updateTopbarTitle();}if(msg.gemini!==undefined){voiceConfigured=msg.gemini;setBadge('gemini-badge',msg.gemini?'Configurado':'Sin configurar');}if(msg.python!==undefined)setBadge('python-badge',msg.python?'Configurada':'Opcional');if(msg.provider)showProvider(msg.provider,msg.model);if(msg.providerId)syncProviderSel(msg.providerId);break;
    case 'provider_changed':var pname=msg.name||msg.provider||msg.id||'AI';showProvider(pname,msg.model);if(msg.provider)syncProviderSel(msg.provider);addOrbitBubble('Proveedor cambiado a **'+pname+'**');break;
    case 'command_result':addOrbitBubble(msg.text||msg.message||'OK');setSendMode(false);break;
    case 'command_error':addOrbitBubble('! '+(msg.text||msg.message||'Error'));setSendMode(false);break;
    case 'permission_request':queuePermission(msg);break;
    case 'permission_closed':removePermission(msg.requestId);break;
    case 'error':showThinking(false);setStatus('Error: '+(msg.message||''),'err');setSendMode(false);break;
    case 'chat_cleared':clearChatUI();break;
    case 'subagent_spawned':setStatus('Subagente iniciado: '+(msg.id||''));break;
    case 'subagent_done':setStatus('');break;
    case 'subagent_failed':setStatus('Subagente falló','err');break;
  }
}

var sendStreaming=false;
function setSendMode(active){sendStreaming=active;var btn=g('send-btn');if(active){btn.disabled=false;btn.classList.add('streaming');btn.title='Detener';btn.innerHTML='<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';}else{btn.classList.remove('streaming');btn.title='Enviar (Enter)';btn.innerHTML='<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';btn.disabled=!g('msg-input').value.trim();}}
function sendMessage(){if(orbitAudio.capture){setStatus('Envía el audio antes de escribir.','warn');return;}if(sendStreaming){orbitAudio.stopPlayback();sendWs({type:'chat',payload:{text:'/stop'}});return;}var inp=g('msg-input'),text=inp.value.trim();if(!text||!ws||ws.readyState!==1)return;if(!activeConvId)createConversation(text.slice(0,42));renameConvFromFirstMessage(text);var conv=getActiveConv();if(conv)conv.messages.push({role:'user',content:text,ts:Date.now()});addUserBubble(text);sendWs({type:'chat',payload:{text:text,conversationId:activeConvId}});renderConvList();inp.value='';inp.style.height='auto';updateCharCount();setSendMode(true);showThinking(true,'Pensando...');hideSlashMenu();}
g('send-btn').addEventListener('click',sendMessage);
g('msg-input').addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}if(e.key==='Escape')hideSlashMenu();if(slashMenuVisible){if(e.key==='ArrowDown'){e.preventDefault();moveSlashSel(1);}if(e.key==='ArrowUp'){e.preventDefault();moveSlashSel(-1);}if(e.key==='Tab'||e.key==='Enter'){if(e.key==='Tab')e.preventDefault();applySlashSel();}}});
g('msg-input').addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,160)+'px';g('send-btn').disabled=!this.value.trim()&&!sendStreaming;updateCharCount();handleSlashInput(this.value);});
function updateCharCount(){var len=g('msg-input').value.length,el=g('char-count');if(len>25000){el.textContent=len+'/32000';el.className=len>31000?'over':'warn';}else{el.textContent='';el.className='';}}

var SLASH_COMMANDS=[{cmd:'/claude',desc:'Usa tu instalación de Claude Code'},{cmd:'/task',desc:'Ejecuta una tarea autónoma'},{cmd:'/stop',desc:'Detiene la generación actual'},{cmd:'/clear',desc:'Limpia el chat'},{cmd:'/memory',desc:'Muestra la memoria'},{cmd:'/model',desc:'Cambia el modelo de IA'},{cmd:'/status',desc:'Estado del sistema'},{cmd:'/skills',desc:'Lista de skills disponibles'},{cmd:'/cancel',desc:'Cancela una tarea activa'},{cmd:'/resume',desc:'Continúa una tarea interrumpida'},{cmd:'/daemon',desc:'Modo daemon'},];
var slashMenuVisible=false,slashSelIndex=0,filteredCmds=[];
function handleSlashInput(val){if(val.startsWith('/')&&!val.includes(' ')){var q=val.toLowerCase();filteredCmds=SLASH_COMMANDS.filter(function(c){return c.cmd.startsWith(q);});if(filteredCmds.length){slashSelIndex=0;renderSlashMenu();showSlashMenu();return;}}hideSlashMenu();}
function renderSlashMenu(){var menu=g('slash-menu');menu.innerHTML=filteredCmds.map(function(c,i){return '<div class="slash-item'+(i===slashSelIndex?' selected':'')+'" data-idx="'+i+'"><span class="slash-cmd">'+esc(c.cmd)+'</span><span class="slash-desc">'+esc(c.desc)+'</span></div>';}).join('');menu.querySelectorAll('.slash-item').forEach(function(el){el.addEventListener('mousedown',function(e){e.preventDefault();slashSelIndex=+this.dataset.idx;applySlashSel();});});}
function showSlashMenu(){slashMenuVisible=true;g('slash-menu').classList.add('visible');}
function hideSlashMenu(){slashMenuVisible=false;g('slash-menu').classList.remove('visible');}
function moveSlashSel(dir){slashSelIndex=(slashSelIndex+dir+filteredCmds.length)%filteredCmds.length;renderSlashMenu();}
function applySlashSel(){if(!filteredCmds[slashSelIndex])return;var inp=g('msg-input');inp.value=filteredCmds[slashSelIndex].cmd+' ';inp.style.height='auto';hideSlashMenu();inp.focus();g('send-btn').disabled=false;}

document.querySelectorAll('.welcome-prompt').forEach(function(btn){btn.addEventListener('click',function(){var inp=g('msg-input');inp.value=this.dataset.prompt||'';inp.style.height='auto';inp.style.height=inp.scrollHeight+'px';g('send-btn').disabled=!inp.value.trim();inp.focus();});});

function showView(id){document.querySelectorAll('.view').forEach(function(v){v.classList.remove('active');});var el=g(id);if(el)el.classList.add('active');document.querySelectorAll('.sb-footer-btn').forEach(function(b){b.classList.remove('active');});var map={'view-tasks':'nav-tasks','view-memory':'nav-memory','view-tools':'nav-tools','view-settings':'nav-settings'};if(map[id]){var btn=g(map[id]);if(btn)btn.classList.add('active');}}
g('nav-tasks').addEventListener('click',function(){showView('view-tasks');sendWs({type:'status'});});
g('nav-memory').addEventListener('click',function(){showView('view-memory');});
g('nav-tools').addEventListener('click',function(){showView('view-tools');});
g('nav-settings').addEventListener('click',function(){showView('view-settings');});
if(window.orbitElectron?.openProviderSettings){
  g('settings-edit-row').hidden=false;
  g('open-provider-settings').addEventListener('click',async function(){
    try {
      const error=await window.orbitElectron.openProviderSettings();
      if(error) setStatus(error,'err');
    } catch {
      setStatus('Orbit no pudo abrir la configuración.','err');
    }
  });
}

var sidebarOpen=!matchMedia('(max-width: 720px)').matches;
g('sidebar').classList.toggle('collapsed',!sidebarOpen);
function toggleSidebar(){sidebarOpen=!sidebarOpen;g('sidebar').classList.toggle('collapsed',!sidebarOpen);}
g('sidebar-collapse-btn').addEventListener('click',toggleSidebar);
g('topbar-toggle').addEventListener('click',function(){toggleSidebar();showView('view-chat');});
document.addEventListener('keydown',function(e){if((e.ctrlKey||e.metaKey)&&e.key==='b'){e.preventDefault();toggleSidebar();}});

g('new-chat-btn').addEventListener('click',function(){if(sendStreaming)return;createConversation(undefined,getActiveConv()?.workspace);showView('view-chat');g('msg-input').focus();});
g('project-folder').addEventListener('click', async function(){
  if(sendStreaming||orbitAudio.capture)return;
  const conv=getActiveConv();
  try {
    const selected=window.orbitElectron?.selectWorkspace
      ? await window.orbitElectron.selectWorkspace(conv?.workspace||defaultWorkspace)
      : window.prompt('Ruta absoluta de la carpeta de trabajo',conv?.workspace||defaultWorkspace||'');
    if(!selected)return;
    if(!conv||conv.messages.length){createConversation(undefined,selected);}
    else{conv.workspace=selected;updateTopbarTitle();persistConversations();}
    showView('view-chat');
    g('msg-input').focus();
  } catch {
    setStatus('Orbit no pudo abrir el selector de carpetas.','err');
  }
});
g('btn-clear-chat').addEventListener('click',function(){if(sendStreaming)return;sendWs({type:'chat',payload:{text:'/clear',conversationId:activeConvId}});clearChatUI();var conv=getActiveConv();if(conv){conv.messages=[];conv.title='Nueva conversación';}updateTopbarTitle();renderConvList();});

g('model-select').addEventListener('change',function(){sendWs({type:'chat',payload:{text:'/model '+this.value}});});
g('provider-select').addEventListener('change',function(){sendWs({type:'chat',payload:{text:'/model '+this.value}});syncProviderSel(this.value);g('model-select').value=this.value;});
function syncProviderSel(id){var sel=g('provider-select');if(sel)sel.value=id;var msel=g('model-select');if(msel)msel.value=id;}

function showProvider(name, model) {
  const label = g('tb-provider');
  label.textContent = name;
  label.title = [name, model].filter(Boolean).join(' · ');
}

const tasks = Object.create(null);
const taskLabels = { pending:'En cola', running:'En curso', paused:'Pausada', interrupted:'Interrumpida', done:'Completada', failed:'Fallida', cancelled:'Cancelada' };

function syncTaskSnapshot(task) {
  const patch = {title:task.goal, status:task.status, provider:task.provider, model:task.model};
  if (Array.isArray(task.steps)) Object.assign(patch, {steps:task.steps, summary:task.error||task.result, progress:0});
  upsertTask(task.id, patch);
}

function upsertTask(id, patch) {
  if (typeof id !== 'string' || !id) return;
  tasks[id] ||= { id, title:'Tarea', status:'pending', steps:[], progress:0 };
  Object.assign(tasks[id], patch);
  renderTaskCard(tasks[id]);
}

function markTaskStep(id, stepId, state, error) {
  const task = tasks[id];
  const step = task?.steps.find(step => step.step === stepId);
  if (!step) return;
  Object.assign(step, {state, error});
  renderTaskCard(task);
}

function renderTaskCard(task) {
  const empty = g('tasks-empty');
  let card = g('task-card-' + task.id);
  if (!card) {
    card = document.createElement('article');
    card.id = 'task-card-' + task.id;
    card.className = 'task-card';
    g('view-tasks').insertBefore(card, g('view-tasks').firstChild);
    empty.hidden = true;
  }
  const settled = task.steps.filter(step => step.state === 'done' || step.state === 'error').length;
  const reported = Math.min(100, Math.max(0, Number(task.progress) || 0));
  const progress = task.status === 'done' ? 100 : task.steps.length ? Math.round(100 * settled / task.steps.length) : reported;
  const steps = task.steps.map(step => {
    const uncertain = task.status === 'interrupted' && step.state === 'running';
    let state = ['done','error'].includes(step.state) ? step.state : '';
    if (uncertain) state = 'uncertain';
    else if (task.status === 'running' && step.state === 'running') state = 'active';
    const note = uncertain ? 'Resultado por confirmar' : step.error;
    return '<li class="task-step '+state+'"><span class="task-step-dot"></span><span>'+
      esc(step.description||step.tool||'Paso')+(note?'<small>'+esc(note)+'</small>':'')+'</span></li>';
  }).join('');
  const badge = task.status === 'failed' ? 'error' : ['running','paused','interrupted','done'].includes(task.status) ? task.status : '';
  const preference = [task.provider, task.model].filter(Boolean).join(' · ');
  card.innerHTML = '<div class="task-card-header"><span class="task-status-dot '+badge+'"></span><span class="task-title">'+
    esc(task.title)+'</span><span class="task-time">'+esc(taskLabels[task.status]||task.status)+'</span></div>'+
    (preference ? '<p class="task-model" aria-label="Modelo preferido">'+esc(preference)+'</p>' : '')+
    '<progress class="task-progress" aria-label="Progreso" value="'+progress+'" max="100"></progress>'+
    (steps ? '<ul class="task-steps">'+steps+'</ul>' : '')+
    (task.summary?'<p class="task-summary">'+esc(task.summary)+'</p>':'');
  const controls = document.createElement('div');
  controls.className = 'task-controls';
  const addAction = (label, type) => {
    const button = document.createElement('button');
    button.className = 'topbar-action';
    button.textContent = label;
    button.addEventListener('click', () => sendWs({type,payload:{id:task.id}}));
    controls.appendChild(button);
  };
  if (task.status === 'running') addAction('Pausar', 'task_pause');
  if (task.status === 'paused') addAction('Reanudar', 'task_resume');
  if (task.status === 'interrupted') addAction('Continuar', 'task_continue');
  if (['pending','running','paused','interrupted'].includes(task.status)) addAction('Cancelar', 'task_cancel');
  if (controls.childElementCount) card.appendChild(controls);
}

var _vbarVisible=false;
function updateVisualBar(status,goal,loop,maxLoops,action){
  var bar=g('visual-bar');if(!bar)return;
  if(status==='running'||status==='paused'){
    bar.style.display='flex';
    var label=action?action:(goal?goal.slice(0,60):'Procesando...');
    var loopText=(loop&&maxLoops)?(' '+loop+'/'+maxLoops):'';
    g('vbar-label').textContent=label+loopText;
    g('vbar-pause').style.display=status==='running'?'inline-flex':'none';
    g('vbar-resume').style.display=status==='paused'?'inline-flex':'none';
    _vbarVisible=true;
  } else {
    bar.style.display='none';
    _vbarVisible=false;
  }
}

var memData={};
function updateMem(key,value,ts_){memData[key]={value:value,ts:ts_||''};renderMemList();}
function renderMemList(){var q=g('mem-search').value.toLowerCase(),items=Object.entries(memData).filter(function(e){return !q||e[0].toLowerCase().includes(q)||String(e[1].value).toLowerCase().includes(q);});var empty=g('mem-empty');empty.style.display=items.length?'none':'block';var list=g('mem-list');list.querySelectorAll('.mem-item').forEach(function(el){el.remove();});items.forEach(function(e){var item=document.createElement('div');item.className='mem-item';item.innerHTML='<span class="mem-key">'+esc(e[0])+'</span><span class="mem-value">'+esc(String(e[1].value).slice(0,140))+'</span><span class="mem-ts">'+esc(e[1].ts||'')+'</span>';list.insertBefore(item,empty);});}
g('mem-search').addEventListener('input',function(){renderMemList();});

var toolEvs=[],toolEvStartTs={};
function addToolEvent(name){toolEvs.unshift({name:name,state:'running',result:null,start:Date.now(),duration:null});toolEvStartTs[name]=Date.now();if(toolEvs.length>100)toolEvs.pop();renderToolEvs();}
function finalizeToolEvent(name,ok,result){var ev=toolEvs.find(function(e){return e.name===name&&e.state==='running';});if(ev){ev.state=ok?'done':'failed';ev.result=result;ev.duration=Date.now()-(toolEvStartTs[name]||Date.now());delete toolEvStartTs[name];}renderToolEvs();}
function renderToolEvs(){var panel=g('view-tools'),empty=g('tools-empty');panel.querySelectorAll('.tool-event').forEach(function(el){el.remove();});empty.style.display=toolEvs.length?'none':'block';toolEvs.slice(0,80).forEach(function(ev){var el=document.createElement('div');el.className='tool-event'+(ev.state==='done'?' done':ev.state==='failed'?' failed':'');var dur=ev.duration!=null?'<span class="tool-ev-dur">'+relMs(ev.duration)+'</span>':'';var preview=ev.result?(typeof ev.result==='string'?ev.result:JSON.stringify(ev.result)):null;if(preview&&preview.length>260)preview=preview.slice(0,260)+'...';el.innerHTML='<div class="tool-event-header"><span class="tool-ev-dot"></span><span class="tool-ev-name">'+esc(ev.name)+'</span>'+dur+'<span class="tool-ev-time">'+new Date(ev.start).toLocaleTimeString()+'</span></div>'+(preview?'<div class="tool-ev-result">'+esc(preview)+'</div>':'');panel.insertBefore(el,empty);});}

const orbitAudio = new OrbitAudio();
let voiceConfigured = null;
const soundsEnabled = true;

g('mic-btn').addEventListener('click', async function() {
  if (orbitAudio.capture) {
    stopVoice(true);
    return;
  }
  if (sendStreaming || !ws || ws.readyState !== WebSocket.OPEN) return;
  if (voiceConfigured === false) {
    setStatus('Configura GEMINI_API_KEY para usar el micrófono.', 'warn');
    return;
  }
  try {
    if (!await orbitAudio.start(() => stopVoice(true))) return;
    if (document.hidden || ws?.readyState !== WebSocket.OPEN) {
      stopVoice(false);
      return;
    }
    g('mic-btn').setAttribute('aria-pressed', 'true');
    g('voice-banner').classList.add('active');
  } catch {
    setStatus('No pude abrir el micrófono. Revisa su permiso en Windows.', 'err');
  }
});

g('voice-stop-btn').textContent = 'Enviar audio';
g('voice-stop-btn').addEventListener('click', () => stopVoice(true));
document.addEventListener('visibilitychange', () => {
  if (document.hidden && orbitAudio.capture) stopVoice(false);
});

function stopVoice(transmit) {
  const pcm = orbitAudio.stop();
  g('mic-btn').setAttribute('aria-pressed', 'false');
  g('voice-banner').classList.remove('active');
  if (!transmit || !pcm || ws?.readyState !== WebSocket.OPEN) return;
  sendWs({ type:'audio', payload:{ pcm, conversationId:activeConvId } });
  setSendMode(true);
  setStatus('Procesando audio...');
}

const permissionQueue = [];
let priorFocus;

function queuePermission(request) {
  permissionQueue.push(request);
  if (permissionQueue.length === 1) {
    priorFocus = document.activeElement;
    showNextPermission();
  }
}

function showNextPermission() {
  const request = permissionQueue[0];
  g('confirm-overlay').classList.toggle('visible', Boolean(request));
  g('app').inert = Boolean(request);
  g('titlebar').inert = Boolean(request);
  if (!request) {
    priorFocus?.focus();
    return;
  }
  g('cd-title').textContent = request.toolId || 'Confirmar acción';
  g('cd-desc').textContent = request.description || '';
  g('cd-args').textContent = JSON.stringify(request.args || {}, null, 2).slice(0, 1400);
  g('cd-timer').textContent = 'Si no respondes, Orbit cancelará esta acción.';
  g('cd-cancel').focus();
}

function removePermission(requestId) {
  const index = permissionQueue.findIndex(request => request.requestId === requestId);
  if (index < 0) return;
  permissionQueue.splice(index, 1);
  if (index === 0) showNextPermission();
}

function decidePermission(answer) {
  const requestId = permissionQueue[0]?.requestId;
  if (!requestId) return;
  sendWs({ type:'permission_response', payload:{ requestId, answer } });
  removePermission(requestId);
}

g('cd-confirm').addEventListener('click', () => decidePermission('allow'));
g('cd-cancel').addEventListener('click', () => decidePermission('deny'));
g('confirm-overlay').addEventListener('keydown', event => {
  if (event.key === 'Escape') decidePermission('deny');
  if (event.key === 'Tab') {
    event.preventDefault();
    (document.activeElement === g('cd-confirm') ? g('cd-cancel') : g('cd-confirm')).focus();
  }
});

g('tb-close').addEventListener('click',function(){if(IS_ELECTRON&&window.orbitElectron&&window.orbitElectron.send)window.orbitElectron.send('window:hide');else window.close();});
g('tb-minimize').addEventListener('click',function(){if(IS_ELECTRON&&window.orbitElectron&&window.orbitElectron.send)window.orbitElectron.send('app:minimize');});
if(IS_ELECTRON&&window.orbitElectron&&window.orbitElectron.on){window.orbitElectron.on('backend:ready',function(){setConn('online');});window.orbitElectron.on('backend:error',function(){setConn('offline');});}

document.querySelectorAll('.toggle').forEach(function(tog){tog.addEventListener('click',function(){this.classList.toggle('on');});});

if(activeConvId){renderConvList();reloadConvMessages();updateTopbarTitle();}else createConversation();
connect();
g('msg-input').focus();
