/**
 * 报告生成器
 * 负责生成精美的年度报告HTML页面
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import handlebars from 'handlebars';
import puppeteer from 'puppeteer';
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
   * 生成PDF报告
   */
    private async generatePDFReport(): Promise<string> {
        const htmlContent = await this.generateHTMLContent();
        const pdfPath = path.join(this.options.outputPath, `git-report-${this.options.year}.pdf`);

        console.log('🖨️ 正在生成PDF...');

        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const page = await browser.newPage();

            // 设置内容
            await page.setContent(htmlContent, {
                waitUntil: 'networkidle0'
            });

            // 生成PDF
            await page.pdf({
                path: pdfPath,
                format: 'A4',
                printBackground: true,
                margin: {
                    top: '20px',
                    bottom: '20px',
                    left: '20px',
                    right: '20px'
                }
            });

            await browser.close();
            return pdfPath;
        } catch (error) {
            console.error('❌ PDF生成失败:', error);
            throw error;
        }
    }

    /**
     * 生成HTML内容
     */
    private async generateHTMLContent(): Promise<string> {
        // 注册 helper
        handlebars.registerHelper('formatNumber', (num: number) => {
            return num.toLocaleString();
        });

        // 项目统计辅助函数
        handlebars.registerHelper('countActiveProjects', (projects: any[]) => {
            if (!projects) return 0;
            return projects.filter(p => p.active).length;
        });

        handlebars.registerHelper('countInactiveProjects', (projects: any[]) => {
            if (!projects) return 0;
            return projects.filter(p => !p.active).length;
        });

        handlebars.registerHelper('gt0', (num: number) => {
            return num > 0;
        });

        // 读取模板
        const templatePath = path.join(__dirname, '../templates/report_fixed.hbs');
        const stylePath = path.join(__dirname, '../templates/style.hbs');

        const templateContent = await fs.readFile(templatePath, 'utf8');
        const styleContent = await fs.readFile(stylePath, 'utf8');

        // 编译样式
        const styleTemplate = handlebars.compile(styleContent);
        const css = styleTemplate({
            theme: this.getThemeCSS()
        });

        // 准备数据
        const data = {
            year: this.options.year,
            author: this.options.author || '开发者',
            generatedDate: new Date().toLocaleDateString(),
            css: css,
            ...this.analysisResult,
            persona: this.analysisResult.persona, // Explicitly pass persona
            // 预处理一些数据以适应模板
            languageStats: Array.from(this.analysisResult.languageStats.entries())
                .sort((a, b) => b[1].count - a[1].count)
                .slice(0, 8)
                .map(([name, stats]) => ({ name, ...stats })),
            timeStats: this.processTimeStatsForTemplate(),
            projectStats: this.analysisResult.projectStats.map(p => ({
                ...p,
                linesFormatted: (p.lines / 1000).toFixed(1) + 'K'
            })),
            // New Data for Charts
            chartData: JSON.stringify({
                trends: this.analysisResult.commitTrends,
                languages: Array.from(this.analysisResult.languageStats.entries())
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 10)
                    .map(([name, stats]) => ({ name, count: stats.count })),
                punchCard: this.analysisResult.punchCard,
                timeDistribution: {
                    hours: Array.from(this.analysisResult.timeStats.byHour.entries()).sort((a, b) => a[0] - b[0]),
                    days: Array.from(this.analysisResult.timeStats.byDayOfWeek.entries()).sort((a, b) => a[0] - b[0])
                }
            })
        };

        // 编译主模板
        const template = handlebars.compile(templateContent);
        return template(data);
    }

    /**
     * 处理时间统计数据以适应模板
     */
    private processTimeStatsForTemplate() {
        const maxCommits = Math.max(...this.analysisResult.timeStats.byHour.values());
        const result = [];

        for (let hour = 0; hour < 24; hour++) {
            const count = this.analysisResult.timeStats.byHour.get(hour) || 0;
            const intensity = maxCommits > 0 ? (count / maxCommits) : 0;
            const opacity = Math.max(0.1, intensity);

            result.push({
                hour,
                count,
                opacity
            });
        }
        return result;
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