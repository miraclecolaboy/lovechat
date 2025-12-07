const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(bodyParser.json());
app.use(express.static(__dirname));

// ---------- 数据库配置 ----------
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'chatdb',
  password: '1',
  port: 5432,
});

// ---------- 初始化数据库 ----------
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS friends (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      friend_id INT NOT NULL,
      remark TEXT,
      UNIQUE(user_id, friend_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_user TEXT NOT NULL,
      to_user TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'text',
      ts BIGINT DEFAULT (EXTRACT(EPOCH FROM now())*1000)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS unread_counts (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      from_user_id INT NOT NULL,
      count INT DEFAULT 0,
      UNIQUE(user_id, from_user_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);
}
initDB().catch(console.error);

console.log('DB connected');

// ---------- REST 接口 ----------
app.post('/register', async (req, res) => {
  const { username, password, code } = req.body;

  // 校验用户名/密码
  if (!username || !password) return res.json({ success: false, msg: '用户名/密码不能为空' });

  // 校验注册码
  if (code !== '0123') return res.json({ success: false, msg: '注册码错误' });

  try {
    await pool.query('INSERT INTO users(username, password) VALUES($1, $2)', [username, password]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, msg: err.code === '23505' ? '用户名已存在' : err.message });
  }
});


app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, msg: '用户名/密码不能为空' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE username=$1 AND password=$2', [username, password]);
    if (r.rows.length) {
      res.json({ success: true, user: r.rows[0] });
    } else {
      res.json({ success: false, msg: '用户名或密码错误' });
    }
  } catch (err) {
    res.json({ success: false, msg: err.message });
  }
});

app.get('/friends/:username', async (req, res) => {
  const username = req.params.username;
  try {
    const r = await pool.query(`
      SELECT f.friend_id, f.remark, u.username AS friend, u.avatar
      FROM friends f
      JOIN users u ON f.friend_id = u.id
      WHERE f.user_id = (SELECT id FROM users WHERE username=$1)
    `, [username]);
    res.json(r.rows.map(x => ({ friend: x.friend, avatar: x.avatar, remark: x.remark })));
  } catch (err) {
    res.json([]);
  }
});

app.post('/add-friend', async (req, res) => {
  const { user, friend, remark } = req.body;

  if (!user || !friend) return res.json({ success: false, msg: '用户名和好友不能为空' });
  if (user === friend) return res.json({ success: false, msg: '不能添加自己为好友' });

  try {
    // 获取用户 ID
    const userRes = await pool.query('SELECT id FROM users WHERE username=$1', [user]);
    const friendRes = await pool.query('SELECT id FROM users WHERE username=$1', [friend]);
    if (!userRes.rows.length || !friendRes.rows.length) return res.json({ success: false, msg: '用户不存在' });

    const userId = userRes.rows[0].id;
    const friendId = friendRes.rows[0].id;

    // 插入或更新双向好友关系
    await pool.query(`
      INSERT INTO friends(user_id, friend_id, remark)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, friend_id) DO UPDATE
      SET remark = EXCLUDED.remark
    `, [userId, friendId, remark || '']);

    await pool.query(`
      INSERT INTO friends(user_id, friend_id, remark)
      VALUES ($1, $2, '')
      ON CONFLICT (user_id, friend_id) DO NOTHING
    `, [friendId, userId]); // 对方的备注保持为空

    res.json({ success: true });

  } catch (err) {
    console.error('/add-friend ERR:', err);
    res.json({ success: false, msg: err.message });
  }
});


