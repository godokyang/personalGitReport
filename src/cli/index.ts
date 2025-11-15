#!/usr/bin/env node

/**
 * Personal Git Report 命令行工具
 * 提供简单易用的CLI接口
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import * as path from 'path';
import { GitAnalyzer, GitAnalyzerOptions } from '../analyzer/GitAnalyzer';
import { ReportGenerator, ReportOptions } from '../report/ReportGenerator';
import { ConfigManager, GitReportConfig } from '../utils/ConfigManager';

const program = new Command();

/**
 * 主程序入口
 */
async function main() {
  program
    .name('git-report')
    .description('🌟 打造属于你的年度编程回顾报告')
    .version('1.0.0');

  // 基础命令
  program
    .argument('[path]', '要分析的Git仓库路径', process.cwd())
    .option('-y, --year <year>', '指定年份', new Date().getFullYear().toString())
    .option('-t, --theme <theme>', '主题 (light/dark/colorful)', 'dark')
    .option('-f, --format <format>', '输出格式 (html/json/pdf)', 'html')
    .option('-o, --output <path>', '输出目录', './reports')
    .option('-a, --author <email>', '指定作者邮箱')
    .option('-c, --config <path>', '配置文件路径')
    .option('--no-interactive', '非交互模式')
    .action(async (repoPath: string, options) => {
      try {
        await generateReport(repoPath, options);
      } catch (error) {
        console.error(chalk.red('❌ 生成报告失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 多项目分析命令
  program
    .command('multi')
    .description('分析多个项目')
    .option('-p, --projects <paths>', '项目路径列表，用逗号分隔')
    .option('-y, --year <year>', '指定年份', new Date().getFullYear().toString())
    .option('-t, --theme <theme>', '主题 (light/dark/colorful)', 'dark')
    .option('-f, --format <format>', '输出格式 (html/json/pdf)', 'html')
    .option('-o, --output <path>', '输出目录', './reports')
    .option('-c, --config <path>', '配置文件路径')
    .action(async (options) => {
      try {
        await generateMultipleReports(options);
      } catch (error) {
        console.error(chalk.red('❌ 生成报告失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  // 初始化配置命令
  program
    .command('init')
    .description('创建示例配置文件')
    .option('-o, --output <path>', '配置文件输出路径', './git-report.config.js')
    .action(async (options) => {
      try {
        await ConfigManager.createSampleConfig(options.output);
      } catch (error) {
        console.error(chalk.red('❌ 创建配置文件失败:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  program.parse();
}

/**
 * 生成单个项目报告
 */
async function generateReport(repoPath: string, options: any): Promise<void> {
  console.log(chalk.blue.bold('🚀 Personal Git Report - 年度编程报告生成器'));
  console.log('');

  // 解析参数
  const year = ConfigManager.parseYear(options.year);
  const resolvedPath = path.resolve(repoPath);

  // 加载配置
  const config = await ConfigManager.loadConfig(options.config);

  // 命令行参数覆盖配置文件
  const finalConfig = {
    ...config,
    theme: options.theme || config.theme,
    format: [options.format],
    output: options.output || config.output,
  };

  // 验证配置
  const validation = ConfigManager.validateConfig(finalConfig);
  if (!validation.valid) {
    console.error(chalk.red('❌ 配置验证失败:'));
    validation.errors.forEach(error => console.error(chalk.red(`  - ${error}`)));
    return;
  }

  // 交互式配置（如果启用）
  if (options.interactive !== false) {
    await interactiveConfig(finalConfig, resolvedPath);
  }

  // 显示配置信息
  console.log(chalk.blue('📋 配置信息:'));
  console.log(`  📁 项目路径: ${chalk.cyan(resolvedPath)}`);
  console.log(`  📅 分析年份: ${chalk.cyan(year)}`);
  console.log(`  🎨 主题风格: ${chalk.cyan(finalConfig.theme)}`);
  console.log(`  📄 输出格式: ${chalk.cyan(finalConfig.format.join(', '))}`);
  console.log(`  📂 输出目录: ${chalk.cyan(finalConfig.output)}`);
  console.log('');

  // 开始分析
  const spinner = ora('🔍 正在分析Git仓库...').start();

  try {
    // 设置Git分析器选项
    const analyzerOptions: GitAnalyzerOptions = {
      repositoryPath: resolvedPath,
      author: options.author || config.email,
      includeMerges: finalConfig.includeMerges,
      excludePaths: finalConfig.excludePaths,
      since: finalConfig.dateRange?.from,
      until: finalConfig.dateRange?.to,
    };

    // 如果没有指定日期范围，按年份分析
    if (!analyzerOptions.since && !analyzerOptions.until) {
      analyzerOptions.since = `${year}-01-01`;
      analyzerOptions.until = `${year}-12-31`;
    }

    // 执行Git分析
    const analyzer = new GitAnalyzer(analyzerOptions);
    const analysisResult = await analyzer.analyze();

    spinner.succeed('✅ Git仓库分析完成！');

    // 生成报告
    const reportSpinner = ora('📊 正在生成年度报告...').start();

    const reportOptions: ReportOptions = {
      outputPath: finalConfig.output,
      theme: finalConfig.theme,
      format: finalConfig.format[0] as 'html' | 'json' | 'pdf',
      author: finalConfig.author || '开发者',
      year: year,
    };

    const reportGenerator = new ReportGenerator(analysisResult, reportOptions);
    const reportPath = await reportGenerator.generate();

    reportSpinner.succeed('✅ 年度报告生成完成！');

    // 显示结果
    console.log('');
    console.log(chalk.green.bold('🎉 报告生成成功！'));
    console.log('');
    console.log(chalk.blue('📊 统计摘要:'));
    console.log(`  📝 总提交数: ${chalk.yellow(analysisResult.totalCommits.toLocaleString())}`);
    console.log(`  💻 新增代码: ${chalk.yellow('+' + analysisResult.totalInsertions.toLocaleString())} 行`);
    console.log(`  🗑️ 删除代码: ${chalk.yellow('-' + analysisResult.totalDeletions.toLocaleString())} 行`);
    console.log(`  📈 净增长: ${chalk.yellow(analysisResult.netLines.toLocaleString())} 行`);
    console.log(`  🔥 最长连续: ${chalk.yellow(analysisResult.streakStats.longestStreak)} 天`);
    console.log(`  🎯 技术栈: ${chalk.yellow(Array.from(analysisResult.languageStats.keys()).slice(0, 3).join(', '))}`);
    console.log('');
    console.log(chalk.blue('📄 报告文件:'));
    console.log(`  📂 ${chalk.cyan(reportPath)}`);
    console.log('');
    console.log(chalk.green('🌟 快去分享你的年度编程成就吧！'));

  } catch (error) {
    spinner.fail('❌ 分析失败');
    throw error;
  }
}

/**
 * 生成多个项目报告
 */
async function generateMultipleReports(options: any): Promise<void> {
  console.log(chalk.blue.bold('🚀 Personal Git Report - 多项目分析模式'));
  console.log('');

  if (!options.projects) {
    console.error(chalk.red('❌ 请指定要分析的项目路径'));
    console.log(chalk.yellow('💡 使用示例: git-report multi --projects "/proj1,/proj2,/proj3"'));
    return;
  }

  const projectPaths = options.projects.split(',').map((p: string) => path.resolve(p.trim()));
  const year = ConfigManager.parseYear(options.year);

  console.log(chalk.blue('📋 将分析以下项目:'));
  projectPaths.forEach((p: string, i: number) => {
    console.log(`  ${i + 1}. ${chalk.cyan(p)}`);
  });
  console.log('');

  // 为每个项目生成报告
  for (let i = 0; i < projectPaths.length; i++) {
    const projectPath = projectPaths[i];
    console.log(chalk.blue(`🔍 分析项目 ${i + 1}/${projectPaths.length}: ${path.basename(projectPath)}`));

    try {
      // 创建项目专用的输出目录
      const projectName = path.basename(projectPath);
      const projectOutput = path.join(options.output, projectName);

      // 设置分析选项
      const analyzerOptions: GitAnalyzerOptions = {
        repositoryPath: projectPath,
        includeMerges: false,
        since: `${year}-01-01`,
        until: `${year}-12-31`,
      };

      // 执行分析
      const analyzer = new GitAnalyzer(analyzerOptions);
      const analysisResult = await analyzer.analyze();

      // 生成报告
      const reportOptions: ReportOptions = {
        outputPath: projectOutput,
        theme: options.theme,
        format: options.format,
        author: path.basename(projectPath),
        year: year,
      };

      const reportGenerator = new ReportGenerator(analysisResult, reportOptions);
      await reportGenerator.generate();

      console.log(chalk.green(`✅ 项目 ${projectName} 报告生成完成`));

    } catch (error) {
      console.error(chalk.red(`❌ 项目 ${path.basename(projectPath)} 分析失败: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log('');
  }

  console.log(chalk.green.bold('🎉 所有项目分析完成！'));
}

/**
 * 交互式配置
 */
async function interactiveConfig(config: GitReportConfig, repoPath: string): Promise<void> {
  console.log(chalk.blue('🎯 交互式配置 (按Enter使用默认值)'));
  console.log('');

  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'author',
      message: '显示在报告中的名字:',
      default: config.author || path.basename(repoPath),
    },
    {
      type: 'list',
      name: 'theme',
      message: '选择主题风格:',
      choices: [
        { name: '🌙 暗黑主题', value: 'dark' },
        { name: '☀️ 明亮主题', value: 'light' },
        { name: '🌈 彩色主题', value: 'colorful' },
      ],
      default: config.theme,
    },
    {
      type: 'checkbox',
      name: 'format',
      message: '选择输出格式:',
      choices: [
        { name: '📄 HTML (推荐)', value: 'html', checked: true },
        { name: '📋 JSON 数据', value: 'json' },
        { name: '📕 PDF 报告', value: 'pdf' },
      ],
    },
    {
      type: 'input',
      name: 'output',
      message: '输出目录:',
      default: config.output,
    },
  ]);

  // 更新配置
  config.author = answers.author;
  config.theme = answers.theme;
  config.format = answers.format;
  config.output = answers.output;

  console.log('');
}

// 启动程序
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('💥 程序异常退出:'), error);
    process.exit(1);
  });
}