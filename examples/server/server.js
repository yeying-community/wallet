const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const JWT_SECRET = 'your-secret-key'; // 生产环境使用环境变量
const challenges = new Map(); // 生产环境使用 Redis

// 1. 获取 Challenge
app.post('/api/auth/challenge', (req, res) => {
  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: '缺少地址' });
  }
  
  // 生成随机 Challenge
  const challenge = `请签名以登录 YeYing Wallet\n\n随机数: ${Math.random().toString(36).substring(7)}\n时间戳: ${Date.now()}`;
  
  // 保存 Challenge（5分钟过期）
  challenges.set(address.toLowerCase(), {
    challenge,
    timestamp: Date.now()
  });
  
  res.json({ challenge });
});

// 2. 验证签名
app.post('/api/auth/verify', (req, res) => {
  const { address, signature } = req.body;
  
  if (!address || !signature) {
    return res.status(400).json({ error: '缺少参数' });
  }
  
  const addressLower = address.toLowerCase();
  const challengeData = challenges.get(addressLower);

  if (!challengeData) {
    return res.status(400).json({ error: 'Challenge 不存在或已过期' });
  }
  
  // 检查过期（5分钟）
  if (Date.now() - challengeData.timestamp > 5 * 60 * 1000) {
    challenges.delete(addressLower);
    return res.status(400).json({ error: 'Challenge 已过期' });
  }

  try {
    // 验证签名
    const recoveredAddress = ethers.utils.verifyMessage(
      challengeData.challenge,
      signature
    );
    
    if (recoveredAddress.toLowerCase() !== addressLower) {
      return res.status(401).json({ error: '签名验证失败' });
    }

    // 删除已使用的 Challenge
    challenges.delete(addressLower);
    
    // 生成 JWT Token
    const token = jwt.sign(
      { address: addressLower },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token });
    
  } catch (error) {
    console.error('验证失败:', error);
    res.status(500).json({ error: '验证失败' });
  }
});

// 3. 认证中间件
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未授权' });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

// 4. 受保护的路由示例
app.get('/api/user/profile', authenticate, (req, res) => {
  res.json({
    address: req.user.address,
    message: '这是受保护的数据',
    timestamp: Date.now()
  });
});

app.listen(4001, () => {
  console.log('后端服务运行在 http://localhost:4001');
});