app.post('/set-remark', async (req, res) => {
  const { owner, friend, remark } = req.body;
  try {
    const ownerRes = await pool.query('SELECT id FROM users WHERE username=$1', [owner]);
    const friendRes = await pool.query('SELECT id FROM users WHERE username=$1', [friend]);
    if (!ownerRes.rows.length || !friendRes.rows.length) return res.json({ success: false });

    await pool.query('UPDATE friends SET remark=$1 WHERE user_id=$2 AND friend_id=$3', [
      remark,
      ownerRes.rows[0].id,
      friendRes.rows[0].id
    ]);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post('/profile', async (req, res) => {
  const { username, avatar } = req.body;
  try {
    await pool.query('UPDATE users SET avatar=$1 WHERE username=$2', [avatar, username]);
    res.json({ success: true });
  } catch (err) {
    console.error('/profile ERR:', err);
    res.json({ success: false });
  }
});

app.get('/messages/:user/:friend', async (req, res) => {
  const { user, friend } = req.params;
  try {
    const r = await pool.query(
      'SELECT * FROM messages WHERE (from_user=$1 AND to_user=$2) OR (from_user=$2 AND to_user=$1) ORDER BY ts ASC',
      [user, friend]
    );
    res.json(r.rows);
  } catch (err) {
    res.json([]);
  }
});

// ---------- Socket.IO ----------
const onlineUsers = {}; // username => socket.id

function broadcastOnlineStatus() {
  const onlineList = Object.keys(onlineUsers);
  io.emit('online-status', onlineList);
}

io.on('connection', socket => {
  let currentUser = null;

  // 登录
  socket.on('login', async username => {
    currentUser = username;
    onlineUsers[username] = socket.id;

    // 上线时推送未读计数
    try {
      const res = await pool.query(`
        SELECT u.username AS from_user, c.count
        FROM unread_counts c
        JOIN users u ON c.from_user_id = u.id
        WHERE c.user_id = (SELECT id FROM users WHERE username=$1)
      `, [username]);
      socket.emit('unread-counts', res.rows);
    } catch (err) {
      console.error('unread-counts ERR:', err);
    }

    // 广播在线状态
    broadcastOnlineStatus();
  });

  // 发送消息
  socket.on('send-message', async data => {
    const { from, to, message, type } = data;
    if (!from || !to || !message) return;

    try {
      await pool.query('INSERT INTO messages(from_user,to_user,message,type,ts) VALUES($1,$2,$3,$4,$5)',
        [from, to, message, type || 'text', Date.now()]);

      const fromRes = await pool.query('SELECT id FROM users WHERE username=$1', [from]);
      const toRes = await pool.query('SELECT id FROM users WHERE username=$1', [to]);
      if (fromRes.rows.length && toRes.rows.length) {
        const fromId = fromRes.rows[0].id;
        const toId = toRes.rows[0].id;

        await pool.query(`
          INSERT INTO unread_counts(user_id, from_user_id, count)
          VALUES($1,$2,1)
          ON CONFLICT (user_id, from_user_id) DO UPDATE
          SET count = unread_counts.count + 1
        `, [toId, fromId]);
      }

      const toSocketId = onlineUsers[to];
      if (toSocketId) {
        io.to(toSocketId).emit('receive-message', data);
      }
    } catch (err) {
      console.error('send-message ERR:', err);
    }
  });

  // 用户打开会话，重置未读计数
  socket.on('open-conversation', async ({ user, friend }) => {
    try {
      const userRes = await pool.query('SELECT id FROM users WHERE username=$1', [user]);
      const friendRes = await pool.query('SELECT id FROM users WHERE username=$1', [friend]);
      if (userRes.rows.length && friendRes.rows.length) {
        const userId = userRes.rows[0].id;
        const friendId = friendRes.rows[0].id;
        await pool.query('UPDATE unread_counts SET count=0 WHERE user_id=$1 AND from_user_id=$2', [userId, friendId]);
      }
    } catch (err) {
      console.error('open-conversation ERR:', err);
    }
  });

  // 登出 / 断开
  socket.on('disconnect', () => {
    if (currentUser && onlineUsers[currentUser] === socket.id) {
      delete onlineUsers[currentUser];
      broadcastOnlineStatus();
    }
  });

  socket.on('logout', username => {
    if (username && onlineUsers[username] === socket.id) {
      delete onlineUsers[username];
      broadcastOnlineStatus();
    }
  }); 
});

// ---------- 启动服务器 ----------
server.listen(3000, () => console.log('Server running at http://localhost:3000'));
