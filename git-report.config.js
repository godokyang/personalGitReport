/**
 * Personal Git Report 配置文件
 * 在这里自定义你的年度报告设置
 */

module.exports = {
  // 基本信息显示
  author: "你的名字",           // 显示在报告中的名字

  // 多账户支持（推荐使用 authors 代替 email）
  authors: [                   // 多个 Git 账户邮箱或用户名
    "your-email@example.com",
    "another-email@company.com"
  ],
  // email: "your-email@example.com", // 单账户模式（向后兼容）

  // 多仓库目录（可选）
  // 指定包含多个 Git 仓库的父目录，工具会自动扫描所有子仓库
  // repositoriesDir: "/Users/yourname/Projects",

  // 主题设置
  theme: "dark",               // 主题: 'light' | 'dark' | 'colorful'

  // 显示选项
  showPrivateRepos: false,     // 是否显示私有仓库
  excludeWeekends: true,       // 是否排除周末数据

  // 输出设置
  output: "./reports",         // 报告输出目录
  format: ["html", "json"],    // 输出格式: 'html' | 'json' | 'pdf'

  // 分析选项
  includeMerges: false,        // 是否包含合并提交
  excludePaths: [              // 排除的文件路径
    "node_modules",
    "*.min.js",
    "dist",
    "build",
    ".git"
  ],

  // 自定义时间范围（可选）
  // 注意：年份选择限制为最近三年
  dateRange: {
    from: "2023-01-01",       // 开始日期
    to: "2023-12-31"          // 结束日期
  },

  // 排除的提交信息模式
  exclude: {
    commits: [
      "Merge pull request",
      "Update dependencies",
      "fix typo"
    ]
  },

  // 自定义统计选项
  customStats: {
    countLines: true,          // 统计代码行数
    analyzeComplexity: false,   // 分析代码复杂度
    trackLearning: true        // 追踪学习进度
  }
};
