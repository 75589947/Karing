// ============= 极简记事本 =============
const TXT_FILE = 'TEXT.txt';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const token = url.searchParams.get('token');
    const ADMIN_UUID = env.ADMIN_UUID;

    // 管理员页面
    if (path === `/${ADMIN_UUID}`) {
      if (request.method === 'POST') {
        const body = await request.text();
        if (body.startsWith('token:')) {
          const token = body.slice(6) || Math.random().toString(36).substring(2, 10);
          await env.KV.put('SHARE_TOKEN', token);
          return new Response(token); // 返回生成的token
        }
        await env.KV.put(TXT_FILE, body);
        return new Response('OK');
      }
      
      const content = await env.KV.get(TXT_FILE) || '';
      return new Response(renderPage(content), {
        headers: { 'Content-Type': 'text/html;charset=utf-8' }
      });
    }

    // 分享页面
    if (path === '/s' && token) {
      const savedToken = await env.KV.get('SHARE_TOKEN');
      if (token === savedToken) {
        const content = await env.KV.get(TXT_FILE) || '';
        return new Response(content, {
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
      }
      return new Response('Invalid token', { status: 403 });
    }

    // 其他所有路径都返回404
    return new Response('Not found', { status: 404 });
  }
};

function renderPage(content) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>极简记事本</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { 
  font-family: -apple-system, BlinkMacSystemFont, sans-serif;
  background: #f5f5f5;
  padding: 20px;
  min-height: 100vh;
}
.container {
  max-width: 800px;
  margin: 0 auto;
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  overflow: hidden;
}
.header {
  background: #4a90e2;
  color: white;
  padding: 20px;
  text-align: center;
}
.editor {
  width: 100%;
  height: 50vh;
  min-height: 300px;
  border: none;
  padding: 20px;
  font-size: 16px;
  line-height: 1.5;
  resize: vertical;
  outline: none;
  font-family: inherit;
}
.controls {
  padding: 15px 20px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.btn {
  padding: 8px 16px;
  border: 1px solid #4a90e2;
  background: white;
  color: #4a90e2;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.btn.primary {
  background: #4a90e2;
  color: white;
}
.status {
  color: #666;
  font-size: 14px;
  margin-left: auto;
}
.share {
  padding: 0 20px 15px;
}
.share input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
}
.link {
  margin-top: 10px;
  display: none;
}
.link input {
  background: #f9f9f9;
}
@media (max-width: 600px) {
  body { padding: 10px; }
  .controls { flex-direction: column; align-items: stretch; }
  .status { margin-left: 0; text-align: center; }
}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h2>📝 极简记事本</h2>
</div>
<textarea class="editor" id="editor" placeholder="开始编辑...">${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</textarea>
<div class="share">
<input type="text" id="tokenInput" placeholder="分享密码（可选）">
<div class="link" id="linkBox">
<input type="text" id="link" readonly>
</div>
</div>
<div class="controls">
<button class="btn primary" onclick="save()">💾 保存</button>
<button class="btn" onclick="generateLink()">🔗 生成链接</button>
<span class="status" id="status"></span>
</div>
</div>
<script>
function save() {
  const content = document.getElementById('editor').value;
  fetch('', { method: 'POST', body: content })
    .then(() => showStatus('已保存'))
    .catch(() => showStatus('保存失败'));
}

function generateLink() {
  const userToken = document.getElementById('tokenInput').value;
  const btn = event.target;
  const originalText = btn.innerHTML;
  
  btn.disabled = true;
  btn.innerHTML = '⏳ 生成中...';
  
  // 发送请求生成token
  fetch('', { method: 'POST', body: 'token:' + userToken })
    .then(response => response.text())
    .then(token => {
      const link = location.origin + '/s?token=' + token;
      
      document.getElementById('linkBox').style.display = 'block';
      document.getElementById('link').value = link;
      
      // 自动复制到剪贴板
      copyToClipboard(link)
        .then(() => {
          showStatus('链接已复制');
        })
        .catch(() => {
          document.getElementById('link').select();
          showStatus('链接已生成，请手动复制');
        });
    })
    .catch(() => showStatus('生成失败'))
    .finally(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
    });
}

function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  } else {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    return new Promise((resolve, reject) => {
      try {
        document.execCommand('copy');
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        document.body.removeChild(textArea);
      }
    });
  }
}

function showStatus(msg) {
  document.getElementById('status').textContent = msg;
  setTimeout(() => document.getElementById('status').textContent = '', 2000);
}

// 自动保存
let timer;
document.getElementById('editor').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(save, 1000);
});

// 快捷键
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});
</script>
</body>
</html>`;
}