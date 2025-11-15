// ============= 我的文本库 =============
const TXT_FILE = 'notes.txt';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const token = url.searchParams.get('token');
    const ADMIN_UUID = env.ADMIN_UUID || 'admin';

    if (path === `/${ADMIN_UUID}` || path === '/' || path === '/index.html') {
      if (request.method === 'POST') {
        const body = await request.text();
        if (body.startsWith('token:')) {
          const token = body.slice(6) || Math.random().toString(36).substring(2, 10);
          await env.KV.put('SHARE_TOKEN', token);
          return new Response(token);
        }
        if (body.startsWith('github:')) {
          const data = JSON.parse(body.slice(7));
          try {
            const result = await handleGitHubAction(data, env);
            return new Response(JSON.stringify({...result, autoExpand: true}), {
              headers: { 'Content-Type': 'application/json' }
            });
          } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
          }
        }
        await env.KV.put(TXT_FILE, body);
        return new Response('OK');
      }
      
      const content = await env.KV.get(TXT_FILE) || '';
      const fileListHtml = await getFileListHtml(env);
      return new Response(renderMainPage(content, fileListHtml), {
        headers: { 'Content-Type': 'text/html;charset=utf-8' }
      });
    }

    if (path === '/s' && token) {
      const savedToken = await env.KV.get('SHARE_TOKEN');
      if (token === savedToken) {
        const content = await env.KV.get(TXT_FILE) || '';
        return new Response(content, { headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
      }
      return new Response('Invalid token', { status: 403 });
    }

    if (path !== '/' && path !== '/s' && path !== `/${ADMIN_UUID}`) {
      const filename = path.slice(1);
      const content = await getFileContent(filename, env);
      if (content) return content;
      return new Response('文件未找到: ' + filename, { status: 404 });
    }

    return new Response('Not found', { status: 404 });
  }
};

async function handleGitHubAction(data, env) {
  const { action, filename, content, sha } = data;
  const apiUrl = 'https://api.github.com/repos/75589947/My-text/contents/' + filename;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'Cloudflare-Worker',
    'Authorization': 'token ' + env.GITHUB_TOKEN
  };

  let method = 'PUT';
  let body = { message: (action === 'create' ? '创建' : '更新') + '文件: ' + filename };
  
  if (action === 'delete') {
    method = 'DELETE';
    body = { message: '删除文件: ' + filename, sha };
  } else {
    body.content = btoa(unescape(encodeURIComponent(content)));
    if (action === 'update') body.sha = sha;
  }

  const response = await fetch(apiUrl, { method, headers, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(action + '失败: ' + response.status);
  return await response.json();
}

async function getFileListHtml(env) {
  if (!env.GITHUB_TOKEN) return '';
  try {
    const apiUrl = 'https://api.github.com/repos/75589947/My-text/contents/';
    const response = await fetch(apiUrl, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Cloudflare-Worker',
        'Authorization': 'token ' + env.GITHUB_TOKEN
      }
    });
    
    if (response.status !== 200) return '';
    const files = await response.json();
    
    const filesWithTimes = await Promise.all(files.map(async file => {
      try {
        const commitsUrl = 'https://api.github.com/repos/75589947/My-text/commits?path=' + file.path + '&per_page=1';
        const commitsResponse = await fetch(commitsUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'Cloudflare-Worker',
            'Authorization': 'token ' + env.GITHUB_TOKEN,
          }
        });
        if (commitsResponse.status === 200) {
          const commits = await commitsResponse.json();
          if (commits.length > 0) file.lastModified = commits[0].commit.committer.date;
        }
      } catch (error) {
        console.log('获取文件提交信息失败: ' + file.name);
      }
      return file;
    }));

    const formatDate = (dateString) => {
      if (!dateString) return '未知时间';
      try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return '无效时间';
        return new Date(date.getTime() + 8 * 60 * 60 * 1000).toLocaleString('zh-CN', {
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        }).replace(/\//g, '-');
      } catch (e) {
        return '时间错误';
      }
    };

    let fileItems = '';
    filesWithTimes.forEach(file => {
      const fileSize = file.size ? (file.size / 1024).toFixed(1) + ' KB' : '-';
      const updateTime = file.type === 'dir' ? '文件夹' : formatDate(file.lastModified);
      const escapedName = file.name.replace(/'/g, "\\'").replace(/"/g, '\\"');
      
      fileItems += `<div class="file-item">
        <div class="file-main">
          <div class="file-icon">${file.type === 'dir' ? '📁' : '📄'}</div>
          <div class="file-info">
            <div class="file-name">${file.type === 'dir' ? '<strong>' + file.name + '</strong>' : '<a href="/' + file.name + '" target="_blank">' + file.name + '</a>'}</div>
            <div class="file-meta"><span class="file-size">${fileSize}</span><span class="file-time">${updateTime}</span></div>
          </div>
        </div>
        <div class="file-actions">${file.type === 'file' ? '<input type="checkbox" class="file-checkbox" data-filename="' + escapedName + '" data-sha="' + file.sha + '" onchange="updateSelection()">' : ''}</div>
      </div>`;
    });

    return `<div class="section">
      <div class="section-header" onclick="toggleSection('fileList')">
        <h3>📁 仓库列表 <span class="file-count">${filesWithTimes.length} 个文件</span></h3>
        <span class="toggle-icon">▼</span>
      </div>
      <div class="section-content" id="fileList">
        <div class="file-grid">${fileItems}</div>
        <div class="file-management-section">
          <div class="file-management-controls">
            <button class="btn primary create-btn" onclick="createFile()">➕ 创建新文件</button>
            <button class="btn success edit-btn" onclick="editSelectedFile()" disabled>✏️ 修改选中文件</button>
            <button class="btn danger delete-btn" onclick="deleteSelectedFiles()" disabled>🗑️ 删除选中文件</button>
          </div>
          <div class="selection-info" id="selectionInfo">未选择任何文件</div>
        </div>
      </div>
    </div>`;
  } catch (error) {
    console.log('GitHub文件列表获取失败: ' + error.message);
    return '';
  }
}

