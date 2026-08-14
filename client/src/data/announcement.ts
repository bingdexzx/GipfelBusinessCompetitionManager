/**
 * 更新公告数据源（历史化）。
 *
 * 设计：
 *  - `announcements` 为按版本倒序的数组（最新在前）。每次发版：在数组【最前面】插入一条新公告，
 *    旧版本保留于此，以便「系统设置 - 关于 - 查看更新记录」中查看历史更新记录。
 *  - `currentAnnouncement` 指向数组首条（最新），作为客户端「是否已读」锚点：
 *    用户首次打开某版本时自动弹出；点击「不再显示」后标记已读，下次启动不再弹，
 *    直到出现更高版本（新公告）才再次弹出。
 *  - content 通过 v-html 渲染，仅由开发者维护、属于受信任内容，
 *    切勿渲染任何来自用户或服务端不可信的 HTML，避免 XSS。
 */
export interface Announcement {
  /** 公告版本号，作为"是否已读"的锚点。发版须随变更递增。 */
  version: string;
  /** 弹窗标题 */
  title: string;
  /** 发布日期（展示用，YYYY-MM-DD） */
  date: string;
  /** 公告正文，支持受信任的 HTML 片段（v-html 渲染）。 */
  content: string;
}

export const announcements: Announcement[] = [
  {
    version: "1.0.0",
    title: "更新公告",
    date: "2026-08-14",
    content: `
      <p>欢迎使用 Gipfel 商赛系统！近期更新已包含以下改进：</p>
      <ul>
        <li>服务器地址支持手动选择协议（<b>http / https</b>），可正常连接到启用 HTTPS 的服务器（如 frp 内网穿透地址）。</li>
        <li>修复使用自签名证书（如 SakuraFrp 自动 TLS）时无法建立连接的问题。</li>
        <li>修复「系统设置 - 测试连接」误报"连接正常"的问题，现改用真实健康检查端点。</li>
        <li>新增「版本更新提示」：当服务端版本高于本机安装版本时，提示联系管理员获取最新安装包。</li>
      </ul>
      <p>点击「不再显示」后本次公告不再自动弹出；若想再次查看历史更新记录，可在「系统设置 - 关于」中点击「查看更新记录」。</p>
      <p>如使用过程中遇到问题，请联系赛事技术支持。</p>
    `,
  },
];

/** 当前（最新）公告：首启自动弹出与「已读」锚点的依据。 */
export const currentAnnouncement: Announcement = announcements[0];
