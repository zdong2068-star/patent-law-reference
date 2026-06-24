# 专利法规检索网站

这是一个无需后端的静态网站，可部署到 GitHub Pages、Cloudflare Pages、Netlify 或普通静态服务器。

## 本地预览

由于浏览器安全策略会限制直接打开本地 Markdown 文件，请通过任意静态服务器预览 `site` 目录，不要直接双击 `index.html`。

## 更新正文

法规正文均位于 `content` 目录：

- `patent-law.md`：专利法
- `implementation-rules.md`：专利法实施细则
- `examination-guidelines.md`：专利审查指南整合文本
- `manifest.json`：版本信息、开发者信息和文件配置

修改 Markdown 后重新部署即可，目录和搜索索引由浏览器自动生成，无需修改页面代码。

## 开发者信息

在 `content/manifest.json` 的 `developer` 字段中填写姓名、简介和公开联系方式。
