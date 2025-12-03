/**
 * Git数据分析器
 * 负责从Git仓库中提取和分析代码数据
 */

import simpleGit, { SimpleGit, LogOptions } from 'simple-git';
import * as fs from 'fs-extra';
import * as path from 'path';
import moment from 'moment';

// 导出接口定义
export interface GitCommit {
  hash: string;
  date: Date;
  message: string;
  author: string;
  email: string;
  files: string[];
  insertions: number;
  deletions: number;
  language?: string;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  progress?: string;
}

export interface GitAnalysisResult {
  totalCommits: number;
  totalInsertions: number;
  totalDeletions: number;
  netLines: number;
  languageStats: Map<string, { count: number; percentage: number }>;
  timeStats: {
    byHour: Map<number, number>;
    byDayOfWeek: Map<number, number>;
    byMonth: Map<string, number>;
  };
  streakStats: {
    longestStreak: number;
    currentStreak: number;
    totalActiveDays: number;
  };
  projectStats: Array<{
    path: string;
    name: string;
    commits: number;
    lines: number;
  }>;
  // New Metrics
  commitTrends: {
    monthly: { date: string; count: number }[];
    daily: { date: string; count: number }[];
  };
  punchCard: number[][]; // 7 days x 24 hours
  topKeywords: { word: string; count: number }[];
  achievements: Achievement[];
  persona: { title: string; description: string };
}

export interface GitAnalyzerOptions {
  repositoryPath: string;
  since?: string;
  until?: string;
  author?: string; // 向后兼容，建议使用 authors
  authors?: string[]; // 多账户支持（邮箱或用户名）
  includeMerges?: boolean;
  excludePaths?: string[];
}

/**
 * Git数据分析器类
 */
export class GitAnalyzer {
  private git: SimpleGit;
  private options: GitAnalyzerOptions;

  constructor(options: GitAnalyzerOptions) {
    // 处理 author 到 authors 的自动转换（向后兼容）
    let authors = options.authors || [];
    if (options.author && !options.authors) {
      authors = [options.author];
    }

    this.options = {
      includeMerges: false,
      excludePaths: [],
      ...options,
      authors: authors.length > 0 ? authors : undefined,
    };
    this.git = simpleGit(options.repositoryPath);
  }

  /**
   * 执行完整的Git数据分析
   */
  async analyze(): Promise<GitAnalysisResult> {
    console.log('🔍 开始分析Git仓库...');

    // 获取提交历史
    const commits = await this.getCommits();
    console.log(`📝 找到 ${commits.length} 个提交记录`);

    // 基础统计
    const timeStats = this.analyzeTimePatterns(commits);
    const streakStats = this.analyzeStreaks(commits);
    const projectStats = await this.analyzeProjects(commits);
    const totalInsertions = commits.reduce((sum, commit) => sum + commit.insertions, 0);
    const totalDeletions = commits.reduce((sum, commit) => sum + commit.deletions, 0);

    // 分析数据
    const result: GitAnalysisResult = {
      totalCommits: commits.length,
      totalInsertions,
      totalDeletions,
      netLines: totalInsertions - totalDeletions,
      languageStats: this.analyzeLanguages(commits),
      timeStats,
      streakStats,
      projectStats,
      // New Metrics
      commitTrends: this.analyzeTrends(commits),
      punchCard: this.analyzePunchCard(commits),
      topKeywords: this.analyzeKeywords(commits),
      achievements: [], // 先初始化为空，下面计算
      persona: { title: '', description: '' }, // 初始化
    };

    // 计算成就
    result.achievements = this.calculateAchievements(result, commits);
    // 计算画像
    result.persona = this.calculatePersona(result);

    console.log('✅ Git数据分析完成！');
    return result;
  }

  /**
   * 获取Git提交历史
   * 优化：使用 --numstat 一次性获取所有统计信息，避免 N+1 查询
   */
  private async getCommits(): Promise<GitCommit[]> {
    const options: any = {
      '--numstat': null,
      '--format': '%H%n%aI%n%s%n%aN%n%aE', // hash, date(ISO), subject, author name, author email
    };

    // 日期范围过滤 (Git原生支持) - 添加时间部分确保正确解析
    if (this.options.since) {
      options['--since'] = `${this.options.since} 00:00:00`;
    }
    if (this.options.until) {
      options['--until'] = `${this.options.until} 23:59:59`;
    }

    // 排除合并提交
    if (!this.options.includeMerges) {
      options['--no-merges'] = null;
    }

    try {
      // 获取原始日志输出 - 直接传递options而不是调用buildLogArgs
      const args = Object.entries(options).flatMap(([key, value]) => {
        if (value === null) {
          return [key];
        } else {
          return [`${key}=${value}`];
        }
      });

      // 添加作者筛选参数
      if (this.options.authors && this.options.authors.length > 0) {
        this.options.authors.forEach(author => {
          args.push(`--author=${author}`);
        });
      }

                const logOutput = await this.git.raw(['log', ...args]);
      return this.parseRawLog(logOutput);
    } catch (error) {
      console.error('获取Git日志失败:', error);
      return [];
    }
  }