async function getFileContent(filename, env) {
  const methods = [
    { url: 'https://api.github.com/repos/75589947/My-text/contents/' + filename, headers: { 'Accept': 'application/vnd.github.v3.raw' } },
    { url: 'https://raw.githubusercontent.com/75589947/My-text/main/' + filename + '?nocache=' + Math.random().toString(36).substring(7) }
  ];

  for (const method of methods) {
    try {
      const response = await fetch(method.url, {
        headers: {
          'User-Agent': 'Cloudflare-Worker',
          'Authorization': 'token ' + env.GITHUB_TOKEN,
          ...method.headers
        }
      });
      if (response.status === 200) {
        const content = await response.text();
        return new Response(content, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache'
          }
        });
      }
    } catch (error) {
      console.log('文件获取失败: ' + method.url);
    }
  }
  return null;
}

function renderMainPage(content, fileListHtml) {
  const escapedContent = content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>我的文本库</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#f8fafc;padding:6px}
.container{max-width:980px;margin:0 auto;background:white;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.08);border:1px solid #e2e8f0}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;padding:16px;text-align:center;border-radius:12px 12px 0 0}
.header h1{margin:0;font-size:1.8em;font-weight:700}
.section{border-bottom:1px solid #e2e8f0}
.section:last-child{border-bottom:none}
.section-header{padding:10px 12px;cursor:pointer;display:flex;justify-content:space-between;align-items:center}
.section-header:hover{background:#f8fafc}
.section-header h3{margin:0;color:#2d3748;font-size:0.95em;display:flex;align-items:center;gap:6px}
.toggle-icon{color:#718096;font-size:0.75em;transition:transform 0.3s}
.section-content{padding:0 12px;max-height:0;overflow:hidden;transition:all 0.3s}
.section-content.expanded{padding:12px;max-height:1000px}
.file-count{font-size:0.7em;color:#718096;background:#edf2f7;padding:2px 6px;border-radius:10px;margin-left:6px}
.file-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.file-item{background:#f7fafc;padding:8px;border-radius:8px;border:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:flex-start}
.file-item:hover{background:#edf2f7;border-color:#cbd5e0}
.file-main,.file-actions{display:flex;align-items:center}
.file-main{flex:1;gap:4px}
.file-actions{gap:8px;flex-shrink:0}
.file-icon{font-size:1.1em;margin-right:6px}
.file-name{margin-bottom:3px}
.file-name a{text-decoration:none;color:#4a90e2;font-weight:500;font-size:0.85em}
.file-name a:hover{color:#2b6cb0;text-decoration:underline}
.file-meta{font-size:0.7em;color:#718096;display:flex;gap:6px;align-items:center}
.file-size{background:#e2e8f0;padding:1px 4px;border-radius:4px;font-size:0.65em}
.file-time{font-size:0.65em;color:#888;white-space:nowrap}
.file-checkbox{width:16px;height:16px;cursor:pointer}
.file-management-section{margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0}
.file-management-controls{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.file-management-controls .btn{flex:1;min-width:120px;justify-content:center}
.selection-info{text-align:center;font-size:0.75em;color:#718096;margin-top:8px}
.editor-container{padding:10px 12px}
.editor-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.editor{width:100%;height:160px;border:2px solid #e2e8f0;padding:10px;font-size:13px;resize:vertical;outline:none;font-family:monospace;border-radius:8px;background:#fafbfc}
.editor:focus{border-color:#4a90e2;background:white}
.status{color:#718096;font-size:12px;margin-left:auto}
.share-section{background:#f8fafc;padding:10px;border-radius:8px;margin-top:8px;border:1px solid #e2e8f0}
.share-controls{display:flex;gap:8px;align-items:center;flex-wrap:nowrap}
.share-input{display:flex;gap:6px;align-items:center;flex:1;min-width:0}
.share-input input{flex:1;padding:6px 10px;border:2px solid #e2e8f0;border-radius:6px;font-size:12px;min-width:120px}
.share-input input:focus{border-color:#4a90e2;outline:none}
.action-buttons{display:flex;gap:6px;align-items:center;flex-shrink:0}
.btn{padding:6px 10px;border:2px solid;background:white;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:3px;white-space:nowrap}
.btn:hover{transform:translateY(-1px)}
.btn.primary{border-color:#4a90e2;color:#4a90e2}
.btn.primary:hover{background:#4a90e2;color:white}
.btn.success{border-color:#38a169;color:#38a169}
.btn.success:hover{background:#38a169;color:white}
.btn.danger{border-color:#e53e3e;color:#e53e3e}
.btn.danger:hover{background:#e53e3e;color:white}
.btn:disabled{opacity:0.5;cursor:not-allowed;transform:none}
.btn:disabled:hover{background:white;color:inherit}
.link-box{margin-top:8px;display:none}
.link-box input{width:100%;padding:6px 10px;border:2px solid #e2e8f0;border-radius:6px;font-size:12px;background:#f7fafc}
.modal{display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center}
.modal-content{background:white;padding:20px;border-radius:12px;width:90%;max-width:500px;max-height:80vh;overflow:auto}
.modal-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:15px}
.modal-close{background:none;border:none;font-size:1.2em;cursor:pointer}
.modal-body{display:flex;flex-direction:column;gap:10px}
.modal-input,.modal-textarea{width:100%;padding:8px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:14px}
.modal-input:focus,.modal-textarea:focus{border-color:#4a90e2;outline:none}
.modal-textarea{height:200px;resize:vertical;font-family:monospace}
.modal-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:15px}
@media (max-width:768px){
  .file-grid{grid-template-columns:1fr}
  .file-management-controls{flex-direction:row;gap:6px}
  .file-management-controls .btn{min-width:0;flex:1;font-size:10px;padding:4px 6px}
}
@media (max-width:480px){
  .file-management-controls .btn{font-size:9px;padding:3px 4px}
}
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>我的文本库</h1>
  </div>
  ${fileListHtml || `<div class="section">
    <div class="section-header" onclick="toggleSection('fileList')">
      <h3>📁 仓库文件列表</h3>
      <span class="toggle-icon">▼</span>
    </div>
    <div class="section-content" id="fileList">
      <div style="text-align:center;color:#718096;padding:20px 15px;">GitHub文件列表加载中...</div>
    </div>
  </div>`}
  <div class="section">
    <div class="section-header" onclick="toggleSection('notepad')">
      <h3>📝 在线记事本</h3>
      <span class="toggle-icon">▼</span>
    </div>
    <div class="section-content expanded" id="notepad">
      <div class="editor-container">
        <div class="editor-header">
          <h3 class="editor-title">文本编辑器</h3>
          <div class="status" id="status">就绪</div>
        </div>
        <textarea class="editor" id="editor" placeholder="开始编辑...支持自动保存和快捷键操作">${escapedContent}</textarea>
        <div class="share-section">
          <div class="share-controls">
            <div class="share-input">
              <input type="text" id="tokenInput" placeholder="分享密码（可选）">
              <button class="btn primary" onclick="generateLink()">🔗 生成链接</button>
            </div>
            <div class="action-buttons">
              <button class="btn success" onclick="copyEditorContent()">📋 复制内容</button>
            </div>
          </div>
          <div class="link-box" id="linkBox">
            <input type="text" id="link" readonly placeholder="分享链接将在这里显示...">
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
<div class="modal" id="fileModal">
  <div class="modal-content">
    <div class="modal-header">
      <h3 class="modal-title" id="modalTitle">编辑文件</h3>
      <button class="modal-close" onclick="closeModal()">×</button>
    </div>
    <div class="modal-body">
      <input type="text" class="modal-input" id="fileName" placeholder="文件名">
      <textarea class="modal-textarea" id="fileContent" placeholder="文件内容"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn danger" onclick="closeModal()">取消</button>
      <button class="btn primary" id="modalActionBtn" onclick="handleFileAction()">保存</button>
    </div>
  </div>
</div>
<script>
let currentAction = '', currentSha = '';
let selectedFiles = new Map();

function toggleSection(sectionId) {
  const section = document.getElementById(sectionId);
  const icon = section.previousElementSibling.querySelector('.toggle-icon');
  if (section.classList.contains('expanded')) {
    section.classList.remove('expanded');
    icon.style.transform = 'rotate(0deg)';
  } else {
    section.classList.add('expanded');
    icon.style.transform = 'rotate(180deg)';
  }
}
document.addEventListener('DOMContentLoaded', function() {
  const notepadSection = document.getElementById('notepad');
  const notepadIcon = notepadSection.previousElementSibling.querySelector('.toggle-icon');
  notepadSection.classList.add('expanded');
  notepadIcon.style.transform = 'rotate(180deg)';
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('expand') === 'fileList') {
    toggleSection('fileList');
    const url = new URL(window.location);
    url.searchParams.delete('expand');
    window.history.replaceState({}, '', url);
  }
});

function updateSelection() {
  selectedFiles.clear();
  const checkboxes = document.querySelectorAll('.file-checkbox:checked');
  checkboxes.forEach(checkbox => selectedFiles.set(checkbox.dataset.filename, checkbox.dataset.sha));
  
  const editBtn = document.querySelector('.edit-btn');
  const deleteBtn = document.querySelector('.delete-btn');
  const selectionInfo = document.getElementById('selectionInfo');
  
  if (checkboxes.length === 0) {
    editBtn.disabled = deleteBtn.disabled = true;
    selectionInfo.textContent = '未选择任何文件';
  } else if (checkboxes.length === 1) {
    editBtn.disabled = deleteBtn.disabled = false;
    selectionInfo.textContent = '已选择 1 个文件: ' + checkboxes[0].dataset.filename;
  } else {
    editBtn.disabled = true;
    deleteBtn.disabled = false;
    selectionInfo.textContent = '已选择 ' + checkboxes.length + ' 个文件';
  }
}

function editSelectedFile() {
  if (selectedFiles.size !== 1) return showStatus('请选择且仅选择一个文件进行编辑');
  const [[filename, sha]] = selectedFiles.entries();
  fetch('/' + filename).then(r => r.text()).then(content => {
    document.getElementById('fileName').value = filename;
    document.getElementById('fileContent').value = content;
    document.getElementById('modalTitle').textContent = '编辑文件';
    document.getElementById('modalActionBtn').textContent = '更新文件';
    currentAction = 'update';
    currentSha = sha;
    document.getElementById('fileModal').style.display = 'flex';
  }).catch(() => showStatus('获取文件内容失败'));
}

async function deleteSelectedFiles() {
  if (selectedFiles.size === 0) return showStatus('请选择要删除的文件');
  const fileList = Array.from(selectedFiles.keys()).join(', ');
  if (!confirm('确定要删除以下 ' + selectedFiles.size + ' 个文件吗？此操作将同步到GitHub仓库。\\n\\n' + fileList)) return;
  
  const deleteBtn = document.querySelector('.delete-btn');
  const originalText = deleteBtn.innerHTML;
  deleteBtn.disabled = true;
  deleteBtn.innerHTML = '⏳ 删除中...';
  
  try {
    let successCount = 0;
    for (const [filename, sha] of selectedFiles.entries()) {
      try {
        showStatus('正在删除: ' + filename);
        const response = await fetch('', { method: 'POST', body: 'github:' + JSON.stringify({ action: 'delete', filename, sha }) });
        const result = await response.json();
        if (!result.error) successCount++;
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error('删除文件时出错:', filename, error);
      }
    }
    showStatus(successCount === selectedFiles.size ? '成功删除 ' + successCount + ' 个文件' : '成功删除 ' + successCount + ' 个文件，失败 ' + (selectedFiles.size - successCount) + ' 个');
    reloadWithExpand();
  } catch (error) {
    showStatus('删除过程中出错: ' + error.message);
  } finally {
    deleteBtn.disabled = false;
    deleteBtn.innerHTML = originalText;
  }
}

function copyEditorContent() {
  const content = document.getElementById('editor').value;
  if (!content.trim()) return showStatus('编辑器内容为空');
  const btn = event.target.closest('.btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ 复制中...';
  copyToClipboard(content).then(() => showStatus('内容已复制到剪贴板'))
    .catch(() => {
      document.getElementById('editor').select();
      try { document.execCommand('copy'); showStatus('内容已复制到剪贴板'); }
      catch (err) { showStatus('复制失败，请手动复制'); }
    }).finally(() => { btn.disabled = false; btn.innerHTML = originalText; });
}
function copyToClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  return new Promise((resolve, reject) => {
    try { document.execCommand('copy'); resolve(); }
    catch (err) { reject(err); }
    finally { document.body.removeChild(textArea); }
  });
}
function generateLink() {
  const userToken = document.getElementById('tokenInput').value;
  const btn = event.target.closest('.btn');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ 生成中...';
  fetch('', { method: 'POST', body: 'token:' + userToken })
    .then(response => response.text())
    .then(token => {
      const link = location.origin + '/s?token=' + token;
      document.getElementById('linkBox').style.display = 'block';
      document.getElementById('link').value = link;
      copyToClipboard(link).then(() => showStatus('分享链接已复制到剪贴板'))
        .catch(() => { document.getElementById('link').select(); showStatus('链接已生成，请手动复制'); });
    }).catch(() => showStatus('生成失败，请重试'))
    .finally(() => { btn.disabled = false; btn.innerHTML = originalText; });
}
function showStatus(msg) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = msg;
  setTimeout(() => statusEl.textContent = '就绪', 3000);
}
let timer;
document.getElementById('editor').addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const content = document.getElementById('editor').value;
    fetch('', { method: 'POST', body: content })
      .then(() => showStatus('已自动保存'))
      .catch(() => showStatus('自动保存失败'));
  }, 1000);
});
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    showStatus('已自动保存');
  }
});
function createFile() {
  document.getElementById('fileName').value = '';
  document.getElementById('fileContent').value = '';
  document.getElementById('modalTitle').textContent = '创建新文件';
  document.getElementById('modalActionBtn').textContent = '创建文件';
  currentAction = 'create';
  currentSha = '';
  document.getElementById('fileModal').style.display = 'flex';
}
function closeModal() {
  document.getElementById('fileModal').style.display = 'none';
}
function handleFileAction() {
  const filename = document.getElementById('fileName').value.trim();
  const content = document.getElementById('fileContent').value;
  if (!filename) return alert('请输入文件名');
  showStatus('处理中...');
  const data = { action: currentAction, filename, content };
  if (currentAction === 'update') data.sha = currentSha;
  fetch('', { method: 'POST', body: 'github:' + JSON.stringify(data) })
    .then(response => response.json())
    .then(result => {
      if (result.error) showStatus('操作失败: ' + result.error);
      else { showStatus(currentAction === 'create' ? '文件创建成功' : '文件更新成功'); closeModal(); reloadWithExpand(); }
    }).catch(() => showStatus('操作失败'));
}
function reloadWithExpand() {
  const url = new URL(window.location);
  url.searchParams.set('expand', 'fileList');
  window.location.href = url.toString();
}
document.getElementById('fileModal').addEventListener('click', function(e) {
  if (e.target === this) closeModal();
});
</script>
</body>
</html>`;
}