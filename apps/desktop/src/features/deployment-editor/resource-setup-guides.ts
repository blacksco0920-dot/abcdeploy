export interface ResourceSetupGuideLink {
  label: string;
  url: string;
}

export interface ResourceSetupGuideContent {
  description: string;
  links: ResourceSetupGuideLink[];
  steps: string[];
  summary: string;
  title: string;
}

export const SERVER_RESOURCE_GUIDE: ResourceSetupGuideContent = {
  summary: "还没有服务器？查看准备方法",
  title: "准备一台 Linux 服务器",
  description: "购买时不需要安装面板，保留系统默认的 SSH 登录方式即可。",
  steps: [
    "选择 Ubuntu 22.04 或 24.04，并取得公网 IP、登录用户和密码。",
    "在服务器防火墙中放行 22、80、443 端口。",
    "回到这里填写公网 IP；ABCDeploy 会自动准备 Docker、Caddy 和专用登录密钥。",
  ],
  links: [
    {
      label: "查看购买服务器说明",
      url: "https://cloud.tencent.com/document/product/1207/44580",
    },
    {
      label: "查看防火墙说明",
      url: "https://cloud.tencent.com/document/product/1207/44577/",
    },
  ],
};

export const CNB_RESOURCE_GUIDE: ResourceSetupGuideContent = {
  summary: "还没有 CNB？查看准备方法",
  title: "创建 CNB 账号和访问令牌",
  description: "CNB 用来接收项目代码并自动生成可运行版本。",
  steps: [
    "注册并登录 CNB，在个人设置中新增访问令牌。",
    "令牌需要允许管理仓库和触发构建；用户名固定填写 cnb。",
    "回到这里粘贴令牌，私有代码仓库由 ABCDeploy 自动创建。",
  ],
  links: [
    {
      label: "查看 CNB 令牌说明",
      url: "https://docs.cnb.cool/zh/guide/access-token.html",
    },
  ],
};

export const TCR_RESOURCE_GUIDE: ResourceSetupGuideContent = {
  summary: "还没有版本仓库？查看准备方法",
  title: "开通腾讯云 TCR 个人版",
  description: "版本仓库用来安全保存每次上线生成的服务镜像。",
  steps: [
    "在腾讯云开通容器镜像服务个人版。",
    "创建一个命名空间，推荐名称 abcdeploy。",
    "复制个人版登录用户名和密码，回到这里完成连接。",
  ],
  links: [
    {
      label: "查看 TCR 开通说明",
      url: "https://cloud.tencent.com/document/product/1141/57780",
    },
    {
      label: "打开 TCR 控制台",
      url: "https://console.cloud.tencent.com/tcr",
    },
  ],
};

export function domainResourceGuide(
  requiresRegisteredDomain: boolean,
): ResourceSetupGuideContent {
  return {
    summary: "还没有域名？查看准备方法",
    title: requiresRegisteredDomain ? "准备已备案域名" : "准备项目访问地址",
    description: requiresRegisteredDomain
      ? "当前服务器无法使用临时地址，需要先准备已备案域名。"
      : "可以先使用系统生成的临时地址；需要正式域名时再按下面步骤准备。",
    steps: [
      "注册域名；使用中国大陆服务器公开访问时，通常还需要完成 ICP 备案。",
      "在 DNS 控制台为每个项目服务添加 A 记录，记录值填写服务器公网 IP。",
      "回到这里填写完整域名，系统会配置 Caddy 并自动申请 HTTPS 证书。",
    ],
    links: [
      {
        label: "查看域名注册说明",
        url: "https://cloud.tencent.com/document/product/242/9595",
      },
      {
        label: "查看备案说明",
        url: "https://cloud.tencent.com/document/product/243/39038",
      },
      {
        label: "查看域名解析说明",
        url: "https://cloud.tencent.com/document/product/302/3449",
      },
    ],
  };
}
