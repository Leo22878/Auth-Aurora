const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// CORS Configuration
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  next();
});

// Configuration
const USERS_FILE = path.join(__dirname, 'users.json');
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = file.fieldname === 'skin' ? 'skins' : 'capes';
    cb(null, `public/${type}/`);
  },
  filename: (req, file, cb) => {
    cb(null, `${req.user.userUUID}.png`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    file.mimetype === 'image/png' ? cb(null, true) : cb(new Error('Only PNG allowed!'));
  }
});

// Helpers
const readUsers = () => JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
const saveUsers = users => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

// Middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  const user = readUsers().find(u => u.accessToken === token);
  user ? (req.user = user, next()) : res.status(401).json({ success: false, error: 'Unauthorized' });
};

// Registration Endpoint
app.post('/register', async (req, res) => {
  const { login, password } = req.body;
  const users = readUsers();
  
  if (users.some(u => u.username === login)) 
    return res.status(400).json({ success: false, error: 'User exists' });

  const user = {
    username: login,
    password: await bcrypt.hash(password, 10),
    userUUID: uuidv4(),
    accessToken: null,
    isAlex: false,
    skinUrl: null,
    capeUrl: null,
    serverID: null
  };
  
  users.push(user);
  saveUsers(users);
  res.json({ success: true });
});

// Auth Endpoint
app.post('/auth', async (req, res) => {
  try {
    const { login, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.username === login);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid credentials' 
      });
    }

    user.accessToken = uuidv4();
    saveUsers(users);

    res.json({
      success: true,
      result: {
        username: user.username,
        userUUID: user.userUUID,
        accessToken: user.accessToken,
        isAlex: user.isAlex,
        skinUrl: user.skinUrl,
        capeUrl: user.capeUrl
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
});

// Join Endpoint
app.post('/join', (req, res) => {
  const { accessToken, userUUID, serverID } = req.body;
  const users = readUsers();
  const user = users.find(u => 
    u.accessToken === accessToken && 
    u.userUUID === userUUID
  );

  if (!user) {
    return res.json({ 
      success: true,
      result: false,
      message: 'Invalid credentials or outdated session'
    });
  }

  user.serverID = serverID;
  saveUsers(users);

  res.json({ 
    success: true, 
    result: true 
  });
});

// HasJoined Endpoint
app.post('/hasJoined', (req, res) => {
  const { username, serverID } = req.body;
  const users = readUsers();
  const user = users.find(u => 
    u.username === username && 
    u.serverID === serverID
  );

  if (!user) {
    return res.status(404).json({ 
      success: false, 
      error: 'User not found' 
    });
  }

  res.json({
    success: true,
    result: {
      userUUID: user.userUUID,
      isAlex: user.isAlex,
      skinUrl: user.skinUrl,
      capeUrl: user.capeUrl
    }
  });
});

// Profiles Endpoint
app.post('/profiles', (req, res) => {
  const requestedNames = req.body.usernames || [];
  const users = readUsers();
  
  const result = requestedNames
    .map(username => 
      users.find(u => u.username === username)
    )
    .filter(Boolean)
    .map(user => ({
      id: user.userUUID,
      name: user.username
    }));

  res.json({ 
    success: true, 
    result 
  });
});

// Profile Endpoint
app.post('/profile', (req, res) => {
  const { userUUID } = req.body;
  const users = readUsers();
  const user = users.find(u => u.userUUID === userUUID);

  if (!user) {
    return res.status(404).json({ 
      success: false, 
      error: 'User not found' 
    });
  }

  res.json({
    success: true,
    result: {
      username: user.username,
      isAlex: user.isAlex,
      skinUrl: user.skinUrl,
      capeUrl: user.capeUrl
    }
  });
});

// File Upload Endpoints
const PROTOCOL = process.env.PROTOCOL || 'https';
const HOST = process.env.HOST || 'auth.mineshit.ru';
const PORT = process.env.PORT || '25608';

app.post('/upload-skin', authenticate, upload.single('skin'), (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.userUUID === req.user.userUUID);
  
  user.skinUrl = `${PROTOCOL}://${HOST}:${PORT}/skins/${req.file.filename}`;
  user.isAlex = req.body.model === 'slim';

  saveUsers(users);
  
  res.json({ 
    success: true, 
    result: {
      skinUrl: user.skinUrl,
      isAlex: user.isAlex
    }
  });
});

app.use('/skins', express.static(path.join(__dirname, 'public/skins'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Expires', '0');
    res.setHeader('Pragma', 'no-cache');
  }
}));

app.use('/capes', express.static(path.join(__dirname, 'public/capes'), {
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.setHeader('Expires', '0');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// Start Server
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
