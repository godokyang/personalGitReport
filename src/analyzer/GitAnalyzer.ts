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
  author?: string;
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
    this.options = {
      includeMerges: false,
      excludePaths: [],
      ...options,
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

    // 如果指定了作者，添加过滤条件
    if (this.options.author) {
      options['--author'] = this.options.author;
    }

    // 日期范围过滤 (Git原生支持)
    if (this.options.since) {
      options['--since'] = this.options.since;
    }
    if (this.options.until) {
      options['--until'] = this.options.until;
    }

    // 排除合并提交
    if (!this.options.includeMerges) {
      options['--no-merges'] = null;
    }

    try {
      // 获取原始日志输出
      const logOutput = await this.git.raw(['log', ...this.buildLogArgs(options)]);
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
        description: `完成第一次代码提交 (当前: ${stats.totalCommits} 次)`,
        icon: '🌱',
        unlocked: stats.totalCommits > 0,
      },
      {
        id: '100-commits',
        name: '百炼成钢',
        description: `累计提交达到 100 次 (当前: ${stats.totalCommits} 次)`,
        icon: '🔨',
        unlocked: stats.totalCommits >= 100,
        progress: `${Math.min(stats.totalCommits, 100)}/100`
      },
      {
        id: '1000-commits',
        name: '千锤百炼',
        description: `累计提交达到 1000 次 (当前: ${stats.totalCommits} 次)`,
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
        description: `连续提交超过 7 天 (最长: ${stats.streakStats.longestStreak} 天)`,
        icon: '🔥',
        unlocked: stats.streakStats.longestStreak >= 7,
        progress: `${stats.streakStats.longestStreak}/7`
      },
      {
        id: 'polyglot',
        name: '语言大师',
        description: `使用超过 5 种编程语言 (当前: ${stats.languageStats.size} 种)`,
        icon: '🌍',
        unlocked: stats.languageStats.size >= 5,
        progress: `${stats.languageStats.size}/5`
      }
    ];

    // 计算特殊成就
    let nightCommits = 0;
    let weekendCommits = 0;

    for (const commit of commits) {
      const date = moment(commit.date);
      const hour = date.hour();
      const day = date.day();

      if (hour >= 0 && hour < 5) nightCommits++;
      if (day === 0 || day === 6) weekendCommits++;
    }

    const nightOwl = achievements.find(a => a.id === 'night-owl');
    if (nightOwl) {
      nightOwl.unlocked = nightCommits >= 20;
      nightOwl.description = `在深夜 (0点-5点) 提交代码超过 20 次 (当前: ${nightCommits} 次)`;
      nightOwl.progress = `${nightCommits}/20`;
    }

    const weekendWarrior = achievements.find(a => a.id === 'weekend-warrior');
    if (weekendWarrior) {
      weekendWarrior.unlocked = weekendCommits >= 50;
      weekendWarrior.description = `在周末提交代码超过 50 次 (当前: ${weekendCommits} 次)`;
      weekendWarrior.progress = `${weekendCommits}/50`;
    }

    // 计算更多成就
    const earlyBird = commits.filter(c => {
      const h = moment(c.date).hour();
      return h >= 5 && h <= 8;
    }).length;

    achievements.push({
      id: 'early-bird',
      name: '早起鸟',
      description: `在清晨 (5点-8点) 提交代码超过 10 次 (当前: ${earlyBird} 次)`,
      icon: '🌅',
      unlocked: earlyBird >= 10,
      progress: `${earlyBird}/10`
    });

    // 重构大师
    const refactorRatio = stats.totalDeletions / (stats.totalInsertions || 1);
    achievements.push({
      id: 'refactor-master',
      name: '重构大师',
      description: `删除代码量接近新增代码量 (当前比例: ${refactorRatio.toFixed(2)})`,
      icon: '🧹',
      unlocked: refactorRatio > 0.5,
    });

    return achievements;
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
}