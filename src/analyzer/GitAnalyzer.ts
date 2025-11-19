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

    // 分析数据
    const result: GitAnalysisResult = {
      totalCommits: commits.length,
      totalInsertions: commits.reduce((sum, commit) => sum + commit.insertions, 0),
      totalDeletions: commits.reduce((sum, commit) => sum + commit.deletions, 0),
      netLines: 0, // 将在下面计算
      languageStats: this.analyzeLanguages(commits),
      timeStats: this.analyzeTimePatterns(commits),
      streakStats: this.analyzeStreaks(commits),
      projectStats: await this.analyzeProjects(commits),
    };

    // 计算净代码行数
    result.netLines = result.totalInsertions - result.totalDeletions;

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
      // 注意：--numstat 输出中，stat 行以数字开头，meta 行是我们自定义的格式
      // 我们定义的格式第一行是 hash
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
        
        // 跳过可能存在的空行直到遇到 stats 或下一个 commit
        while (lineIdx < lines.length && lines[lineIdx].trim() === '') {
          lineIdx++;
        }
        state = 'stats';
      } else {
        // 解析 numstat 行: insertions \t deletions \t filename
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

    finalizeCommit(); // 处理最后一个 commit
    return commits;
  }

  /**
   * 分析编程语言使用情况
   */
  private analyzeLanguages(commits: GitCommit[]): Map<string, { count: number; percentage: number }> {
    const languageMap = new Map<string, number>();
    let totalFiles = 0;

    // 根据文件扩展名统计语言
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

    // 计算百分比
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
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.jsx': 'JavaScript',
      '.tsx': 'TypeScript',
      '.py': 'Python',
      '.java': 'Java',
      '.go': 'Go',
      '.rs': 'Rust',
      '.cpp': 'C++',
      '.c': 'C',
      '.cs': 'C#',
      '.php': 'PHP',
      '.rb': 'Ruby',
      '.swift': 'Swift',
      '.kt': 'Kotlin',
      '.dart': 'Dart',
      '.scala': 'Scala',
      '.html': 'HTML',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.sass': 'Sass',
      '.less': 'Less',
      '.vue': 'Vue',
      '.json': 'JSON',
      '.xml': 'XML',
      '.yaml': 'YAML',
      '.yml': 'YAML',
      '.md': 'Markdown',
      '.sql': 'SQL',
      '.sh': 'Shell',
      '.bat': 'Batch',
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
      const dayOfWeek = date.day(); // 0 = Sunday, 1 = Monday, ...
      const month = date.format('YYYY-MM');

      // 按小时统计
      byHour.set(hour, (byHour.get(hour) || 0) + 1);

      // 按星期几统计
      byDayOfWeek.set(dayOfWeek, (byDayOfWeek.get(dayOfWeek) || 0) + 1);

      // 按月统计
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

    // 按日期排序
    const sortedCommits = commits.sort((a, b) => a.date.getTime() - b.date.getTime());

    // 获取所有有提交的日期
    const activeDates = new Set<string>();
    for (const commit of sortedCommits) {
      activeDates.add(moment(commit.date).format('YYYY-MM-DD'));
    }

    const dates = Array.from(activeDates).sort();
    let longestStreak = 1;
    let currentStreak = 1;
    let tempStreak = 1;

    // 计算连续天数
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

    // 计算当前连续天数（从今天开始往前推算）
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

    return {
      longestStreak,
      currentStreak,
      totalActiveDays: dates.length,
    };
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
    // 简化版本：只返回当前仓库的信息
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

    // 统计最常见的扩展名
    const extCount = new Map<string, number>();

    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      extCount.set(ext, (extCount.get(ext) || 0) + 1);
    }

    // 找到最常见的扩展名
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
}