// app.js 聊天前端主逻辑：登录、联系人、会话、消息与媒体上传
(() => {
  // --------------- 配置 ---------------
  const DEV_NOTE = '开发说明';
  const SUPABASE_URL = 'https://fjjbodkvytpekzzxerzr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqamJvZGt2eXRwZWt6enhlcnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MDAyMjMsImV4cCI6MjA4MDM3NjIyM30.ctMcySWOXS9SbBQBRVQjpK-6SlSxjSZ8aYmUx_Q3ee4';
  const SUPABASE_BUCKET = 'chat';
  const MAX_UPLOAD_SIZE_MB = 50;
  const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;
  const VIDEO_MAX_DURATION_SEC = 10 * 60;
  const VIDEO_DEFAULT_SHORT_EDGE = 540;
  const VIDEO_MIN_SHORT_EDGE = 360;
  const VIDEO_TARGET_FPS = 12;
  const VIDEO_MIN_VIDEO_BITRATE = 120 * 1024;
  const VIDEO_MAX_VIDEO_BITRATE = 1200 * 1024;
  const VIDEO_MIN_AUDIO_BITRATE = 16 * 1024;
  const VIDEO_MAX_AUDIO_BITRATE = 64 * 1024;

  // Supabase 客户端（SDK 在 HTML 中先加载）
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --------------- DOM 引用 ---------------
  const loginView = document.getElementById('loginView');
  const app = document.getElementById('app');
  const navBtns = Array.from(document.querySelectorAll('.nav-btn'));
  const tabs = Array.from(document.querySelectorAll('.tab.view'));
  const btnRegister = document.getElementById('btn-register');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');

  // messages tab
  const conversationsPanel = document.getElementById('conversationsPanel');
  const chatPanel = document.getElementById('chatPanel');
  const conversationsList = document.getElementById('conversationsList');
  const chatTitle = document.getElementById('chatTitle');
  const friendRemarkDisplay = document.getElementById('friendRemarkDisplay');
  const editRemarkBtn = document.getElementById('editRemarkBtn');
  const backToConvos = document.getElementById('backToConvos');
  if (backToConvos) {
  backToConvos.addEventListener('click', () => {
    showConversationsPanel(); // 返回会话列表面板
  });
}

  const chatWindow = document.getElementById('chatWindow');
  const msgInput = document.getElementById('msgInput');
  const btnSendText = document.getElementById('btnSendText');

  // 图片/视频发送相关 DOM
  const imgUpload = document.getElementById('imgUpload');
  const btnSendImage = document.getElementById('btnSendImage');

  // contacts tab
  const newFriendInput = document.getElementById('newFriend');
  const btnAdd = document.getElementById('btn-add');
  const friendsList = document.getElementById('friendsList');

  // me tab
  const meAvatarWrap = document.getElementById('meAvatarWrap');
  const avatarInput = document.getElementById('avatarInput');
  const btnSaveAvatar = document.getElementById('btnSaveAvatar');
  const meNote = document.getElementById('meNote');

  // --------------- 运行时状态 ---------------
  let currentUser = null;
  let currentFriend = null;
  let friends = [];

// 未读红点状态
let unreadMap = {};
const storedUnread = localStorage.getItem('chat_unreadMap');
if (storedUnread) {
  try {
    unreadMap = JSON.parse(storedUnread);
  } catch(e) { unreadMap = {}; }
}

function updateConversationRedDot(friend) {
  const divs = conversationsList.querySelectorAll('.friend');
  divs.forEach(div => {
    const titleDiv = div.querySelector('div > div'); // 会话标题节点
    if (titleDiv && titleDiv.textContent.includes(friend)) {
      const dot = div.querySelector('.red-dot');
      if (dot) dot.style.visibility = unreadMap[friend] ? 'visible' : 'hidden';
    }
  });
  // 持久化到 localStorage
  localStorage.setItem('chat_unreadMap', JSON.stringify(unreadMap));
}


  let myAvatar = '';

  // avatar cache
  const avatarCache = {};
  const avatarPromises = {};

  // socket
  let socket = null;

  // throttle / mutex
  let _loadConvTimer = null;
  let _isLoadingConversations = false;
  function throttleLoadConversations() {
    if (_isLoadingConversations) return;
    if (_loadConvTimer) return;
    _loadConvTimer = setTimeout(() => {
      _loadConvTimer = null;
      loadConversations();
    }, 50);
  }

  // --------------- UI helpers ---------------
  function showLogin() { if(loginView) loginView.style.display='block'; if(app) app.style.display='none'; document.title='lovechat'; }
  function showApp() { if(loginView) loginView.style.display='none'; if(app) app.style.display='block'; }
  function switchTab(targetId){
    tabs.forEach(t => t.id === targetId ? t.classList.add('active') : t.classList.remove('active'));
    navBtns.forEach(b => b.dataset.target === targetId ? b.classList.add('active') : b.classList.remove('active'));
    if(targetId === 'tab-messages') throttleLoadConversations();
  }
  navBtns.forEach(b => b.addEventListener('click', ()=> switchTab(b.dataset.target)));

  function escapeHTML(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function truncate(s,n){ if(!s) return ''; return s.length>n ? s.slice(0,n-1) + '...' : s; }
  function formatTime(ts){ try{ const d=new Date(ts); return d.toLocaleTimeString(); }catch(e){ return ''; } }
  function runAfterUIReady(cb){ requestAnimationFrame(()=>{ requestAnimationFrame(()=>{ setTimeout(() => { try{ cb(); }catch(e){ console.error(e); } },0); }); }); }

  // avatar
  function makeInitialsDiv(username, size=52){
    const d = document.createElement('div');
    d.className = 'avatar-initial';
    d.style.width = size + 'px';
    d.style.height = size + 'px';
    const initials = (username||'?').trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase() || '?';
    d.textContent = initials;
    return d;
  }
  function makeAvatarDOM(username, url, size=52){
    const wrapper = document.createElement('div');
    wrapper.style.width = size + 'px';
    wrapper.style.height = size + 'px';
    wrapper.className = 'avatar-wrap';
    if(url && url.trim()){
      const img = document.createElement('img');
      img.src = url;
      img.alt = username;
      img.onerror = ()=>{ wrapper.innerHTML=''; wrapper.appendChild(makeInitialsDiv(username,size)); };
      wrapper.appendChild(img);
    } else wrapper.appendChild(makeInitialsDiv(username,size));
    return wrapper;
  }
  function renderMyAvatar(){ if(!meAvatarWrap) return; meAvatarWrap.innerHTML=''; meAvatarWrap.appendChild(makeAvatarDOM(currentUser,myAvatar,52)); }

  function showConversationsPanel(){ if(conversationsPanel) conversationsPanel.style.display=''; if(chatPanel) chatPanel.style.display='none'; if(chatPanel) chatPanel.classList.remove('chat-panel-full'); window.currentFriend = null; }
  function showChatPanelFull(){ if(conversationsPanel) conversationsPanel.style.display='none'; if(chatPanel) chatPanel.style.display=''; if(chatPanel) chatPanel.classList.add('chat-panel-full'); }

  // -------- avatar cache helpers ----------
  function getAvatarFromCache(u){
    if(!u) return '';
    if(avatarCache.hasOwnProperty(u)) return avatarCache[u];
    if(avatarPromises[u]) return '';
    avatarPromises[u] = fetch(`/user/${encodeURIComponent(u)}`)
      .then(r=>r.json())
      .then(j => { avatarCache[u] = (j && j.avatar) ? j.avatar : ''; delete avatarPromises[u]; renderContacts(); throttleLoadConversations(); return avatarCache[u]; })
      .catch(()=>{ delete avatarPromises[u]; avatarCache[u]=''; return ''; });
    return '';
  }
  function getAvatarForUser(u){ if(!u) return ''; if(avatarCache.hasOwnProperty(u)) return avatarCache[u]; getAvatarFromCache(u); return ''; }

  // --------------- Socket ---------------
  function connectSocket(){
  if(socket){ try{ socket.off(); socket.disconnect(); }catch(e){} socket=null; }
  socket = io();

  socket.on('connect', () => { if(currentUser) socket.emit('login', currentUser); });

  // 登录后拉取服务端未读数量，回填本地红点
socket.on('unread-counts', counts => {
  // counts: [{ from_user: 'Alice', count: 3 }, ...]
  counts.forEach(item => {
    if(item.count > 0){
      unreadMap[item.from_user] = true;
      updateConversationRedDot(item.from_user);
    }
  });
});

  socket.on('online-status', list => {
    // 在线状态列表同步到全局
    window.onlineUsersList = list || [];
    renderContacts(); // 刷新联系人在线/离线文案
  });

// socket.on('receive-message', ...)
socket.on('receive-message', data => {
  if (!data || !data.from) return;
  addMessageToWindow(data.from, data.message);
  

 // 收到新消息时设置未读红点
  unreadMap[data.from] = true;
  updateConversationRedDot(data.from);

  // 立即刷新对应会话的红点 DOM
  updateConversationRedDot(data.from);

  // 浏览器通知
  if (Notification.permission === 'granted') {
    const n = new Notification(data.from, {
      body: data.message.length > 50 ? data.message.slice(0, 50) + '...' : data.message,
      icon: avatarCache[data.from] || '/favicon.png',
    });
    n.onclick = () => {
      window.focus();
      openConversation(data.from);
      n.close();
    };
  } else if (Notification.permission !== 'denied') {
    Notification.requestPermission();
  }
   throttleLoadConversations();
});


    socket.on('online-status', list => { /* optional: set onlineUsers if you maintain that */ });
  }

  // --------------- Friends / Conversations ---------------
async function loadFriends(){
  if(!currentUser) return;
  try{
    const r = await fetch(`/friends/${encodeURIComponent(currentUser)}`);
    const list = await r.json();
    list.forEach(x=>{ if(x.avatar && x.avatar.trim()) avatarCache[x.friend]=x.avatar; });
    
    friends = (list||[]).map(x=>({
      friend: x.friend,
      avatar: x.avatar || '',
      remark: x.remark || ''
    }));

    renderContacts();    // 成功后刷新联系人列表

  }catch(e){
    friends=[];
    renderContacts();    // 失败时也清空并刷新显示
  }
}

function renderContacts() {
  if (!friendsList) return;
  friendsList.innerHTML = '';

  // 在线状态来源于 socket 的 online-status 事件
  const onlineList = window.onlineUsersList || []; // 兼容未收到在线列表时的默认值

  friends.forEach(item => {
  const f = item.friend;
  const av = avatarCache[f] || item.avatar || '';
  const remark = item.remark || '';

  const div = document.createElement('div'); 
  div.className = 'friend';

  const left = document.createElement('div');
  left.style.display = 'flex';
  left.style.gap = '10px';
  left.style.alignItems = 'center';
  left.appendChild(makeAvatarDOM(f, av, 44));

  const txt = document.createElement('div');
  const name = document.createElement('div');
  name.innerHTML = `${escapeHTML(remark ? remark : f)} (${escapeHTML(f)})`;

  const sub = document.createElement('div');
  sub.className = 'small muted';
  
  // 显示在线/离线状态
  if (window.onlineUsersList && Array.isArray(window.onlineUsersList)) {
    sub.textContent = window.onlineUsersList.includes(f) ? '在线' : '离线';
  } else {
    sub.textContent = '离线';
  }

  txt.appendChild(name);
  txt.appendChild(sub);

  left.appendChild(txt);
  div.appendChild(left);


    // 点击联系人打开会话
    div.addEventListener('click', () => {
      switchTab('tab-messages');
      openConversation(f);
    });

    // 右侧备注按钮
    const editBtn = document.createElement('button');
    editBtn.textContent = '备注';
    editBtn.className = 'edit-remark-btn';
    editBtn.style.marginLeft = 'auto';
    editBtn.style.padding = '4px 8px';
    editBtn.style.fontSize = '12px';
    editBtn.addEventListener('click', e => { e.stopPropagation(); editRemarkForFriend(f); });
    div.appendChild(editBtn);

    friendsList.appendChild(div);
  });
}

async function loadConversations() {
  if (!currentUser || _isLoadingConversations) return;
  _isLoadingConversations = true;
  conversationsList.innerHTML = '';

  try {
    if (!friends || !friends.length) await loadFriends();

    const promises = friends.map(async f => {
      try {
        const res = await fetch(`/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(f.friend)}`);
        const list = await res.json();
        const last = (list && list.length) ? list[list.length-1] : null;
        return { friend: f.friend, avatar: avatarCache[f.friend] || f.avatar || '', remark: f.remark, last };
      } catch (e) {
        return { friend: f.friend, avatar: avatarCache[f.friend] || f.avatar || '', remark: f.remark, last: null };
      }
    });

    const conv = await Promise.all(promises);
    conv.sort((a,b) => {
  const t1 = a.last ? a.last.ts : 0;
  const t2 = b.last ? b.last.ts : 0;
  return t2 - t1; // 按最新消息时间倒序
});

    conv.forEach(c => {
      const div = document.createElement('div');
      div.className = 'friend';
      div.style.position = 'relative'; // 作为红点定位锚点

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '10px';
      left.appendChild(makeAvatarDOM(c.friend, c.avatar || '', 44));

      const tc = document.createElement('div');
      const title = document.createElement('div');
      title.innerHTML = `${escapeHTML(c.remark ? c.remark : c.friend)} (${escapeHTML(c.friend)})`;

      const preview = document.createElement('div');
      preview.className = 'small muted';
      preview.textContent = c.last ?
        ((c.last.from_user === currentUser ? '娴? ' : '') + truncate(c.last.message, 40))
        : '閺嗗倹妫ゅ☉鍫熶紖';

      tc.appendChild(title);
      tc.appendChild(preview);
      left.appendChild(tc);

      div.appendChild(left);

      // 红点
      const dot = document.createElement('div');
      dot.className = 'red-dot';
      dot.style.position = 'absolute';
      dot.style.top = '12px';
      dot.style.right = '12px';
      dot.style.width = '10px';
      dot.style.height = '10px';
      dot.style.borderRadius = '50%';
      dot.style.backgroundColor = 'red';
      dot.style.visibility = unreadMap[c.friend] ? 'visible' : 'hidden';
      div.appendChild(dot);

      // 点击会话打开聊天
      div.addEventListener('click', () => openConversation(c.friend));

      conversationsList.appendChild(div);
    });

  } catch (e) { console.error(e); }
  finally { _isLoadingConversations = false; }
}


function openConversation(friend) {
  currentFriend = friend;
 // 进入会话时清除该好友未读状态
  unreadMap[friend] = false;
  updateConversationRedDot(friend);

  if (!currentUser) return;
  if (socket && socket.connected) socket.emit('open-conversation', { user: currentUser, friend });

  const found = friends.find(x => x.friend === friend);
  if (friendRemarkDisplay) friendRemarkDisplay.textContent = (found && found.remark) ? found.remark : '';
  if (chatTitle) chatTitle.textContent = friend;
  if (chatWindow) chatWindow.innerHTML = '';

  fetch(`/messages/${encodeURIComponent(currentUser)}/${encodeURIComponent(friend)}`)
    .then(r => r.json())
    .then(list => {
      list.forEach(m => addMessageToWindow(m.from_user, m.message));
      chatWindow.scrollTop = chatWindow.scrollHeight;
    })
    .catch(() => { });

  showChatPanelFull();
}


  // --------------- 媒体处理（图片/视频） ---------------
  // 判断是否为图片文件（MIME 或扩展名）
  function isImageFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    return /^image\//i.test(file.type || '') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name);
  }

  function isVideoFile(file) {
    if (!file) return false;
    const name = String(file.name || '').toLowerCase();
    return /^video\//i.test(file.type || '') || /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(name);
  }

  function clampEven(value) {
    const num = Math.max(2, Math.round(value));
    return num % 2 === 0 ? num : num - 1;
  }

  function clampNumber(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    return Math.min(max, Math.max(min, num));
  }

  function getTargetVideoSize(width, height, targetShortEdge = VIDEO_DEFAULT_SHORT_EDGE) {
    const w = Math.max(2, Number(width) || targetShortEdge);
    const h = Math.max(2, Number(height) || targetShortEdge);
    const sourceShortEdge = Math.min(w, h);
    let expectedShortEdge = Math.round(targetShortEdge);
    if (sourceShortEdge < VIDEO_MIN_SHORT_EDGE) {
      expectedShortEdge = sourceShortEdge;
    } else {
      expectedShortEdge = clampNumber(expectedShortEdge, VIDEO_MIN_SHORT_EDGE, sourceShortEdge);
    }
    const scale = Math.min(1, expectedShortEdge / sourceShortEdge);
    return {
      width: clampEven(w * scale),
      height: clampEven(h * scale),
    };
  }

  function pickPreferredVideoShortEdge(width, height, durationSec, sourceBytes) {
    const w = Math.max(2, Number(width) || VIDEO_DEFAULT_SHORT_EDGE);
    const h = Math.max(2, Number(height) || VIDEO_DEFAULT_SHORT_EDGE);
    const sourceShortEdge = Math.min(w, h);
    if (sourceShortEdge <= VIDEO_MIN_SHORT_EDGE) return sourceShortEdge;

    let preferred = VIDEO_DEFAULT_SHORT_EDGE;
    if (durationSec >= 6 * 60 || sourceBytes >= 35 * 1024 * 1024) preferred = 480;
    if (durationSec >= 9 * 60 || sourceBytes >= 45 * 1024 * 1024) preferred = VIDEO_MIN_SHORT_EDGE;
    return Math.min(sourceShortEdge, preferred);
  }

  function getVideoShortEdgeCandidates(sourceShortEdge, preferredShortEdge) {
    if (sourceShortEdge <= VIDEO_MIN_SHORT_EDGE) {
      return [clampEven(sourceShortEdge)];
    }

    const tiers = [VIDEO_DEFAULT_SHORT_EDGE, 480, 432, 396, VIDEO_MIN_SHORT_EDGE];
    const startIndex = Math.max(0, tiers.findIndex((tier) => tier <= preferredShortEdge));
    const list = [];

    for (let i = startIndex; i < tiers.length; i += 1) {
      const edge = Math.round(Math.min(sourceShortEdge, tiers[i]));
      const normalized = clampNumber(edge, VIDEO_MIN_SHORT_EDGE, sourceShortEdge);
      if (!list.includes(normalized)) list.push(normalized);
    }
    if (!list.length) list.push(VIDEO_MIN_SHORT_EDGE);
    return list;
  }

  function getVideoTargetBytes(sourceBytes) {
    const hardCapBytes = Math.floor(MAX_UPLOAD_SIZE_BYTES * 0.9);
    let ratio = 0.9;
    if (sourceBytes >= 45 * 1024 * 1024) ratio = 0.68;
    else if (sourceBytes >= 30 * 1024 * 1024) ratio = 0.75;
    else if (sourceBytes >= 18 * 1024 * 1024) ratio = 0.82;
    const bySourceBytes = Math.floor(sourceBytes * ratio);
    const minBytes = Math.min(hardCapBytes, Math.max(2 * 1024 * 1024, Math.floor(sourceBytes * 0.45)));
    return clampNumber(bySourceBytes, minBytes, hardCapBytes);
  }

  function getVideoBitratePlan(durationSec, targetBytes) {
    const safeDuration = Math.max(1, Number(durationSec) || 1);
    const totalFromBudget = Math.floor((targetBytes * 8) / safeDuration);
    const totalMin = VIDEO_MIN_VIDEO_BITRATE + VIDEO_MIN_AUDIO_BITRATE;
    const totalMax = VIDEO_MAX_VIDEO_BITRATE + VIDEO_MAX_AUDIO_BITRATE;
    const totalBitrate = clampNumber(totalFromBudget, totalMin, totalMax);

    let audioBitsPerSecond = clampNumber(Math.round(totalBitrate * 0.12), VIDEO_MIN_AUDIO_BITRATE, VIDEO_MAX_AUDIO_BITRATE);
    let videoBitsPerSecond = clampNumber(totalBitrate - audioBitsPerSecond, VIDEO_MIN_VIDEO_BITRATE, VIDEO_MAX_VIDEO_BITRATE);

    if (videoBitsPerSecond + audioBitsPerSecond > totalBitrate) {
      const remainAudio = totalBitrate - videoBitsPerSecond;
      audioBitsPerSecond = clampNumber(remainAudio, VIDEO_MIN_AUDIO_BITRATE, VIDEO_MAX_AUDIO_BITRATE);
    }
    return { totalBitrate, videoBitsPerSecond, audioBitsPerSecond };
  }

  function buildVideoCompressionPlan(file, width, height, durationSec) {
    const sourceBytes = Number(file && file.size) || 0;
    const sourceShortEdge = Math.max(2, Math.min(Number(width) || VIDEO_DEFAULT_SHORT_EDGE, Number(height) || VIDEO_DEFAULT_SHORT_EDGE));
    const preferredShortEdge = pickPreferredVideoShortEdge(width, height, durationSec, sourceBytes);
    const candidateEdges = getVideoShortEdgeCandidates(sourceShortEdge, preferredShortEdge);
    const targetBytes = getVideoTargetBytes(sourceBytes);
    const bitratePlan = getVideoBitratePlan(durationSec, targetBytes);

    const targetFps = durationSec >= 8 * 60 ? 10 : VIDEO_TARGET_FPS;
    const minBitsPerPixelFrame = 0.05;
    let size = getTargetVideoSize(width, height, candidateEdges[0]);

    for (const shortEdge of candidateEdges) {
      const nextSize = getTargetVideoSize(width, height, shortEdge);
      const pixels = Math.max(1, nextSize.width * nextSize.height);
      const bitsPerPixelFrame = bitratePlan.videoBitsPerSecond / Math.max(1, targetFps * pixels);
      size = nextSize;
      if (bitsPerPixelFrame >= minBitsPerPixelFrame || shortEdge <= VIDEO_MIN_SHORT_EDGE) break;
    }

    return {
      width: size.width,
      height: size.height,
      fps: targetFps,
      targetBytes,
      videoBitsPerSecond: bitratePlan.videoBitsPerSecond,
      audioBitsPerSecond: bitratePlan.audioBitsPerSecond,
    };
  }

  function pickRecorderMimeType() {
    if (!window.MediaRecorder) return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4;codecs=avc1,mp4a.40.2',
      'video/mp4',
    ];
    for (const mime of candidates) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return '';
  }

  function createVideoRecorder(stream, mimeType, videoBitsPerSecond, audioBitsPerSecond) {
    const options = {
      videoBitsPerSecond: clampNumber(
        Number(videoBitsPerSecond) || VIDEO_MAX_VIDEO_BITRATE,
        VIDEO_MIN_VIDEO_BITRATE,
        VIDEO_MAX_VIDEO_BITRATE
      ),
      audioBitsPerSecond: clampNumber(
        Number(audioBitsPerSecond) || VIDEO_MAX_AUDIO_BITRATE,
        VIDEO_MIN_AUDIO_BITRATE,
        VIDEO_MAX_AUDIO_BITRATE
      ),
    };
    if (mimeType) {
      try {
        return {
          recorder: new MediaRecorder(stream, { ...options, mimeType }),
          normalizedType: mimeType.split(';')[0] || 'video/webm',
        };
      } catch (e) {}
    }
    const fallback = new MediaRecorder(stream, options);
    return {
      recorder: fallback,
      normalizedType: (fallback.mimeType || 'video/webm').split(';')[0],
    };
  }

  function compressImage(file, maxSizeMB = 1) {
    return new Promise((resolve) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const ratio = img.width / img.height;
        let targetW = img.width;
        let targetH = img.height;

        // 限制总像素，避免超大图压缩过慢或崩溃
        const MAX_PIXELS = 2000 * 2000;
        while (targetW * targetH > MAX_PIXELS) {
          targetW *= 0.9;
          targetH = Math.round(targetW / ratio);
        }

        canvas.width = targetW;
        canvas.height = targetH;
        ctx.drawImage(img, 0, 0, targetW, targetH);

        let quality = 0.92;
        function tryCompress() {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size / 1024 / 1024 <= maxSizeMB || quality <= 0.2) {
              resolve(blob);
            } else {
              quality -= 0.07;
              tryCompress();
            }
          }, 'image/jpeg', quality);
        }
        tryCompress();
      };
      reader.readAsDataURL(file);
    });
  }

  async function uploadImage(file) {
    const compressed = await compressImage(file);
    // 生成安全文件名
    let fileName = `img_${Date.now()}_${Math.random().toString(36).slice(2,8)}.jpg`;
    fileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    const { data, error } = await client.storage.from(SUPABASE_BUCKET).upload(fileName, compressed, {
      contentType: 'image/jpeg',
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error);
      return null;
    }

    const { data: urlData } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(fileName);
    return urlData?.publicUrl || null;
  }

  function compressVideo(file) {
    return new Promise((resolve, reject) => {
      if (!window.MediaRecorder) {
        reject(new Error('当前浏览器不支持视频压缩，请使用最新版 Chrome 或 Edge。'));
        return;
      }

      const recorderMimeType = pickRecorderMimeType();
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.src = objectUrl;
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';

      let recorder = null;
      let finalMimeType = 'video/webm';
      let drawTimer = null;
      let canvasStream = null;
      let mixedStream = null;
      let audioContext = null;
      let audioSource = null;
      let audioDestination = null;
      let cleaned = false;
      let failed = false;
      let compressTimeout = null;
      let compressionPlan = null;

      function stopTracks(stream) {
        if (!stream) return;
        stream.getTracks().forEach((track) => {
          try { track.stop(); } catch (e) {}
        });
      }

      async function cleanup() {
        if (cleaned) return;
        cleaned = true;
        if (drawTimer) {
          clearInterval(drawTimer);
          drawTimer = null;
        }
        if (compressTimeout) {
          clearTimeout(compressTimeout);
          compressTimeout = null;
        }
        try { video.pause(); } catch (e) {}
        video.removeAttribute('src');
        video.load();
        stopTracks(mixedStream);
        stopTracks(canvasStream);
        if (audioSource) {
          try { audioSource.disconnect(); } catch (e) {}
        }
        if (audioDestination) {
          try { audioDestination.disconnect(); } catch (e) {}
        }
        if (audioContext && audioContext.state !== 'closed') {
          try { await audioContext.close(); } catch (e) {}
        }
        URL.revokeObjectURL(objectUrl);
      }

      video.onerror = async () => {
        await cleanup();
        reject(new Error('视频文件读取失败'));
      };

      video.onloadedmetadata = async () => {
        try {
          const duration = Number(video.duration || 0);
          if (!duration || !Number.isFinite(duration)) {
            await cleanup();
            reject(new Error('无法读取视频时长'));
            return;
          }
          if (duration > VIDEO_MAX_DURATION_SEC + 1) {
            await cleanup();
            reject(new Error('视频时长不能超过10分钟'));
            return;
          }

          compressionPlan = buildVideoCompressionPlan(file, video.videoWidth, video.videoHeight, duration);

          // 尽量缩短等待时间：长视频使用更高播放倍速。
          const playbackRate = duration >= 9 * 60 ? 16 : duration >= 6 * 60 ? 12 : duration >= 2 * 60 ? 8 : 5;
          try {
            video.defaultPlaybackRate = playbackRate;
            video.playbackRate = playbackRate;
          } catch (e) {}

          const timeoutMs = Math.min(
            10 * 60 * 1000,
            Math.max(60 * 1000, Math.ceil((duration * 1000) / Math.max(playbackRate, 1)) + 90 * 1000)
          );
          compressTimeout = setTimeout(async () => {
            failed = true;
            try {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
            } catch (e) {}
            await cleanup();
            reject(new Error('视频压缩超时，请尝试更短视频'));
          }, timeoutMs);

          const canvas = document.createElement('canvas');
          canvas.width = compressionPlan.width;
          canvas.height = compressionPlan.height;
          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) {
            await cleanup();
            reject(new Error('视频画布初始化失败'));
            return;
          }
          if (typeof canvas.captureStream !== 'function') {
            await cleanup();
            reject(new Error('当前浏览器不支持视频压缩，请使用最新版 Chrome 或 Edge。'));
            return;
          }

          canvasStream = canvas.captureStream(compressionPlan.fps);
          const tracks = [...canvasStream.getVideoTracks()];

          try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (AudioCtx) {
              audioContext = new AudioCtx();
              audioSource = audioContext.createMediaElementSource(video);
              audioDestination = audioContext.createMediaStreamDestination();
              audioSource.connect(audioDestination);
              audioDestination.stream.getAudioTracks().forEach((track) => tracks.push(track));
            }
          } catch (err) {
            console.warn('video audio capture failed:', err);
          }

          mixedStream = new MediaStream(tracks);
          try {
            const created = createVideoRecorder(
              mixedStream,
              recorderMimeType,
              compressionPlan.videoBitsPerSecond,
              compressionPlan.audioBitsPerSecond
            );
            recorder = created.recorder;
            finalMimeType = created.normalizedType || 'video/webm';
          } catch (err) {
            await cleanup();
            reject(new Error('视频编码器启动失败'));
            return;
          }

          const chunks = [];
          recorder.ondataavailable = (ev) => {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
          };
          recorder.onerror = async () => {
            failed = true;
            await cleanup();
            reject(new Error('视频压缩失败'));
          };
          recorder.onstop = async () => {
            await cleanup();
            if (failed) return;
            resolve(new Blob(chunks, { type: finalMimeType }));
          };

          function drawFrame() {
            if (video.ended || (Number.isFinite(video.duration) && video.currentTime >= video.duration - 0.05)) {
              if (recorder && recorder.state !== 'inactive') recorder.stop();
              return;
            }
            if (video.paused) return;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          }

          drawFrame();
          drawTimer = setInterval(drawFrame, Math.max(16, Math.round(1000 / compressionPlan.fps)));
          video.onended = () => {
            if (recorder && recorder.state !== 'inactive') recorder.stop();
          };

          if (audioContext && audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          recorder.start(1000);
          await video.play();
        } catch (err) {
          failed = true;
          if (recorder && recorder.state !== 'inactive') recorder.stop();
          await cleanup();
          reject(new Error((err && err.message) ? err.message : '视频压缩启动失败'));
        }
      };
    });
  }

  async function uploadMedia(file) {
    if (!file) throw new Error('未选择文件');
    const mediaIsImage = isImageFile(file);
    const mediaIsVideo = isVideoFile(file);
    if (!mediaIsImage && !mediaIsVideo) throw new Error('仅支持图片或视频文件');

    let compressed = file;
    let mediaType = 'image';
    let contentType = file.type || '';
    let ext = 'jpg';

    if (mediaIsImage) {
      compressed = await compressImage(file);
      mediaType = 'image';
      contentType = 'image/jpeg';
      ext = 'jpg';
    } else {
      compressed = await compressVideo(file);
      mediaType = 'video';
      contentType = compressed.type || 'video/webm';
      ext = /mp4/i.test(contentType) ? 'mp4' : 'webm';
    }

    if (compressed.size > MAX_UPLOAD_SIZE_BYTES) {
      throw new Error(`压缩后仍超过 ${MAX_UPLOAD_SIZE_MB}MB，请缩短时长或降低清晰度`);
    }

    let fileName = `${mediaType}_${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
    fileName = fileName.replace(/[^a-zA-Z0-9_\-\.]/g, '_');

    const { error } = await client.storage.from(SUPABASE_BUCKET).upload(fileName, compressed, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('Supabase upload error:', error);
      throw new Error('上传到存储桶失败');
    }

    const { data: urlData } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(fileName);
    const url = urlData?.publicUrl || null;
    if (!url) throw new Error('获取文件地址失败');
    return { url, type: mediaType };
  }

  function createMessageContentNode(text) {
    // 空文本兜底
    if (!text && text !== '') return document.createTextNode('');

    const frag = document.createDocumentFragment();
    // 匹配文本中的 URL（仅 http/https）
    const urlRegex = /https?:\/\/[^\s]+/g;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const idx = match.index;
      // 先插入 URL 之前的纯文本
      if (idx > lastIndex) {
        const plain = text.slice(lastIndex, idx);
        frag.appendChild(document.createTextNode(plain));
      }

      // 按扩展名判断是图片、视频还是普通链接
      const urlForExt = url.split('#')[0].split('?')[0];
      const isImg = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(urlForExt);
      const isVideo = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(urlForExt);
      if (isImg) {
        const wrap = document.createElement('div');
        wrap.className = 'inline-img-wrap';
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'image';
        img.className = 'inline-msg-img';
        img.style.maxWidth = '200px';
        img.style.maxHeight = '200px';
        img.style.borderRadius = '8px';
        img.style.cursor = 'pointer';
        img.addEventListener('click', () => {
          const modal = document.createElement('div');
          modal.style.position = 'fixed';
          modal.style.inset = '0';
          modal.style.background = 'rgba(0,0,0,0.6)';
          modal.style.display = 'flex';
          modal.style.alignItems = 'center';
          modal.style.justifyContent = 'center';
          modal.style.zIndex = 9999;
          const large = document.createElement('img');
          large.src = url;
          large.style.maxWidth = '90%';
          large.style.maxHeight = '90%';
          large.style.borderRadius = '8px';
          modal.appendChild(large);
          modal.addEventListener('click', () => document.body.removeChild(modal));
          document.body.appendChild(modal);
        });
        wrap.appendChild(img);
        frag.appendChild(wrap);
      } else if (isVideo) {
        const wrap = document.createElement('div');
        wrap.className = 'inline-video-wrap';
        wrap.style.maxWidth = '260px';

        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        video.className = 'inline-msg-video';
        video.style.width = '100%';
        video.style.maxHeight = '220px';
        video.style.borderRadius = '8px';
        video.style.background = '#000';

        wrap.appendChild(video);
        frag.appendChild(wrap);
      } else {
        // 普通链接：渲染为可点击超链接
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;
        frag.appendChild(a);
      }

      lastIndex = idx + url.length;
    }
    // 补上最后一段纯文本
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    // 如果没有命中 URL，直接返回原文本
    if (!frag.childNodes.length) return document.createTextNode(text);
    return frag;
  }

  // 使用 DOM 构建消息内容，避免直接 innerHTML 带来的注入风险
  function addMessageToWindow(sender, text) {
    if(!chatWindow) return;
    const isMe = sender === currentUser;
    const row = document.createElement('div');
    row.className = 'msg-row ' + (isMe ? 'msg-right' : 'msg-left');

    const avWrap = makeAvatarDOM(sender, isMe ? myAvatar : getAvatarForUser(sender), 44);
    const bubble = document.createElement('div');
    bubble.className = 'bubble ' + (isMe ? 'me' : 'you');

    const contentNode = createMessageContentNode(text || '');
    bubble.appendChild(contentNode);

    if (isMe) {
      row.style.justifyContent = 'flex-end';
      row.appendChild(bubble);
      row.appendChild(avWrap);
    } else {
      row.style.justifyContent = 'flex-start';
      row.appendChild(avWrap);
      row.appendChild(bubble);
    }
    chatWindow.appendChild(row);
    chatWindow.scrollTop = chatWindow.scrollHeight;
  }

  // --------------- 发送消息（文本/媒体） ---------------
  async function sendMessage(text) {
    if (!currentFriend) { alert('鐠囩兘鈧瀚ㄦ导姘崇樈'); return; }
    if (!text) return;
    const payload = { from: currentUser, to: currentFriend, message: text };
    if (socket && socket.connected) {
      socket.emit('send-message', payload);
    } else {
      fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
    }
    addMessageToWindow(currentUser, text);
    throttleLoadConversations();
    if(msgInput) msgInput.value = '';
  }

  async function handleMediaSelection(fileInput, file) {
    if (!currentUser || !currentFriend) {
      alert('请先选择会话');
      fileInput.value = '';
      return;
    }
    if (!isImageFile(file) && !isVideoFile(file)) {
      alert('仅支持图片或视频文件');
      fileInput.value = '';
      return;
    }

    const oldBtnText = btnSendImage ? btnSendImage.textContent : '';
    if (btnSendImage) {
      btnSendImage.disabled = true;
      btnSendImage.textContent = isVideoFile(file) ? '压缩中...' : '上传中...';
    }

    try {
      const uploaded = await uploadMedia(file);
      addMessageToWindow(currentUser, uploaded.url);
      const payload = { from: currentUser, to: currentFriend, message: uploaded.url, type: uploaded.type };
      if (socket && socket.connected) socket.emit('send-message', payload);
      else fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
      throttleLoadConversations();
    } catch (err) {
      alert((err && err.message) ? err.message : '上传失败');
    } finally {
      fileInput.value = '';
      if (btnSendImage) {
        btnSendImage.disabled = false;
        btnSendImage.textContent = oldBtnText || '发送图片/视频';
      }
    }
  }
  // --------------- 发送区事件绑定 ---------------
  if(btnSendText) btnSendText.addEventListener('click', () => sendMessage(msgInput.value.trim()));
  if(msgInput) msgInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') sendMessage(msgInput.value.trim()); });
  if(btnSendImage && imgUpload) btnSendImage.addEventListener('click', () => imgUpload.click());

  // --------------- 文件选择并发送 ---------------
  if(imgUpload) {
    imgUpload.addEventListener('change', async (e) => {
      const fileInput = e.target;
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      // 统一走媒体发送流程（压缩 + 上传 + 发送 URL）
      await handleMediaSelection(fileInput, file);
      return;
      /*
      if (!url) {
        alert('娑撳﹣绱舵径杈Е');
        fileInput.value = '';
        return;
      }
      // 发送本地预览消息（旧流程，已停用）
      addMessageToWindow(currentUser, url);
      // 通过 socket 或 fallback 接口发送给对方（旧流程）
      if (!currentUser || !currentFriend) { fileInput.value = ''; return; }
      const payload = { from: currentUser, to: currentFriend, message: url, type: 'image' };
      if (socket && socket.connected) socket.emit('send-message', payload);
      else fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
      fileInput.value = '';
      throttleLoadConversations();
      */
    });
  }

  // --------------- 备注/好友/头像/登录注册 ---------------
  function editRemarkForFriend(f){
    const cur = friends.find(x=>x.friend===f); const curR = cur?cur.remark:'';
    const r = prompt('设置备注（留空则取消）', curR);
    if(r===null) return;
    fetch('/set-remark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:currentUser,friend:f,remark:r})})
      .then(res=>res.json()).then(j=>{ if(j.success){ loadFriends(); throttleLoadConversations(); } else alert('鐠佸墽鐤嗘径杈Е'); })
      .catch(()=>alert('鐠囬攱鐪版径杈Е'));
  }

  if(btnAdd) btnAdd.addEventListener('click', ()=> {
    const t = newFriendInput.value.trim();
    if(!t){ alert('鐠囩柉绶崗銉ャ偨閸欏鏁ら幋宄版倳'); return; }
    fetch('/add-friend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:currentUser,friend:t})})
      .then(r=>r.json()).then(res=>{ if(res.success){ newFriendInput.value=''; loadFriends(); throttleLoadConversations(); } else alert('添加失败: ' + (res.msg||'未知')); })
      .catch(()=>alert('添加好友失败'));
  });

  if(btnSaveAvatar) btnSaveAvatar.addEventListener('click', ()=> {
    const url = avatarInput.value.trim();
    fetch('/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser,avatar:url})})
      .then(r=>r.json()).then(res=>{ if(res.success){ myAvatar = url || ''; avatarCache[currentUser] = myAvatar; renderMyAvatar(); loadFriends(); throttleLoadConversations(); } else alert('娣囨繂鐡ㄦ径杈Е'); })
      .catch(()=>alert('保存头像失败'));
  });

  if(btnRegister) btnRegister.addEventListener('click', async () => {
    const u = document.getElementById('li-username').value.trim();
    const p = document.getElementById('li-password').value;
    const c = document.getElementById('li-code').value.trim();
    if(!u||!p){ alert('用户名/密码不能为空'); return; }
    if(!c){ alert('鐠囧嘲锝為崘娆撳€嬬拠椋庣垳'); return; }
    try {
      const r = await fetch('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p,code:c})});
      const res = await r.json();
      alert(res.success? '注册成功，请登录' : ('注册失败: ' + (res.msg||'未知')));
    } catch(e) { alert('注册请求失败'); }
  });

  if(btnLogin) btnLogin.addEventListener('click', async () => {
    const u = document.getElementById('li-username').value.trim();
    const p = document.getElementById('li-password').value;
    if(!u||!p){ alert('用户名/密码不能为空'); return; }
    try {
      const r = await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
      const res = await r.json();
      if(res.success){
        currentUser = res.user.username;
        myAvatar = res.user.avatar || '';
        localStorage.setItem('chat_currentUser', currentUser);
        localStorage.setItem('chat_myAvatar', myAvatar || '');
        avatarCache[currentUser] = myAvatar;
        document.getElementById('meName').textContent = currentUser;
        avatarInput.value = myAvatar;
        renderMyAvatar();
        connectSocket();
        await loadFriends();
        throttleLoadConversations();
        meNote.value = DEV_NOTE;
        showApp();
        document.getElementById('li-password').value = '';
      } else alert('登录失败: ' + (res.msg||'未知'));
    } catch(e) { alert('登录请求失败'); }
  });


  // Auto-login
  (function tryAutoLogin(){
    const stored = localStorage.getItem('chat_currentUser');
    const storedAvatar = localStorage.getItem('chat_myAvatar') || '';
    if(stored){
      currentUser = stored;
      myAvatar = storedAvatar;
      avatarCache[currentUser] = myAvatar;
      document.getElementById('meName').textContent = currentUser;
      avatarInput.value = myAvatar;
      renderMyAvatar();
      connectSocket();
      loadFriends().then(()=>{ throttleLoadConversations(); 
          fetchUnreadOnLogin();
      });
      
      meNote.value = DEV_NOTE;
      showApp();
      document.getElementById('li-password').value = '';
    } else {
      showLogin();
    }
  })();

  // Logout
  if(btnLogout) btnLogout.addEventListener('click', ()=> {
    if(currentUser) localStorage.setItem('chat_lastUser', currentUser);
    localStorage.removeItem('chat_currentUser');
    localStorage.removeItem('chat_myAvatar');
    try{ if(socket){ socket.emit('logout', currentUser); socket.disconnect(); } }catch(e){}
    location.reload();
  });

  // Expose some globals for legacy code expecting them
  window.currentUser = currentUser;
  window.currentFriend = currentFriend;
  window.socket = socket;

})(); // end IIFE
