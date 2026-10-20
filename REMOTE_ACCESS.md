# 手机远程访问

最简单的手机 App 体验方式：双击 `Start-NextHome-Mobile.cmd`。
添加 iPhone 主屏幕和查看更新的步骤见 [IPHONE_APP.md](./IPHONE_APP.md)。

NextHome 可以通过 Cloudflare Tunnel 把手机的 HTTPS 请求转发到电脑上的
`127.0.0.1:3000`。房源、账号、会话和 AI 需求画像仍写入
`.local/nexthome.sqlite`，不会因为使用隧道而上传到 GitHub。

## 安全结构

远程模式包含两层登录：

1. 隧道入口的独立远程访问用户名和密码；
2. NextHome 网站自己的买卖账号登录。

远程访问密码只通过环境变量传入，不能写进源码、配置文件或 Git 提交。
本地 `http://127.0.0.1:3000` 不要求第一层密码。

## 启动 NextHome

PowerShell 示例：

```powershell
$env:NEXTHOME_REMOTE_USER = 'nexthome'
$env:NEXTHOME_REMOTE_PASSWORD = '<至少 16 位的随机密码>'
npm run dev:remote -- --victor-ai
```

服务器仍然只监听回环地址，路由器和 Windows 防火墙不需要开放入站端口。

## 临时手机测试

安装 `cloudflared` 后运行：

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

手机打开输出的 `https://*.trycloudflare.com` 地址，先输入远程访问账号，再登录
NextHome。临时地址会在隧道重启后变化，只适合演示和测试。

## 长期使用

正式使用时应在 Cloudflare 控制台创建命名 Tunnel，把自己的域名（例如
`home.example.com`）指向 `http://127.0.0.1:3000`，并把 `cloudflared` 安装为
Windows 服务。电脑必须保持开机、联网，NextHome 服务也必须持续运行。