  /**
   * 构建 git log 参数
   */
  private buildLogArgs(options: any): string[] {
    const args: string[] = [];

    // 处理多作者筛选 - 为每个作者添加单独的 --author 参数
    if (this.options.authors && this.options.authors.length > 0) {
      this.options.authors.forEach(author => {
        args.push(`--author=${author}`);
      });
    }

    // 处理其他参数
    for (const [key, value] of Object.entries(options)) {
      if (value === null) {
        args.push(key);
      } else {
        args.push(`${key}=${value}`);
      }
    }
    return args;
  }

  /**
   * 解析原始 git log --numstat 输出
   */
  private parseRawLog(rawLog: string): GitCommit[] {
    const commits: GitCommit[] = [];
    const lines = rawLog.split('\n');

    let currentCommit: Partial<GitCommit> | null = null;
    let state: 'meta' | 'stats' = 'meta';
    let lineIdx = 0;

    // 辅助函数：完成当前 commit 的处理并推入数组
    const finalizeCommit = () => {
      if (currentCommit && currentCommit.hash) {
        // 计算语言
        currentCommit.language = this.detectLanguage(currentCommit.files || []);
        commits.push(currentCommit as GitCommit);
      }
    };

    while (lineIdx < lines.length) {
      const line = lines[lineIdx];

      // 检查是否是新 commit 的开始 (hash 是 40 位 hex)
      if (state === 'stats' && line.length === 40 && !line.includes('\t')) {
        finalizeCommit();
        state = 'meta';
        currentCommit = null;
      }

      if (state === 'meta') {
        // 读取元数据 (5行)
        if (lineIdx + 4 >= lines.length) break;

        currentCommit = {
          hash: lines[lineIdx++],
          date: new Date(lines[lineIdx++]),
          message: lines[lineIdx++],
          author: lines[lineIdx++],
          email: lines[lineIdx++],
          files: [],
          insertions: 0,
          deletions: 0,
        };

        while (lineIdx < lines.length && lines[lineIdx].trim() === '') {
          lineIdx++;
        }
        state = 'stats';
      } else {
        // 解析 numstat 行
        if (line.trim() === '') {
          lineIdx++;
          continue;
        }

        const parts = line.split('\t');
        if (parts.length === 3) {
          const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10);
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10);
          const file = parts[2];

          if (currentCommit) {
            currentCommit.insertions = (currentCommit.insertions || 0) + (isNaN(insertions) ? 0 : insertions);
            currentCommit.deletions = (currentCommit.deletions || 0) + (isNaN(deletions) ? 0 : deletions);
            currentCommit.files?.push(file);
          }
        }
        lineIdx++;
      }
    }

    finalizeCommit();
    return commits;
  }

  /**
   * 分析编程语言使用情况
   */
  private analyzeLanguages(commits: GitCommit[]): Map<string, { count: number; percentage: number }> {
    const languageMap = new Map<string, number>();
    let totalFiles = 0;

    for (const commit of commits) {
      for (const file of commit.files) {
        const ext = path.extname(file).toLowerCase();
        const language = this.getLanguageFromExtension(ext);

        if (language) {
          languageMap.set(language, (languageMap.get(language) || 0) + 1);
          totalFiles++;
        }
      }
    }

    const result = new Map<string, { count: number; percentage: number }>();
    for (const [language, count] of languageMap) {
      result.set(language, {
        count,
        percentage: Math.round((count / totalFiles) * 100),
      });
    }

    return result;
  }

  /**
   * 根据文件扩展名获取编程语言
   */
  private getLanguageFromExtension(ext: string): string {
    const languageMap: { [key: string]: string } = {
      '.js': 'JavaScript', '.ts': 'TypeScript', '.jsx': 'JavaScript', '.tsx': 'TypeScript',
      '.py': 'Python', '.java': 'Java', '.go': 'Go', '.rs': 'Rust',
      '.cpp': 'C++', '.c': 'C', '.cs': 'C#', '.php': 'PHP',
      '.rb': 'Ruby', '.swift': 'Swift', '.kt': 'Kotlin', '.dart': 'Dart',
      '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.sass': 'Sass', '.less': 'Less',
      '.vue': 'Vue', '.json': 'JSON', '.xml': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
      '.md': 'Markdown', '.sql': 'SQL', '.sh': 'Shell', '.bat': 'Batch',
    };
    return languageMap[ext] || 'Other';
  }

  /**
   * 分析时间模式
   */
  private analyzeTimePatterns(commits: GitCommit[]): {
    byHour: Map<number, number>;
    byDayOfWeek: Map<number, number>;
    byMonth: Map<string, number>;
  } {
    const byHour = new Map<number, number>();
    const byDayOfWeek = new Map<number, number>();
    const byMonth = new Map<string, number>();

    for (const commit of commits) {
      const date = moment(commit.date);
      const hour = date.hour();
      const dayOfWeek = date.day();
      const month = date.format('YYYY-MM');

      byHour.set(hour, (byHour.get(hour) || 0) + 1);
      byDayOfWeek.set(dayOfWeek, (byDayOfWeek.get(dayOfWeek) || 0) + 1);
      byMonth.set(month, (byMonth.get(month) || 0) + 1);
    }

    return { byHour, byDayOfWeek, byMonth };
  }

  /**
   * 分析提交连续记录
   */
  private analyzeStreaks(commits: GitCommit[]): {
    longestStreak: number;
    currentStreak: number;
    totalActiveDays: number;
  } {
    if (commits.length === 0) {
      return { longestStreak: 0, currentStreak: 0, totalActiveDays: 0 };
    }

    const sortedCommits = commits.sort((a, b) => a.date.getTime() - b.date.getTime());
    const activeDates = new Set<string>();
    for (const commit of sortedCommits) {
      activeDates.add(moment(commit.date).format('YYYY-MM-DD'));
    }

    const dates = Array.from(activeDates).sort();
    let longestStreak = 1;
    let currentStreak = 1;
    let tempStreak = 1;

    for (let i = 1; i < dates.length; i++) {
      const prevDate = moment(dates[i - 1]);
      const currDate = moment(dates[i]);

      if (currDate.diff(prevDate, 'days') === 1) {
        tempStreak++;
      } else {
        longestStreak = Math.max(longestStreak, tempStreak);
        tempStreak = 1;
      }
    }

    longestStreak = Math.max(longestStreak, tempStreak);

    const today = moment().format('YYYY-MM-DD');
    currentStreak = 0;

    for (let i = dates.length - 1; i >= 0; i--) {
      const expectedDate = moment().subtract(currentStreak, 'days').format('YYYY-MM-DD');
      if (dates[i] === expectedDate) {
        currentStreak++;
      } else {
        break;
      }
    }

    return { longestStreak, currentStreak, totalActiveDays: dates.length };
  }

  /**
   * 分析项目统计
   */
  private async analyzeProjects(commits: GitCommit[]): Promise<Array<{
    path: string;
    name: string;
    commits: number;
    lines: number;
  }>> {
    const repoPath = this.options.repositoryPath;
    const repoName = path.basename(repoPath);

    const totalLines = commits.reduce((sum, commit) =>
      sum + commit.insertions + commit.deletions, 0);

    return [{
      path: repoPath,
      name: repoName,
      commits: commits.length,
      lines: totalLines,
    }];
  }

  /**
   * 根据文件路径检测主要语言
   */
  private detectLanguage(files: string[]): string {
    if (files.length === 0) return 'Unknown';
    const extCount = new Map<string, number>();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      extCount.set(ext, (extCount.get(ext) || 0) + 1);
    }

    let maxCount = 0;
    let dominantExt = '';

    for (const [ext, count] of extCount) {
      if (count > maxCount) {
        maxCount = count;
        dominantExt = ext;
      }
    }

    return this.getLanguageFromExtension(dominantExt);
  }

  /**
   * 分析提交趋势
   */
  private analyzeTrends(commits: GitCommit[]): {
    monthly: { date: string; count: number }[];
    daily: { date: string; count: number }[];
  } {
    const monthly = new Map<string, number>();
    const daily = new Map<string, number>();

    for (const commit of commits) {
      const month = moment(commit.date).format('YYYY-MM');
      const day = moment(commit.date).format('YYYY-MM-DD');

      monthly.set(month, (monthly.get(month) || 0) + 1);
      daily.set(day, (daily.get(day) || 0) + 1);
    }

    // 排序并转换为数组
    const sortMap = (map: Map<string, number>) =>
      Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, count]) => ({ date, count }));

    return {
      monthly: sortMap(monthly),
      daily: sortMap(daily),
    };
  }

  /**
   * 分析 Punch Card (24h x 7d)
   */
  private analyzePunchCard(commits: GitCommit[]): number[][] {
    // 初始化 7x24 数组
    const card = Array(7).fill(0).map(() => Array(24).fill(0));

    for (const commit of commits) {
      const date = moment(commit.date);
      const day = date.day(); // 0-6
      const hour = date.hour(); // 0-23
      card[day][hour]++;
    }

    return card;
  }

  /**
   * 分析关键词
   */
  private analyzeKeywords(commits: GitCommit[]): { word: string; count: number }[] {
    const stopWords = new Set(['the', 'a', 'an', 'to', 'in', 'for', 'of', 'and', 'or', 'with', 'by', 'from', 'update', 'add', 'remove', 'fix', 'merge', 'delete', 'create']);
    const wordCount = new Map<string, number>();

    for (const commit of commits) {
      const words = commit.message
        .toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/);

      for (const word of words) {
        if (word.length > 2 && !stopWords.has(word)) {
          wordCount.set(word, (wordCount.get(word) || 0) + 1);
        }
      }
    }

    return Array.from(wordCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word, count]) => ({ word, count }));
  }

  /**
   * 计算成就
   */
  private calculateAchievements(stats: GitAnalysisResult, commits: GitCommit[]): Achievement[] {
    const achievements: Achievement[] = [
      {
        id: 'first-commit',
        name: '初出茅庐',
        description: `完成了人生第一次代码提交,开启了编程之旅。每个伟大的项目都始于第一行代码!`,
        icon: '🌱',
        unlocked: stats.totalCommits > 0,
      },
      {
        id: '100-commits',
        name: '百炼成钢',
        description: `累计提交达到 100 次!你已经养成了良好的版本控制习惯,每一次提交都是进步的见证。`,
        icon: '🔨',
        unlocked: stats.totalCommits >= 100,
        progress: `${Math.min(stats.totalCommits, 100)}/100`
      },
      {
        id: '500-commits',
        name: '代码老兵',
        description: `累计提交达到 500 次!你已经是经验丰富的开发者,见证了无数次代码的迭代与演进。`,
        icon: '🎖️',
        unlocked: stats.totalCommits >= 500,
        progress: `${Math.min(stats.totalCommits, 500)}/500`
      },
      {
        id: '1000-commits',
        name: '千锤百炼',
        description: `累计提交达到 1000 次!这是一个里程碑,你的坚持和热情令人敬佩。`,
        icon: '⚔️',
        unlocked: stats.totalCommits >= 1000,
        progress: `${Math.min(stats.totalCommits, 1000)}/1000`
      },
      {
        id: 'night-owl',
        name: '夜猫子',
        description: '在深夜 (0点-5点) 提交代码超过 20 次', // Will be updated below
        icon: '🦉',
        unlocked: false,
      },
      {
        id: 'weekend-warrior',
        name: '周末战士',
        description: '在周末提交代码超过 50 次', // Will be updated below
        icon: '🏖️',
        unlocked: false,
      },
      {
        id: 'consistency-king',
        name: '持之以恒',
        description: `连续 7 天以上保持提交!你的自律和坚持是成功的关键,最长连击记录: ${stats.streakStats.longestStreak} 天。`,
        icon: '🔥',
        unlocked: stats.streakStats.longestStreak >= 7,
        progress: `${stats.streakStats.longestStreak}/7`
      },
      {
        id: 'polyglot',
        name: '语言大师',
        description: `掌握 5 种以上编程语言!你是真正的全栈开发者,能够在不同技术栈间自由切换。`,
        icon: '🌍',
        unlocked: stats.languageStats.size >= 5,
        progress: `${stats.languageStats.size}/5`
      }
    ];

    // 计算特殊成就
    let nightCommits = 0;
    let weekendCommits = 0;
    let midnightCommits = 0;
    const dailyCommits = new Map<string, number>();
    const bugFixCommits = commits.filter(c => /fix|bug|修复/i.test(c.message)).length;
    const refactorCommits = commits.filter(c => /refactor|重构/i.test(c.message)).length;
    const docCommits = commits.filter(c => c.files.some(f => f.endsWith('.md'))).length;

    for (const commit of commits) {
      const date = moment(commit.date);
      const hour = date.hour();
      const day = date.day();
      const dateStr = date.format('YYYY-MM-DD');

      if (hour >= 0 && hour < 5) nightCommits++;
      if (hour >= 0 && hour <= 1) midnightCommits++;
      if (day === 0 || day === 6) weekendCommits++;
      
      dailyCommits.set(dateStr, (dailyCommits.get(dateStr) || 0) + 1);
    }

    // 更新夜猫子成就
    const nightOwl = achievements.find(a => a.id === 'night-owl');
    if (nightOwl) {
      nightOwl.unlocked = nightCommits >= 20;
      nightOwl.description = `在深夜 (0点-5点) 提交代码超过 20 次!你是真正的夜行者,在静谧的夜晚创造着代码的魔法。当前: ${nightCommits} 次深夜提交。`;
      nightOwl.progress = `${nightCommits}/20`;
    }

    // 更新周末战士成就
    const weekendWarrior = achievements.find(a => a.id === 'weekend-warrior');
    if (weekendWarrior) {
      weekendWarrior.unlocked = weekendCommits >= 50;
      weekendWarrior.description = `在周末提交代码超过 50 次!当别人休息时,你依然在编程的世界里探索。当前: ${weekendCommits} 次周末提交。`;
      weekendWarrior.progress = `${weekendCommits}/50`;
    }

    // 早起鸟
    const earlyBird = commits.filter(c => {
      const h = moment(c.date).hour();
      return h >= 5 && h <= 8;
    }).length;

    achievements.push({
      id: 'early-bird',
      name: '早起的鸟儿',
      description: `在清晨 (5点-8点) 提交代码超过 10 次!一日之计在于晨,你用清晨的时光书写着高质量的代码。当前: ${earlyBird} 次清晨提交。`,
      icon: '🌅',
      unlocked: earlyBird >= 10,
      progress: `${earlyBird}/10`
    });

    // 午夜编程者
    achievements.push({
      id: 'midnight-coder',
      name: '午夜编程者',
      description: `在午夜 (0点-1点) 提交代码超过 10 次!你在一天的交界处编写代码,见证着日期的更替。当前: ${midnightCommits} 次午夜提交。`,
      icon: '🌙',
      unlocked: midnightCommits >= 10,
      progress: `${midnightCommits}/10`
    });

    // 代码火箭
    const maxDailyCommits = Math.max(...Array.from(dailyCommits.values()), 0);
    achievements.push({
      id: 'code-rocket',
      name: '代码火箭',
      description: `单日提交超过 10 次!你的编程效率惊人,在一天内完成了大量的代码迭代。单日最高: ${maxDailyCommits} 次提交。`,
      icon: '🚀',
      unlocked: maxDailyCommits >= 10,
      progress: `${maxDailyCommits}/10`
    });

    // Bug终结者
    achievements.push({
      id: 'bug-terminator',
      name: 'Bug终结者',
      description: `提交信息包含"fix"或"bug"超过 30 次!你是团队的守护者,不断修复问题让代码更加健壮。当前: ${bugFixCommits} 次修复提交。`,
      icon: '🔧',
      unlocked: bugFixCommits >= 30,
      progress: `${bugFixCommits}/30`
    });

    // 重构艺术家
    achievements.push({
      id: 'refactor-artist',
      name: '重构艺术家',
      description: `提交信息包含"refactor"或"重构"超过 15 次!你深知代码质量的重要性,不断优化和改进现有代码。当前: ${refactorCommits} 次重构提交。`,
      icon: '🎨',
      unlocked: refactorCommits >= 15,
      progress: `${refactorCommits}/15`
    });

    // 文档达人
    achievements.push({
      id: 'doc-master',
      name: '文档达人',
      description: `提交包含 Markdown 文件超过 20 次!你明白好的文档和好的代码同样重要,为项目留下了宝贵的知识财富。当前: ${docCommits} 次文档提交。`,
      icon: '📚',
      unlocked: docCommits >= 20,
      progress: `${docCommits}/20`
    });

    // 质量守护者
    const avgLinesPerCommit = stats.totalCommits > 0 ? (stats.totalInsertions + stats.totalDeletions) / stats.totalCommits : 0;
    achievements.push({
      id: 'quality-guardian',
      name: '质量守护者',
      description: `平均每次提交代码行数少于 50 行!你遵循"小步快跑"的原则,每次提交都小而精,易于审查和回滚。平均: ${avgLinesPerCommit.toFixed(1)} 行/提交。`,
      icon: '💎',
      unlocked: avgLinesPerCommit > 0 && avgLinesPerCommit < 50,
    });

    // 代码巨人
    achievements.push({
      id: 'code-giant',
      name: '代码巨人',
      description: `累计贡献超过 10,000 行代码!你的代码量足以构建一个完整的系统,你是真正的代码生产者。当前: ${stats.netLines.toLocaleString()} 行净增量。`,
      icon: '🏗️',
      unlocked: stats.netLines >= 10000,
      progress: `${Math.min(stats.netLines, 10000).toLocaleString()}/10,000`
    });

    // 极简主义者
    const refactorRatio = stats.totalDeletions / (stats.totalInsertions || 1);
    achievements.push({
      id: 'minimalist',
      name: '极简主义者',
      description: `删除代码量达到新增代码量的 50% 以上!你深知"少即是多"的道理,通过删除冗余代码来提升系统质量。删除/新增比例: ${(refactorRatio * 100).toFixed(1)}%。`,
      icon: '🧹',
      unlocked: refactorRatio >= 0.5,
    });

    // 活跃开发者
    achievements.push({
      id: 'active-developer',
      name: '活跃开发者',
      description: `活跃天数超过 100 天!你几乎每天都在编程,这份热情和坚持令人钦佩。当前: ${stats.streakStats.totalActiveDays} 天活跃。`,
      icon: '⚡',
      unlocked: stats.streakStats.totalActiveDays >= 100,
      progress: `${stats.streakStats.totalActiveDays}/100`
    });

    // 只返回已解锁的成就
    return achievements.filter(a => a.unlocked);
  }

  /**
   * 计算开发者画像 (Persona)
   */
  public calculatePersona(stats: GitAnalysisResult): { title: string; description: string } {
    const { totalCommits, netLines, streakStats, languageStats } = stats;
    const languages = Array.from(languageStats.keys());
    const topLang = languages[0] || 'Code';

    let title = '编程学徒';
    let description = '你正在编程的世界里探索，每一步都是成长。';

    if (totalCommits > 1000) {
      if (netLines > 50000) title = '代码造物主';
      else title = '全栈艺术家';
    } else if (totalCommits > 500) {
      if (streakStats.longestStreak > 30) title = '持之以恒的大师';
      else title = '资深开发者';
    } else if (totalCommits > 100) {
      title = `${topLang} 工程师`;
    }

    // 根据风格微调
    if (stats.totalDeletions > stats.totalInsertions) {
      title = '极简主义者';
      description = '你深知"少即是多"的道理，致力于通过删除冗余代码来提升系统质量。';
    } else if (streakStats.longestStreak > 60) {
      title = '代码马拉松选手';
      description = '编程对你来说不是短跑，而是一场马拉松。你惊人的毅力令人钦佩。';
    } else if (stats.timeStats.byHour.get(23) || 0 > 50) {
      title = '守夜人';
      description = '当城市入睡时，你的代码在屏幕上闪耀。你是深夜里最亮的星。';
    } else {
      description = `你在 ${new Date().getFullYear()} 年提交了 ${totalCommits} 次代码，贡献了 ${stats.netLines} 行净增量。继续保持这份热情！`;
    }

    return { title, description };
  }

  /**
   * 合并多个项目的分析结果
   */
  public static mergeAnalysisResults(results: Array<{
    result: GitAnalysisResult;
    projectPath: string;
    projectName: string;
  }>): GitAnalysisResult & { projectDetails: Array<{ path: string; name: string; commits: number; lines: number; active: boolean }> } {
    if (results.length === 0) {
      throw new Error('没有可合并的分析结果');
    }

    const merged: GitAnalysisResult = {
      totalCommits: 0,
      totalInsertions: 0,
      totalDeletions: 0,
      netLines: 0,
      languageStats: new Map(),
      timeStats: {
        byHour: new Map(),
        byDayOfWeek: new Map(),
        byMonth: new Map(),
      },
      streakStats: {
        longestStreak: 0,
        currentStreak: 0,
        totalActiveDays: 0,
      },
      projectStats: [],
      commitTrends: {
        monthly: [],
        daily: [],
      },
      punchCard: Array(7).fill(null).map(() => Array(24).fill(0)),
      topKeywords: [],
      achievements: [],
      persona: { title: '编程学徒', description: '正在分析你的编程足迹...' },
    };

    const projectDetails: Array<{ path: string; name: string; commits: number; lines: number; active: boolean }> = [];

    // 合并基础统计数据
    for (const { result, projectPath, projectName } of results) {
      merged.totalCommits += result.totalCommits;
      merged.totalInsertions += result.totalInsertions;
      merged.totalDeletions += result.totalDeletions;
      merged.netLines += result.netLines;

      // 记录项目详情
      projectDetails.push({
        path: projectPath,
        name: projectName,
        commits: result.totalCommits,
        lines: result.netLines,
        active: result.totalCommits > 0,
      });

      // 合并语言统计
      for (const [lang, stats] of result.languageStats) {
        const existing = merged.languageStats.get(lang);
        if (existing) {
          existing.count += stats.count;
        } else {
          merged.languageStats.set(lang, { count: stats.count, percentage: 0 });
        }
      }

      // 合并时间统计
      for (const [hour, count] of result.timeStats.byHour) {
        merged.timeStats.byHour.set(hour, (merged.timeStats.byHour.get(hour) || 0) + count);
      }

      for (const [day, count] of result.timeStats.byDayOfWeek) {
        merged.timeStats.byDayOfWeek.set(day, (merged.timeStats.byDayOfWeek.get(day) || 0) + count);
      }

      for (const [month, count] of result.timeStats.byMonth) {
        merged.timeStats.byMonth.set(month, (merged.timeStats.byMonth.get(month) || 0) + count);
      }

      // 合并连续记录（取最大值）
      merged.streakStats.longestStreak = Math.max(merged.streakStats.longestStreak, result.streakStats.longestStreak);
      merged.streakStats.currentStreak = Math.max(merged.streakStats.currentStreak, result.streakStats.currentStreak);
      merged.streakStats.totalActiveDays += result.streakStats.totalActiveDays;

      // 合并打卡卡片
      for (let i = 0; i < 7; i++) {
        for (let j = 0; j < 24; j++) {
          merged.punchCard[i][j] += result.punchCard[i][j];
        }
      }

      // 合并项目统计
      merged.projectStats.push(...result.projectStats);

      // 合并提交趋势
      merged.commitTrends.monthly.push(...result.commitTrends.monthly);
      merged.commitTrends.daily.push(...result.commitTrends.daily);
    }

    // 重新计算语言百分比
    const totalLanguageCount = Array.from(merged.languageStats.values()).reduce((sum, stats) => sum + stats.count, 0);
    for (const [lang, stats] of merged.languageStats) {
      stats.percentage = totalLanguageCount > 0 ? (stats.count / totalLanguageCount) * 100 : 0;
    }

    // 排序语言统计
    merged.languageStats = new Map(
      Array.from(merged.languageStats.entries()).sort((a, b) => b[1].count - a[1].count)
    );

    // 合并并重新计算提交趋势（按月份聚合）
    const monthlyMap = new Map<string, number>();
    for (const trend of merged.commitTrends.monthly) {
      monthlyMap.set(trend.date, (monthlyMap.get(trend.date) || 0) + trend.count);
    }
    merged.commitTrends.monthly = Array.from(monthlyMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 计算关键词和成就（基于合并后的数据）
    // 注意：这里简化处理，实际应该基于所有提交重新计算
    merged.topKeywords = results.length > 0 ? results[0].result.topKeywords : [];

    // 基于合并后的数据重新计算成就
    const tempAnalyzer = new GitAnalyzer({ repositoryPath: '' });
    merged.achievements = tempAnalyzer.calculateAchievements(merged, []);
    merged.persona = tempAnalyzer.calculatePersona(merged);

    // 按提交数排序项目详情
    projectDetails.sort((a, b) => b.commits - a.commits);

    // 添加多项目相关的里程碑
    this.addProjectMilestones(merged, projectDetails);

    return { ...merged, projectDetails };
  }

  /**
   * 为多项目分析添加里程碑
   */
  private static addProjectMilestones(merged: GitAnalysisResult, projectDetails: Array<{ path: string; name: string; commits: number; lines: number; active: boolean }>): void {
    const totalProjects = projectDetails.length;
    const activeProjects = projectDetails.filter(p => p.active);
    const activeCount = activeProjects.length;

    // 项目数量里程碑
    if (totalProjects >= 50) {
      merged.achievements.push({
        id: 'project-collector-50',
        name: '项目收藏家',
        description: `在 ${totalProjects} 个项目中有过代码贡献！你是真正的开源达人，在无数项目中留下了足迹。`,
        icon: '🏆',
        unlocked: true,
        progress: `${totalProjects}/50+`
      });
    } else if (totalProjects >= 20) {
      merged.achievements.push({
        id: 'project-explorer-20',
        name: '项目探险家',
        description: `在 ${totalProjects} 个不同项目中工作过！你勇于尝试各种技术和领域，探索未知的项目世界。`,
        icon: '🧭',
        unlocked: true,
        progress: `${totalProjects}/20`
      });
    } else if (totalProjects >= 10) {
      merged.achievements.push({
        id: 'project-jumper-10',
        name: '项目跳跃者',
        description: `跨越 ${totalProjects} 个项目！你就像在代码世界中穿梭的忍者，灵活应对各种挑战。`,
        icon: '🥷',
        unlocked: true,
        progress: `${totalProjects}/10`
      });
    } else if (totalProjects >= 5) {
      merged.achievements.push({
        id: 'project-nomad-5',
        name: '项目游牧民',
        description: `在 ${totalProjects} 个项目间游牧！你的代码足迹遍布多个项目，展现了极强的适应性。`,
        icon: '🏕️',
        unlocked: true,
        progress: `${totalProjects}/5`
      });
    }

    // 活跃项目里程碑
    if (activeCount >= 10) {
      merged.achievements.push({
        id: 'active-projects-10',
        name: '全能战士',
        description: `同时在 ${activeCount} 个项目中保持活跃！你是真正的多任务处理大师，精力充沛得令人羡慕。`,
        icon: '⚡',
        unlocked: true,
        progress: `${activeCount}/10`
      });
    } else if (activeCount >= 5) {
      merged.achievements.push({
        id: 'active-projects-5',
        name: '项目达人',
        description: `在 ${activeCount} 个项目中都有贡献！你善于平衡多个项目，是真正的项目管理专家。`,
        icon: '🎯',
        unlocked: true,
        progress: `${activeCount}/5`
      });
    }

    // 专注度里程碑（很少项目有提交）
    if (totalProjects >= 10 && activeCount <= 3) {
      merged.achievements.push({
        id: 'focused-developer',
        name: '专注的工匠',
        description: `虽然接触了 ${totalProjects} 个项目，但只专注于 ${activeCount} 个核心项目。深度胜过广度，你是真正的代码工匠。`,
        icon: '🎨',
        unlocked: true,
      });
    }

    // 语言多样性里程碑
    const uniqueLanguages = new Set<string>();
    activeProjects.forEach(project => {
      // 这里简化处理，实际应该从每个项目的语言统计中获取
      if (project.commits > 0) {
        uniqueLanguages.add('JavaScript'); // 简化示例
      }
    });

    if (uniqueLanguages.size >= 5) {
      merged.achievements.push({
        id: 'language-diversity-5',
        name: '语言大师',
        description: `在项目中使用 ${uniqueLanguages.size} 种编程语言！你的技术栈广度令人印象深刻，真正的全能开发者。`,
        icon: '🌐',
        unlocked: true,
      });
    }

    // 极端情况里程碑
    if (totalProjects === 1 && activeCount === 1) {
      merged.achievements.push({
        id: 'loyal-developer',
        name: '忠实的守护者',
        description: `始终如一地专注于这一个项目。你的专注和坚持令人敬佩，是真正的项目守护者。`,
        icon: '🛡️',
        unlocked: true,
      });
    }

    // 按项目数量调整个人描述
    if (totalProjects >= 20) {
      merged.persona = {
        title: '项目探索家',
        description: `你在 ${new Date().getFullYear()} 年跨越了 ${totalProjects} 个项目，是真正的代码世界探险家。`
      };
    } else if (totalProjects >= 10) {
      merged.persona = {
        title: '多面手开发者',
        description: `你在 ${new Date().getFullYear()} 年在 ${totalProjects} 个项目中留下代码足迹，展现了惊人的适应性。`
      };
    } else if (totalProjects >= 5) {
      merged.persona = {
        title: '项目跳跃者',
        description: `你在 ${new Date().getFullYear()} 年活跃于 ${totalProjects} 个项目，是真正的代码游牧民。`
      };
    }
  }
}