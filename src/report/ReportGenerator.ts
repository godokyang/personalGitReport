/**
 * 报告生成器
 * 负责生成精美的年度报告HTML页面
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { GitAnalysisResult } from '../analyzer/GitAnalyzer';

export interface ReportOptions {
  outputPath: string;
  theme: 'light' | 'dark' | 'colorful';
  format: 'html' | 'json' | 'pdf';
  author?: string;
  year: number;
}

/**
 * 报告生成器类
 */
export class ReportGenerator {
  private options: ReportOptions;
  private analysisResult: GitAnalysisResult;

  constructor(analysisResult: GitAnalysisResult, options: ReportOptions) {
    this.analysisResult = analysisResult;
    this.options = options;
  }

  /**
   * 生成完整的报告
   */
  async generate(): Promise<string> {
    console.log('📊 开始生成年度报告...');

    // 确保输出目录存在
    await fs.ensureDir(this.options.outputPath);

    let reportPath: string;

    switch (this.options.format) {
      case 'html':
        reportPath = await this.generateHTMLReport();
        break;
      case 'json':
        reportPath = await this.generateJSONReport();
        break;
      case 'pdf':
        reportPath = await this.generatePDFReport();
        break;
      default:
        throw new Error(`不支持的报告格式: ${this.options.format}`);
    }

    console.log(`✅ 报告生成完成: ${reportPath}`);
    return reportPath;
  }

  /**
   * 生成HTML报告
   */
  private async generateHTMLReport(): Promise<string> {
    const html = await this.generateHTMLContent();
    const reportPath = path.join(this.options.outputPath, `git-report-${this.options.year}.html`);

    await fs.writeFile(reportPath, html, 'utf8');
    return reportPath;
  }

  /**
   * 生成JSON报告
   */
  private async generateJSONReport(): Promise<string> {
    const jsonContent = JSON.stringify(this.analysisResult, null, 2);
    const reportPath = path.join(this.options.outputPath, `git-report-${this.options.year}.json`);

    await fs.writeFile(reportPath, jsonContent, 'utf8');
    return reportPath;
  }

  /**
   * 生成PDF报告（简化版本）
   */
  private async generatePDFReport(): Promise<string> {
    // 先生成HTML版本
    const htmlPath = await this.generateHTMLReport();
    const pdfPath = path.join(this.options.outputPath, `git-report-${this.options.year}.pdf`);

    // TODO: 使用puppeteer将HTML转换为PDF
    // 这里先用HTML文件代替
    console.log('📝 PDF功能开发中，当前生成HTML版本');
    return htmlPath;
  }

