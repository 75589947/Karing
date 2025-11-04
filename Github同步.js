export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    
    const GITHUB_USERNAME = '75589947';
    const GITHUB_REPO = 'My-text';
    const GITHUB_BRANCH = 'main';
    
    // 首页
    if (pathname === '/' || pathname === '/index.html') {
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>GitHub实时文件代理</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 800px; margin: 50px auto; padding: 20px; }
            .cache-info { background: #fff3cd; padding: 15px; border-radius: 5px; margin: 10px 0; }
          </style>
        </head>
        <body>
          <h1>🔄 GitHub实时文件代理</h1>
          <div class="cache-info">
            <strong>强制绕过所有缓存，确保内容实时同步</strong>
          </div>
          <p><a href="/free.txt">查看 free.txt</a></p>
          <p><a href="/free.txt?force=true">强制刷新 free.txt</a></p>
        </body>
        </html>
      `, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // 处理文件请求
    if (pathname !== '/') {
      const filename = pathname.slice(1);
      const forceRefresh = url.searchParams.has('force');
      
      // 方法1: 使用GitHub API（推荐，无缓存）
      try {
        const apiUrl = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/contents/${filename}`;
        console.log('尝试API URL:', apiUrl);
        
        const apiResponse = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/vnd.github.v3.raw',
            'User-Agent': 'Cloudflare-Worker-GitHub-Proxy/1.0',
            'Cache-Control': 'no-cache'
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        });
        
        console.log('API响应状态:', apiResponse.status);
        
        if (apiResponse.status === 200) {
          const content = await apiResponse.text();
          console.log('API获取内容:', content.substring(0, 100));
          
          return new Response(content, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'Expires': '0',
              'X-Content-Source': 'github-api',
              'X-Content-Freshness': new Date().toISOString(),
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (apiError) {
        console.log('API错误:', apiError.message);
      }
      
      // 方法2: 使用原始URL但添加随机参数
      try {
        const cacheBuster = forceRefresh ? `?t=${Date.now()}` : `?nocache=${Math.random().toString(36).substring(7)}`;
        const rawUrl = `https://raw.githubusercontent.com/${GITHUB_USERNAME}/${GITHUB_REPO}/${GITHUB_BRANCH}/${filename}${cacheBuster}`;
        console.log('尝试原始URL:', rawUrl);
        
        const rawResponse = await fetch(rawUrl, {
          headers: {
            'User-Agent': 'Cloudflare-Worker-GitHub-Proxy/1.0',
            'Cache-Control': 'no-cache, max-age=0'
          },
          cf: {
            cacheTtl: 0,
            cacheEverything: false
          }
        });
        
        console.log('原始URL响应状态:', rawResponse.status);
        
        if (rawResponse.status === 200) {
          const content = await rawResponse.text();
          console.log('原始URL获取内容:', content.substring(0, 100));
          
          return new Response(content, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
              'Pragma': 'no-cache',
              'X-Content-Source': 'github-raw',
              'X-Content-Freshness': new Date().toISOString(),
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      } catch (rawError) {
        console.log('原始URL错误:', rawError.message);
      }
      
      return new Response(`文件未找到: ${filename}`, {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};