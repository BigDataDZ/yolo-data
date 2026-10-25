// GitHub Star 引导条：帮助中心首页顶部与文档页尾部复用。
// 注意：文档正文走 renderSafeMarkdown（不外链，且同一条渲染路径也用于模型回答
// 这类不可信内容），所以这类跳转入口必须由真实 DOM 提供，不要往渲染器里加链接能力。

export const GITHUB_REPO_URL = 'https://github.com/xiaour/yolo-data';

const STAR_PATH = '<path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/>';

function starIcon() {
  return `<span class="icon" aria-hidden="true"><svg viewBox="0 0 24 24">${STAR_PATH}</svg></span>`;
}

// variant='compact' 用于文档页尾部，间距更小。
export function starBannerMarkup(variant = '') {
  return `
    <section class="help-star-banner${variant ? ` is-${variant}` : ''}" aria-label="支持 YOLO Data">
      <span class="help-star-badge" aria-hidden="true">${starIcon()}</span>
      <p class="help-star-text">如果 YOLO Data 帮到了你，请在 GitHub 点个 Star，这对我们意义重大。</p>
      <a class="btn btn-primary help-star-btn" href="${GITHUB_REPO_URL}" target="_blank" rel="noopener noreferrer">
        ${starIcon()}<span>去点 Star</span>
      </a>
    </section>
  `;
}

export default starBannerMarkup;