  /**
   * 生成HTML内容
   */
  private async generateHTMLContent(): Promise<string> {
    const theme = this.getThemeCSS();
    const content = this.generateReportContent();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.options.year} 年度编程报告</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: ${theme.textColor};
            background: ${theme.backgroundColor};
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }

        .header {
            text-align: center;
            margin-bottom: 50px;
            padding: 40px 0;
            background: ${theme.headerBackground};
            border-radius: 15px;
        }

        .title {
            font-size: 3rem;
            font-weight: bold;
            margin-bottom: 10px;
            background: linear-gradient(45deg, ${theme.primaryColor}, ${theme.secondaryColor});
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .subtitle {
            font-size: 1.2rem;
            opacity: 0.8;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 25px;
            margin-bottom: 50px;
        }

        .stat-card {
            background: ${theme.cardBackground};
            padding: 30px;
            border-radius: 15px;
            text-align: center;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }

        .stat-card:hover {
            transform: translateY(-5px);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: bold;
            color: ${theme.primaryColor};
            margin-bottom: 10px;
        }

        .stat-label {
            font-size: 1rem;
            opacity: 0.7;
        }

        .section {
            background: ${theme.cardBackground};
            padding: 40px;
            border-radius: 15px;
            margin-bottom: 30px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }

        .section-title {
            font-size: 2rem;
            margin-bottom: 25px;
            color: ${theme.primaryColor};
            border-bottom: 3px solid ${theme.primaryColor};
            padding-bottom: 10px;
        }

        .language-chart {
            display: flex;
            flex-wrap: wrap;
            gap: 20px;
            justify-content: center;
            margin: 30px 0;
        }

        .language-item {
            text-align: center;
            padding: 15px;
            background: ${theme.languageBackground};
            border-radius: 10px;
            min-width: 120px;
        }

        .language-name {
            font-weight: bold;
            margin-bottom: 5px;
        }

        .language-percentage {
            font-size: 1.2rem;
            color: ${theme.primaryColor};
        }

        .time-heatmap {
            display: grid;
            grid-template-columns: repeat(24, 1fr);
            gap: 4px;
            margin: 20px 0;
        }

        .hour-cell {
            aspect-ratio: 1;
            border-radius: 4px;
            background: ${theme.heatmapBackground};
            position: relative;
            overflow: hidden;
        }

        .hour-cell::after {
            content: attr(data-count);
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.7rem;
            opacity: 0;
            transition: opacity 0.3s;
        }

        .hour-cell:hover::after {
            opacity: 1;
        }

        .project-list {
            display: grid;
            gap: 20px;
        }

        .project-item {
            background: ${theme.projectBackground};
            padding: 20px;
            border-radius: 10px;
            border-left: 5px solid ${theme.primaryColor};
        }

        .project-name {
            font-weight: bold;
            margin-bottom: 10px;
            font-size: 1.1rem;
        }

        .project-stats {
            display: flex;
            gap: 30px;
            flex-wrap: wrap;
        }

        .project-stat {
            display: flex;
            flex-direction: column;
        }

        .project-stat-value {
            font-weight: bold;
            color: ${theme.primaryColor};
        }

        .project-stat-label {
            font-size: 0.9rem;
            opacity: 0.7;
        }

        .footer {
            text-align: center;
            margin-top: 50px;
            padding: 20px;
            opacity: 0.7;
        }

        @media (max-width: 768px) {
            .container {
                padding: 10px;
            }

            .title {
                font-size: 2rem;
            }

            .stats-grid {
                grid-template-columns: 1fr;
            }

            .time-heatmap {
                grid-template-columns: repeat(12, 1fr);
            }
        }
    </style>
</head>
<body>
    <div class="container">
        ${content}
    </div>
</body>
</html>`;
  }

  /**
   * 生成报告内容
   */
  private generateReportContent(): string {
    const author = this.options.author || '开发者';
    const year = this.options.year;

    return `
        <div class="header">
            <h1 class="title">${year} 年度编程报告</h1>
            <p class="subtitle">🌟 ${author} 的代码之旅回顾</p>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-number">${this.analysisResult.totalCommits.toLocaleString()}</div>
                <div class="stat-label">📝 总提交次数</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">+${this.analysisResult.totalInsertions.toLocaleString()}</div>
                <div class="stat-label">💻 新增代码行数</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.analysisResult.netLines.toLocaleString()}</div>
                <div class="stat-label">📈 净增长代码行</div>
            </div>
            <div class="stat-card">
                <div class="stat-number">${this.analysisResult.streakStats.longestStreak}</div>
                <div class="stat-label">🔥 最长连续天数</div>
            </div>
        </div>

        <div class="section">
            <h2 class="section-title">💻 技术栈分析</h2>
            <div class="language-chart">
                ${this.generateLanguageChart()}
            </div>
        </div>

        <div class="section">
            <h2 class="section-title">⏰ 编程时间模式</h2>
            <p>🌅 最活跃时段分析</p>
            <div class="time-heatmap">
                ${this.generateTimeHeatmap()}
            </div>
        </div>

        <div class="section">
            <h2 class="section-title">🎯 项目足迹</h2>
            <div class="project-list">
                ${this.generateProjectList()}
            </div>
        </div>

        <div class="footer">
            <p>🚀 由 Personal Git Report 生成 | ${new Date().toLocaleDateString()}</p>
        </div>
    `;
  }

  /**
   * 生成语言图表
   */
  private generateLanguageChart(): string {
    let html = '';
    const sortedLanguages = Array.from(this.analysisResult.languageStats.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8);

    for (const [language, stats] of sortedLanguages) {
      html += `
        <div class="language-item">
            <div class="language-name">${language}</div>
            <div class="language-percentage">${stats.percentage}%</div>
        </div>
      `;
    }

    return html;
  }

  /**
   * 生成时间热力图
   */
  private generateTimeHeatmap(): string {
    let html = '';
    const maxCommits = Math.max(...this.analysisResult.timeStats.byHour.values());

    for (let hour = 0; hour < 24; hour++) {
      const count = this.analysisResult.timeStats.byHour.get(hour) || 0;
      const intensity = maxCommits > 0 ? (count / maxCommits) : 0;
      const opacity = Math.max(0.1, intensity);

      html += `<div class="hour-cell"
        style="background: rgba(99, 102, 241, ${opacity})"
        data-count="${count}"
        title="${hour}:00 - ${count} 次提交">
      </div>`;
    }

    return html;
  }

  /**
   * 生成项目列表
   */
  private generateProjectList(): string {
    let html = '';

    for (const project of this.analysisResult.projectStats) {
      html += `
        <div class="project-item">
            <div class="project-name">📁 ${project.name}</div>
            <div class="project-stats">
                <div class="project-stat">
                    <span class="project-stat-value">${project.commits}</span>
                    <span class="project-stat-label">提交次数</span>
                </div>
                <div class="project-stat">
                    <span class="project-stat-value">${(project.lines / 1000).toFixed(1)}K</span>
                    <span class="project-stat-label">代码行数</span>
                </div>
                <div class="project-stat">
                    <span class="project-stat-value">${project.path}</span>
                    <span class="project-stat-label">项目路径</span>
                </div>
            </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * 获取主题样式配置
   */
  private getThemeCSS() {
    const themes = {
      light: {
        backgroundColor: '#f8fafc',
        textColor: '#1e293b',
        cardBackground: '#ffffff',
        headerBackground: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        primaryColor: '#667eea',
        secondaryColor: '#764ba2',
        languageBackground: '#f1f5f9',
        heatmapBackground: '#e2e8f0',
        projectBackground: '#f8fafc',
      },
      dark: {
        backgroundColor: '#0f172a',
        textColor: '#e2e8f0',
        cardBackground: '#1e293b',
        headerBackground: 'linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)',
        primaryColor: '#60a5fa',
        secondaryColor: '#a78bfa',
        languageBackground: '#334155',
        heatmapBackground: '#475569',
        projectBackground: '#334155',
      },
      colorful: {
        backgroundColor: '#fef3c7',
        textColor: '#92400e',
        cardBackground: '#fffbeb',
        headerBackground: 'linear-gradient(135deg, #f59e0b 0%, #dc2626 100%)',
        primaryColor: '#f59e0b',
        secondaryColor: '#dc2626',
        languageBackground: '#fed7aa',
        heatmapBackground: '#fdba74',
        projectBackground: '#fef3c7',
      },
    };

    return themes[this.options.theme];
  }
}