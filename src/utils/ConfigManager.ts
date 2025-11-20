/**
 * 配置管理器
 * 负责管理用户配置和默认设置
 */

import * as fs from 'fs-extra';
import * as path from 'path';

export interface GitReportConfig {
  // 基本信息
  author?: string;
  email?: string; // 向后兼容，建议使用 authors
  authors?: string[]; // 多账户支持（邮箱或用户名）

  // 仓库配置
  repositoriesDir?: string; // 多仓库目录，自动扫描该目录下的所有 Git 仓库

  // 主题设置
  theme: 'light' | 'dark' | 'colorful';

  // 显示选项
  showPrivateRepos: boolean;
  excludeWeekends: boolean;

  // 输出设置
  output: string;
  format: Array<'html' | 'json' | 'pdf'>;

  // 分析选项
  includeMerges: boolean;
  excludePaths: string[];

  // 自定义时间范围
  dateRange?: {
    from: string;
    to: string;
  };

  // 排除规则
  exclude?: {
    commits: string[];
  };

  // 自定义统计
  customStats: {
    countLines: boolean;
    analyzeComplexity: boolean;
    trackLearning: boolean;
  };
}

/**
 * 配置管理器类
 */
export class ConfigManager {
  private static readonly DEFAULT_CONFIG: GitReportConfig = {
    theme: 'dark',
    showPrivateRepos: false,
    excludeWeekends: true,
    output: './reports',
    format: ['html'],
    includeMerges: false,
    excludePaths: ['node_modules', '*.min.js', 'dist', 'build'],
    customStats: {
      countLines: true,
      analyzeComplexity: false,
      trackLearning: true,
    },
  };

  private static readonly CONFIG_FILE_NAMES = [
    'git-report.config.js',
    'git-report.config.json',
    '.git-report.json',
  ];

  /**
   * 加载配置文件
   */
  static async loadConfig(configPath?: string): Promise<GitReportConfig> {
    // 如果指定了配置路径，优先使用
    if (configPath) {
      if (await fs.pathExists(configPath)) {
        return this.loadConfigFile(configPath);
      } else {
        console.warn(`⚠️ 配置文件不存在: ${configPath}`);
      }
    }

    // 尝试查找默认配置文件
    for (const filename of this.CONFIG_FILE_NAMES) {
      const fullPath = path.resolve(process.cwd(), filename);
      if (await fs.pathExists(fullPath)) {
        console.log(`📝 找到配置文件: ${filename}`);
        return this.loadConfigFile(fullPath);
      }
    }

    // 没有找到配置文件，使用默认配置
    console.log('📝 使用默认配置');
    return { ...this.DEFAULT_CONFIG };
  }

  /**
   * 加载指定路径的配置文件
   */
  private static async loadConfigFile(filePath: string): Promise<GitReportConfig> {
    try {
      const ext = path.extname(filePath);

      if (ext === '.js') {
        // 动态导入JS配置文件
        delete require.cache[require.resolve(filePath)];
        const config = require(filePath);
        return this.mergeWithDefaults(config.default || config);
      } else if (ext === '.json') {
        const content = await fs.readFile(filePath, 'utf8');
        const config = JSON.parse(content);
        return this.mergeWithDefaults(config);
      } else {
        throw new Error(`不支持的配置文件格式: ${ext}`);
      }
    } catch (error) {
      console.error(`❌ 加载配置文件失败: ${filePath}`, error);
      return { ...this.DEFAULT_CONFIG };
    }
  }

  /**
   * 合并用户配置与默认配置
   */
  private static mergeWithDefaults(userConfig: Partial<GitReportConfig>): GitReportConfig {
    // 处理 email 到 authors 的自动转换（向后兼容）
    let authors = userConfig.authors || [];
    if (userConfig.email && !userConfig.authors) {
      authors = [userConfig.email];
    }

    return {
      ...this.DEFAULT_CONFIG,
      ...userConfig,
      authors: authors.length > 0 ? authors : undefined,
      customStats: {
        ...this.DEFAULT_CONFIG.customStats,
        ...(userConfig.customStats || {}),
      },
    };
  }

  /**
   * 创建示例配置文件
   */
  static async createSampleConfig(outputPath: string = './git-report.config.js'): Promise<void> {
    const sampleConfig = `/**
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
`;

    await fs.writeFile(outputPath, sampleConfig, 'utf8');
    console.log(`✅ 示例配置文件已创建: ${outputPath}`);
  }

  /**
   * 验证配置有效性
   */
  static validateConfig(config: GitReportConfig): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证主题
    if (!['light', 'dark', 'colorful'].includes(config.theme)) {
      errors.push(`无效的主题: ${config.theme}`);
    }

    // 验证输出格式
    const validFormats = ['html', 'json', 'pdf'];
    for (const format of config.format) {
      if (!validFormats.includes(format)) {
        errors.push(`无效的输出格式: ${format}`);
      }
    }

    // 验证输出路径
    if (!config.output || typeof config.output !== 'string') {
      errors.push('输出路径无效');
    }

    // 验证排除路径
    if (!Array.isArray(config.excludePaths)) {
      errors.push('排除路径必须是数组');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 获取当前工作目录下的Git仓库路径
   * @param currentPath 要扫描的目录路径
   * @param recursive 是否递归扫描子目录（默认为 true）
   * @param maxDepth 最大扫描深度（默认为 3）
   */
  static getRepositoryPaths(
    currentPath: string = process.cwd(),
    recursive: boolean = true,
    maxDepth: number = 3
  ): string[] {
    const paths: string[] = [];

    const scanDirectory = (dirPath: string, depth: number = 0) => {
      // 检查当前目录是否是Git仓库
      const gitPath = path.join(dirPath, '.git');
      if (fs.existsSync(gitPath)) {
        paths.push(dirPath);
        return; // 找到仓库后不再扫描其子目录
      }

      // 如果不递归或达到最大深度，停止扫描
      if (!recursive || depth >= maxDepth) {
        return;
      }

      // 扫描子目录
      try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
          // 跳过隐藏目录和 node_modules
          if (item.startsWith('.') || item === 'node_modules') {
            continue;
          }

          const itemPath = path.join(dirPath, item);
          try {
            const stat = fs.statSync(itemPath);
            if (stat.isDirectory()) {
              scanDirectory(itemPath, depth + 1);
            }
          } catch (error) {
            // 忽略无法访问的目录
          }
        }
      } catch (error) {
        // 忽略读取错误
      }
    };

    scanDirectory(currentPath);
    return paths;
  }

  /**
   * 获取可用的年份列表（最近三年）
   */
  static getAvailableYears(): number[] {
    const currentYear = new Date().getFullYear();
    return [currentYear, currentYear - 1, currentYear - 2];
  }

  /**
   * 解析年份参数（限制为最近三年）
   */
  static parseYear(yearParam?: string | number): number {
    const currentYear = new Date().getFullYear();
    const availableYears = this.getAvailableYears();

    if (!yearParam) {
      return currentYear;
    }

    const year = typeof yearParam === 'string' ? parseInt(yearParam, 10) : yearParam;

    if (isNaN(year)) {
      console.warn(`⚠️ 无效的年份: ${yearParam}，使用当前年份`);
      return currentYear;
    }

    // 检查是否在最近三年范围内
    if (!availableYears.includes(year)) {
      console.warn(
        `⚠️ 年份 ${year} 超出范围，只支持最近三年: ${availableYears.join(', ')}，使用当前年份`
      );
      return currentYear;
    }

    return year;
  }
}