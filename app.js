// app.js — 完整版（图片压缩/上传 + 全局消息图片预览）
(() => {
  // --------------- 配置 ---------------
  
  const SUPABASE_URL = 'https://fjjbodkvytpekzzxerzr.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZqamJvZGt2eXRwZWt6enhlcnpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4MDAyMjMsImV4cCI6MjA4MDM3NjIyM30.ctMcySWOXS9SbBQBRVQjpK-6SlSxjSZ8aYmUx_Q3ee4';
  const SUPABASE_BUCKET = 'chat';

  // supabase client（确保 SDK 已在 HTML 先引入）
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // --------------- DOM 元素 ---------------
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
    showConversationsPanel(); // 切换回会话列表
  });
}

  const chatWindow = document.getElementById('chatWindow');
  const msgInput = document.getElementById('msgInput');
  const btnSendText = document.getElementById('btnSendText');

  // 图片上传元素（HTML 中应存在）
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
  const DEV_NOTE = meNote.value; // 直接从 HTML 读取

  // --------------- 状态 ---------------
  let currentUser = null;
  let currentFriend = null;
  let friends = [];

// 新增红点
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
    const titleDiv = div.querySelector('div > div'); // 会话标题
    if (titleDiv && titleDiv.textContent.includes(friend)) {
      const dot = div.querySelector('.red-dot');
      if (dot) dot.style.visibility = unreadMap[friend] ? 'visible' : 'hidden';
    }
  });
  // 同步 localStorage
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
  function showLogin() { if(loginView) loginView.style.display='block'; if(app) app.style.display='none'; document.title='简约聊天'; }
  function showApp() { if(loginView) loginView.style.display='none'; if(app) app.style.display='block'; }
  function switchTab(targetId){
    tabs.forEach(t => t.id === targetId ? t.classList.add('active') : t.classList.remove('active'));
    navBtns.forEach(b => b.dataset.target === targetId ? b.classList.add('active') : b.classList.remove('active'));
    if(targetId === 'tab-messages') throttleLoadConversations();
  }
  navBtns.forEach(b => b.addEventListener('click', ()=> switchTab(b.dataset.target)));

  function escapeHTML(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function truncate(s,n){ if(!s) return ''; return s.length>n?s.slice(0,n-1)+'…':s; }
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

  // 同步后端未读消息到本地 unreadMap（大于0记作 true）
socket.on('unread-counts', counts => {
  // counts 格式: [{ from_user: 'Alice', count: 3 }, ...]
  counts.forEach(item => {
    if(item.count > 0){
      unreadMap[item.from_user] = true;
      updateConversationRedDot(item.from_user);
    }
  });
});

  socket.on('online-status', list => {
    // 确保在线列表全局可用
    window.onlineUsersList = list || [];
    renderContacts(); // 每次在线状态变化都刷新好友列表
  });

// socket.on('receive-message', ...)
socket.on('receive-message', data => {
  if (!data || !data.from) return;
  addMessageToWindow(data.from, data.message);
  

 // 标记未读
  unreadMap[data.from] = true;
  updateConversationRedDot(data.from);

  // 更新消息列表 DOM
  updateConversationRedDot(data.from);

  //  桌面通知
  if (Notification.permission === 'granted') {
    const n = new Notification(data.from, {
      body: data.message.length > 50 ? data.message.slice(0, 50) + '…' : data.message,
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

    renderContacts();    // ← **最重要的修复点**

  }catch(e){
    friends=[];
    renderContacts();    // 错误时也刷新（保持一致）
  }
}

function renderContacts() {
  if (!friendsList) return;
  friendsList.innerHTML = '';

  // 获取当前在线用户列表
  const onlineList = window.onlineUsersList || []; // window.onlineUsersList 会在 socket.on('online-status') 更新

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
  
  // 直接使用最新的在线列表判断
  if (window.onlineUsersList && Array.isArray(window.onlineUsersList)) {
    sub.textContent = window.onlineUsersList.includes(f) ? '在线' : '离线';
  } else {
    sub.textContent = '离线'; // 默认离线
  }

  txt.appendChild(name);
  txt.appendChild(sub);

  left.appendChild(txt);
  div.appendChild(left);


    // 点击打开聊天
    div.addEventListener('click', () => {
      switchTab('tab-messages');
      openConversation(f);
    });

    // 编辑备注按钮
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
  return t2 - t1; // 最新在前
});

    conv.forEach(c => {
      const div = document.createElement('div');
      div.className = 'friend';
      div.style.position = 'relative'; // 关键：红点绝对定位必须在 relative 父容器

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
        ((c.last.from_user === currentUser ? '你: ' : '') + truncate(c.last.message, 40))
        : '暂无消息';

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

      // 点击打开会话
      div.addEventListener('click', () => openConversation(c.friend));

      conversationsList.appendChild(div);
    });

  } catch (e) { console.error(e); }
  finally { _isLoadingConversations = false; }
}


function openConversation(friend) {
  currentFriend = friend;
 // 打开会话就标记为已读
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


  // --------------- 图片压缩 & 上传 ---------------
  // 返回 Blob（JPEG）且尽量压缩到 maxSizeMB
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

        // 限制像素，避免极大图片
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

  // --------------- 消息渲染：通用的 URL/图片识别 ---------------
  // 将文本拆分为普通文本、普通链接、图片预览 DOM 片段
  function createMessageContentNode(text) {
    // 非空保护
    if (!text && text !== '') return document.createTextNode('');

    const frag = document.createDocumentFragment();
    // URL 正则（很简单，适合大多数 http(s) 链接）
    const urlRegex = /https?:\/\/[^\s]+/g;
    let lastIndex = 0;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      const url = match[0];
      const idx = match.index;
      // 之前的普通文本
      if (idx > lastIndex) {
        const plain = text.slice(lastIndex, idx);
        frag.appendChild(document.createTextNode(plain));
      }

      // 判断是否为图片链接（按扩展名）
      const isImg = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(url);
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
      } else {
        // 普通链接显示为可点链接
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = url;
        frag.appendChild(a);
      }

      lastIndex = idx + url.length;
    }
    // 最后的文本
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    // 如果没有匹配到任何 URL，直接返回文本节点
    if (!frag.childNodes.length) return document.createTextNode(text);
    return frag;
  }

  // 将消息内容安全渲染到气泡（不使用 innerHTML）
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

  // --------------- 发送消息（文本/图片） ---------------
  async function sendMessage(text) {
    if (!currentFriend) { alert('请选择会话'); return; }
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

  // --------------- 事件绑定：文本发送 ---------------
  if(btnSendText) btnSendText.addEventListener('click', () => sendMessage(msgInput.value.trim()));
  if(msgInput) msgInput.addEventListener('keydown', (e) => { if(e.key === 'Enter') sendMessage(msgInput.value.trim()); });

  // --------------- 事件绑定：图片选择 & 自动上传 ---------------
  if(imgUpload) {
    imgUpload.addEventListener('change', async (e) => {
      const fileInput = e.target;
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      // 上传并获取公开 URL
      const url = await uploadImage(file);
      if (!url) {
        alert('上传失败');
        fileInput.value = '';
        return;
      }
      // 插入到会话窗口并作为消息发送（与 sendMessage 保持一致）
      addMessageToWindow(currentUser, url);
      // 发送到服务器
      if (!currentUser || !currentFriend) { fileInput.value = ''; return; }
      const payload = { from: currentUser, to: currentFriend, message: url, type: 'image' };
      if (socket && socket.connected) socket.emit('send-message', payload);
      else fetch('/send-fallback', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) }).catch(()=>{});
      fileInput.value = '';
      throttleLoadConversations();
    });
  }

  // --------------- 编辑备注 / 添加好友 / 头像保存 / 注册登录等（保留原逻辑） ---------------
  function editRemarkForFriend(f){
    const cur = friends.find(x=>x.friend===f); const curR = cur?cur.remark:'';
    const r = prompt('设置备注（留空则取消）', curR);
    if(r===null) return;
    fetch('/set-remark',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({owner:currentUser,friend:f,remark:r})})
      .then(res=>res.json()).then(j=>{ if(j.success){ loadFriends(); throttleLoadConversations(); } else alert('设置失败'); })
      .catch(()=>alert('请求失败'));
  }

  if(btnAdd) btnAdd.addEventListener('click', ()=> {
    const t = newFriendInput.value.trim();
    if(!t){ alert('请输入好友用户名'); return; }
    fetch('/add-friend',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:currentUser,friend:t})})
      .then(r=>r.json()).then(res=>{ if(res.success){ newFriendInput.value=''; loadFriends(); throttleLoadConversations(); } else alert('添加失败:'+ (res.msg||'未知')); })
      .catch(()=>alert('添加好友失败'));
  });

  if(btnSaveAvatar) btnSaveAvatar.addEventListener('click', ()=> {
    const url = avatarInput.value.trim();
    fetch('/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:currentUser,avatar:url})})
      .then(r=>r.json()).then(res=>{ if(res.success){ myAvatar = url || ''; avatarCache[currentUser] = myAvatar; renderMyAvatar(); loadFriends(); throttleLoadConversations(); } else alert('保存失败'); })
      .catch(()=>alert('保存头像失败'));
  });

  if(btnRegister) btnRegister.addEventListener('click', async () => {
    const u = document.getElementById('li-username').value.trim();
    const p = document.getElementById('li-password').value;
    const c = document.getElementById('li-code').value.trim();
    if(!u||!p){ alert('用户名/密码不能为空'); return; }
    if(!c){ alert('请填写邀请码'); return; }
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
